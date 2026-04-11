import { fetchJson } from './api.js';
import { signWalletMessage } from './wallet.js';

function normalizeAddress(value) {
  return String(value || '').toLowerCase();
}

export async function readWalletSession() {
  return fetchJson('/auth/session');
}

async function createWalletSession(normalizedAddress) {
  const challenge = await fetchJson('/auth/nonce', {
    method: 'POST',
    body: JSON.stringify({ address: normalizedAddress })
  });
  const signature = await signWalletMessage(normalizedAddress, challenge.message);

  await fetchJson('/auth/verify', {
    method: 'POST',
    body: JSON.stringify({
      address: normalizedAddress,
      signature
    })
  });

  const session = await readWalletSession();
  if (!session.authenticated || normalizeAddress(session.address) !== normalizedAddress) {
    throw new Error('Wallet session could not be saved on this device. Try signing in again.');
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
    return createWalletSession(normalizedAddress);
  }

  const currentSession = await readWalletSession();
  if (currentSession.authenticated && normalizeAddress(currentSession.address) === normalizedAddress) {
    return currentSession;
  }

  return createWalletSession(normalizedAddress);
}
