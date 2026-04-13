import { fetchJson } from './api.js';
import { signWalletMessage } from './wallet.js';

function normalizeAddress(value) {
  return String(value || '').toLowerCase();
}

export async function readWalletSession() {
  return fetchJson('/auth/session');
}

async function createWalletSession(normalizedAddress, options = {}) {
  const challenge = await fetchJson('/auth/nonce', {
    method: 'POST',
    body: JSON.stringify({ address: normalizedAddress })
  });
  const signature = await signWalletMessage(normalizedAddress, challenge.message);

  const verifyPayload = await fetchJson('/auth/verify', {
    method: 'POST',
    body: JSON.stringify({
      address: normalizedAddress,
      signature
    })
  });
  if (verifyPayload?.sessionId && typeof window !== 'undefined') {
    window.localStorage?.setItem('swf_session_id', verifyPayload.sessionId);
  }

  let session = await readWalletSession();
  if (!session.authenticated || normalizeAddress(session.address) !== normalizedAddress) {
    // Give the browser a brief moment to persist the Set-Cookie header.
    await new Promise((resolve) => setTimeout(resolve, 120));
    session = await readWalletSession();
  }

  if (!session.authenticated || normalizeAddress(session.address) !== normalizedAddress) {
    if (options.allowUnauthenticated) {
      return {
        authenticated: false,
        address: normalizedAddress
      };
    }
    throw new Error('This browser did not keep the chat sign-in session. Allow cookies for this site, then try again.');
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

  const currentSession = await readWalletSession();
  if (currentSession.authenticated && normalizeAddress(currentSession.address) === normalizedAddress) {
    return currentSession;
  }

  return createWalletSession(normalizedAddress, options);
}
