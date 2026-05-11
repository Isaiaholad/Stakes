import { fetchJson, setGlobalAuthToken } from './api.js';
import { getAccessToken } from '@privy-io/react-auth';
import { signWalletMessage } from './wallet.js';

function normalizeAddress(value) {
  return String(value || '').toLowerCase();
}

function clearStoredAuthToken() {
  setGlobalAuthToken('');
  if (typeof window !== 'undefined') {
    window.localStorage?.removeItem('swf_session_id');
  }
}

async function readWalletSessionOrNull() {
  try {
    return await readWalletSession();
  } catch (error) {
    if (Number(error?.status || 0) === 401) {
      clearStoredAuthToken();
      return null;
    }

    throw error;
  }
}

export async function readWalletSession() {
  return fetchJson('/auth/session');
}

async function createWalletSession(normalizedAddress, options = {}) {
  const accessToken = await getAccessToken().catch(() => '');
  if (accessToken) {
    setGlobalAuthToken(accessToken);
    if (typeof window !== 'undefined') {
      window.localStorage?.setItem('swf_session_id', accessToken);
    }

    let session = await readWalletSessionOrNull();
    if (!session?.authenticated || normalizeAddress(session.address) !== normalizedAddress) {
      const refreshedAccessToken = await getAccessToken().catch(() => '');
      if (refreshedAccessToken) {
        setGlobalAuthToken(refreshedAccessToken);
        if (typeof window !== 'undefined') {
          window.localStorage?.setItem('swf_session_id', refreshedAccessToken);
        }
      }
      session = await readWalletSessionOrNull();
    }

    if (session?.authenticated && normalizeAddress(session.address) === normalizedAddress) {
      return session;
    }
  }

  return await createSignedWalletSession(normalizedAddress, options);
}

async function createSignedWalletSession(normalizedAddress) {
  const challenge = await fetchJson('/auth/nonce', {
    method: 'POST',
    body: JSON.stringify({
      address: normalizedAddress
    })
  });
  const signature = await signWalletMessage(normalizedAddress, challenge.message);
  const session = await fetchJson('/auth/verify', {
    method: 'POST',
    body: JSON.stringify({
      address: normalizedAddress,
      signature
    })
  });

  if (!session?.authenticated || normalizeAddress(session.address) !== normalizedAddress || !session.sessionId) {
    throw new Error('Wallet sign-in could not be verified. Try reconnecting your wallet.');
  }

  setGlobalAuthToken(session.sessionId);
  if (typeof window !== 'undefined') {
    window.localStorage?.setItem('swf_session_id', session.sessionId);
  }
  return session;
}

export async function ensureWalletSession(
  address,
  errorMessage = 'Connect your wallet before continuing.',
  options = {}
) {
  const normalizedAddress = normalizeAddress(address);
  if (!normalizedAddress) {
    throw new Error(errorMessage);
  }

  if (options.forceRefresh) {
    return createWalletSession(normalizedAddress, options);
  }

  const currentSession = await readWalletSessionOrNull();
  if (currentSession?.authenticated && normalizeAddress(currentSession.address) === normalizedAddress) {
    return currentSession;
  }

  return createWalletSession(normalizedAddress, options);
}
