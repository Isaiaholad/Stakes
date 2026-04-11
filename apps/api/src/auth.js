import crypto from 'node:crypto';
import { verifyMessage } from 'viem';
import { apiConfig, isAddressConfigured } from './config.js';
import { cleanupExpiredAuthRecords, get, nowIso, run } from './db.js';

const sessionCookieName = 'swf_session';

function normalizeAddress(value) {
  return String(value || '').toLowerCase();
}

function buildChallengeMessage(address, nonce) {
  return [`StakeWithFriends login`, '', `Address: ${address}`, `Nonce: ${nonce}`].join('\n');
}

function addHours(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function addMinutes(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function parseCookies(cookieHeader = '') {
  return String(cookieHeader)
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((accumulator, entry) => {
      const separatorIndex = entry.indexOf('=');
      if (separatorIndex === -1) {
        return accumulator;
      }

      const key = entry.slice(0, separatorIndex);
      const value = decodeURIComponent(entry.slice(separatorIndex + 1));
      accumulator[key] = value;
      return accumulator;
    }, {});
}

export function createSessionCookie(sessionId, expiresAt, secure = apiConfig.sessionCookieSecure) {
  const secureFlag = secure ? '; Secure' : '';
  return `${sessionCookieName}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax${secureFlag}; Expires=${new Date(
    expiresAt
  ).toUTCString()}`;
}

export function clearSessionCookie(secure = apiConfig.sessionCookieSecure) {
  const secureFlag = secure ? '; Secure' : '';
  return `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax${secureFlag}; Expires=${new Date(0).toUTCString()}`;
}

export async function createNonceChallenge(address) {
  if (!isAddressConfigured(address)) {
    throw new Error('A valid wallet address is required.');
  }

  cleanupExpiredAuthRecords();
  const normalizedAddress = normalizeAddress(address);
  const nonce = crypto.randomUUID();
  const issuedAt = nowIso();
  const expiresAt = addMinutes(apiConfig.nonceTtlMinutes);

  run(
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
    issuedAt,
    expiresAt,
    message: buildChallengeMessage(normalizedAddress, nonce)
  };
}

export async function verifySignatureAndCreateSession({ address, signature, userAgent = '' }) {
  cleanupExpiredAuthRecords();

  if (!isAddressConfigured(address)) {
    throw new Error('A valid wallet address is required.');
  }

  if (!signature) {
    throw new Error('A signed wallet message is required.');
  }

  const normalizedAddress = normalizeAddress(address);
  const nonceRecord = get(`SELECT * FROM auth_nonces WHERE address = ?`, [normalizedAddress]);

  if (!nonceRecord) {
    throw new Error('No active login challenge found. Request a new nonce and try again.');
  }

  if (new Date(nonceRecord.expires_at).getTime() <= Date.now()) {
    run(`DELETE FROM auth_nonces WHERE address = ?`, [normalizedAddress]);
    throw new Error('The login challenge expired. Request a new nonce and try again.');
  }

  const message = buildChallengeMessage(normalizedAddress, nonceRecord.nonce);
  const verified = await verifyMessage({
    address: normalizedAddress,
    message,
    signature
  });

  if (!verified) {
    throw new Error('Wallet signature verification failed.');
  }

  const sessionId = crypto.randomUUID();
  const createdAt = nowIso();
  const expiresAt = addHours(apiConfig.sessionTtlHours);

  run(`DELETE FROM auth_nonces WHERE address = ?`, [normalizedAddress]);
  run(
    `
      INSERT INTO sessions (session_id, address, created_at, expires_at, user_agent)
      VALUES (?, ?, ?, ?, ?)
    `,
    [sessionId, normalizedAddress, createdAt, expiresAt, String(userAgent || '').slice(0, 255)]
  );

  return {
    sessionId,
    address: normalizedAddress,
    createdAt,
    expiresAt
  };
}

export function destroySession(sessionId) {
  if (!sessionId) {
    return;
  }

  run(`DELETE FROM sessions WHERE session_id = ?`, [sessionId]);
}

export function getSessionFromRequest(request) {
  cleanupExpiredAuthRecords();
  const cookies = parseCookies(request.headers.cookie || '');
  const sessionId = cookies[sessionCookieName];

  if (!sessionId) {
    return null;
  }

  const session = get(`SELECT * FROM sessions WHERE session_id = ?`, [sessionId]);
  if (!session) {
    return null;
  }

  if (new Date(session.expires_at).getTime() <= Date.now()) {
    destroySession(sessionId);
    return null;
  }

  return session;
}
