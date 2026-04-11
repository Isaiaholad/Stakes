import { fetchJson } from './api.js';
import { ensureWalletSession } from './authSession.js';

const maxCommentLength = 280;

export function getMaxPactCommentLength() {
  return maxCommentLength;
}

export async function readPactCommentThread(pactId, address) {
  if (!pactId) {
    return {
      messages: [],
      requiresParticipantAccess: false
    };
  }

  const query = address ? `?address=${encodeURIComponent(address)}` : '';
  let payload;
  try {
    payload = await fetchJson(`/pacts/${pactId}/messages${query}`);
  } catch (error) {
    if (Number(error?.status || 0) === 403) {
      return {
        messages: [],
        requiresParticipantAccess: true
      };
    }

    throw error;
  }

  return {
    requiresParticipantAccess: Boolean(payload.requiresParticipantAccess),
    messages: Array.isArray(payload.messages)
      ? payload.messages.map((message) => ({
          id: message.id,
          authorAddress: message.author_address,
          message: message.body,
          createdAt: message.created_at
        }))
      : []
  };
}

export async function readPactComments(pactId, address) {
  const payload = await readPactCommentThread(pactId, address);
  return payload.messages;
}

export async function appendPactComment({ pactId, address, message }) {
  const trimmedMessage = String(message || '').trim().slice(0, maxCommentLength);
  if (!pactId || !address || !trimmedMessage) {
    throw new Error('A connected wallet and comment message are required.');
  }

  await ensureWalletSession(address, 'Connect your wallet before posting to pact chat.');
  let payload;
  try {
    payload = await fetchJson(`/pacts/${pactId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        body: trimmedMessage
      })
    });
  } catch (error) {
    const shouldRetrySession =
      Number(error?.status || 0) === 401 ||
      /connected wallet address is required to post in pact chat/i.test(String(error?.message || '')) ||
      /sign a wallet message before posting to pact chat/i.test(String(error?.message || ''));

    if (!shouldRetrySession) {
      throw error;
    }

    await ensureWalletSession(address, 'Connect your wallet before posting to pact chat.', {
      forceRefresh: true
    });
    payload = await fetchJson(`/pacts/${pactId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        body: trimmedMessage
      })
    });
  }

  return {
    id: payload.message.id,
    authorAddress: payload.message.author_address,
    message: payload.message.body,
    createdAt: payload.message.created_at
  };
}
