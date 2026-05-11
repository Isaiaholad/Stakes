import crypto from 'node:crypto';
import { PrivyClient } from '@privy-io/server-auth';
import { getAddress, isAddress, verifyMessage } from 'viem';
import { apiConfig } from './config.js';
import { cleanupExpiredAuthRecords, get, nowIso, run } from './db.js';

const privy = apiConfig.privyAppId && apiConfig.privyAppSecret
  ? new PrivyClient(apiConfig.privyAppId, apiConfig.privyAppSecret)
  : null;
const sessionCookieName = 'swf_session_id';

function normalizeAddress(value) {
  const rawValue = String(value || '').trim();
  if (!isAddress(rawValue)) {
    return '';
  }

  return getAddress(rawValue).toLowerCase();
}

function readCookieValue(request, name) {
  const cookieHeader = String(request.headers?.cookie || '').trim();
  if (!cookieHeader) {
    return '';
  }

  for (const part of cookieHeader.split(';')) {
    const [key, ...valueParts] = part.trim().split('=');
    if (key === name) {
      return decodeURIComponent(valueParts.join('=') || '');
    }
  }

  return '';
}

function buildWalletSignInMessage({ address, nonce, expiresAt }) {
  return [
    'StakeWithFriends chat sign-in',
    '',
    `Wallet: ${address}`,
    `Nonce: ${nonce}`,
    `Expires: ${expiresAt}`,
    '',
    'Sign this message to verify your wallet. This does not cost gas.'
  ].join('\n');
}

async function readStoredSession(sessionId) {
  const normalizedSessionId = String(sessionId || '').trim();
  if (!normalizedSessionId) {
    return null;
  }

  await cleanupExpiredAuthRecords();
  const session = await get(
    `
      SELECT session_id, address, expires_at
      FROM sessions
      WHERE session_id = ? AND expires_at > ?
      LIMIT 1
    `,
    [normalizedSessionId, nowIso()]
  );

  if (!session?.address) {
    return null;
  }

  return {
    session_id: session.session_id,
    address: normalizeAddress(session.address),
    expires_at: session.expires_at
  };
}

export function readBearerToken(request) {
  const header = String(request.headers?.authorization || '').trim();
  if (!header) {
    return '';
  }
  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return '';
  }
  return parts[1].trim();
}

export async function getSessionFromRequest(request) {
  const token = readBearerToken(request);
  if (token) {
    const storedSession = await readStoredSession(token);
    if (storedSession) {
      return storedSession;
    }

    if (token.includes('.') && privy) {
      try {
        const verifiedClaims = await privy.verifyAuthToken(token);
        const user = await privy.getUser(verifiedClaims.userId);
        const walletAddress =
          user.wallet?.address ||
          user.linkedAccounts?.find((account) => account.type === 'wallet' && account.address)?.address ||
          '';
        const address = normalizeAddress(walletAddress);

        if (!address) return null;

        return {
          session_id: token,
          address,
          expires_at: new Date(verifiedClaims.expiration * 1000).toISOString()
        };
      } catch (error) {
        console.error('Privy auth error:', error);
      }
    }
  }

  const cookieSessionId = readCookieValue(request, sessionCookieName);
  if (cookieSessionId) {
    return await readStoredSession(cookieSessionId);
  }

  return null;
}

export function clearSessionCookie(secure = apiConfig.sessionCookieSecure) {
  return [
    `${sessionCookieName}=`,
    'Path=/',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : ''
  ].filter(Boolean).join('; ');
}

export function createSessionCookie(sessionId, expiresAt, secure = apiConfig.sessionCookieSecure) {
  return [
    `${sessionCookieName}=${encodeURIComponent(sessionId)}`,
    'Path=/',
    `Expires=${new Date(expiresAt).toUTCString()}`,
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : ''
  ].filter(Boolean).join('; ');
}

export async function createNonceChallenge(address) {
  const normalizedAddress = normalizeAddress(address);
  if (!normalizedAddress) {
    throw new Error('A valid wallet address is required.');
  }

  await cleanupExpiredAuthRecords();
  const nonce = crypto.randomBytes(16).toString('hex');
  const issuedAt = nowIso();
  const expiresAt = new Date(Date.now() + apiConfig.nonceTtlMinutes * 60_000).toISOString();
  const message = buildWalletSignInMessage({
    address: normalizedAddress,
    nonce,
    expiresAt
  });

  await run(
    `
      INSERT INTO auth_nonces (address, nonce, issued_at, expires_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(address) DO UPDATE SET
        nonce = excluded.nonce,
        issued_at = excluded.issued_at,
        expires_at = excluded.expires_at
    `,
    [normalizedAddress, nonce, issuedAt, expiresAt]
  );

  return {
    address: normalizedAddress,
    nonce,
    message,
    expiresAt
  };
}

export async function verifySignatureAndCreateSession({ address, signature, userAgent = '' }) {
  const normalizedAddress = normalizeAddress(address);
  if (!normalizedAddress) {
    throw new Error('A valid wallet address is required.');
  }

  const nonceRecord = await get(
    `
      SELECT nonce, expires_at
      FROM auth_nonces
      WHERE address = ? AND expires_at > ?
      LIMIT 1
    `,
    [normalizedAddress, nowIso()]
  );

  if (!nonceRecord?.nonce) {
    throw new Error('Wallet sign-in challenge expired. Try posting again.');
  }

  const valid = await verifyMessage({
    address: normalizedAddress,
    message: buildWalletSignInMessage({
      address: normalizedAddress,
      nonce: nonceRecord.nonce,
      expiresAt: nonceRecord.expires_at
    }),
    signature
  });

  if (!valid) {
    throw new Error('Wallet signature could not be verified.');
  }

  const sessionId = crypto.randomUUID();
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + apiConfig.sessionTtlHours * 60 * 60_000).toISOString();

  await run(`DELETE FROM auth_nonces WHERE address = ?`, [normalizedAddress]);
  await run(
    `
      INSERT INTO sessions (session_id, address, created_at, expires_at, user_agent)
      VALUES (?, ?, ?, ?, ?)
    `,
    [sessionId, normalizedAddress, createdAt, expiresAt, String(userAgent || '').slice(0, 500)]
  );

  return {
    sessionId,
    address: normalizedAddress,
    expiresAt
  };
}

export async function destroySession(sessionId) {
  const normalizedSessionId = String(sessionId || '').trim();
  if (!normalizedSessionId || normalizedSessionId.includes('.')) {
    return;
  }

  await run(`DELETE FROM sessions WHERE session_id = ?`, [normalizedSessionId]);
}
