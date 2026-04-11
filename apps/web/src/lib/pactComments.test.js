import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const signWalletMessage = vi.fn();

vi.mock('./wallet.js', () => ({
  signWalletMessage
}));

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}

describe('shared pact chat API', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    signWalletMessage.mockReset();
    signWalletMessage.mockResolvedValue('0xsigned');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps a persisted pact thread from the backend payload', async () => {
    global.fetch.mockResolvedValueOnce(
      jsonResponse({
        requiresParticipantAccess: false,
        messages: [
          {
            id: 'msg-1',
            author_address: '0xabc',
            body: 'Locked in for tonight.',
            created_at: '2026-03-28T10:00:00.000Z'
          }
        ]
      })
    );

    const { readPactCommentThread } = await import('./pactComments.js');
    await expect(readPactCommentThread(4, '0xabc')).resolves.toEqual({
      requiresParticipantAccess: false,
      messages: [
        {
          id: 'msg-1',
          authorAddress: '0xabc',
          message: 'Locked in for tonight.',
          createdAt: '2026-03-28T10:00:00.000Z'
        }
      ]
    });
  });

  it('posts a shared chat message through a wallet-backed session', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse({ authenticated: false }))
      .mockResolvedValueOnce(
        jsonResponse({
          message: 'Sign this message to verify your wallet for StakeWithFriends chat.'
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          authenticated: true,
          address: '0xabc'
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          authenticated: true,
          address: '0xabc'
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            message: {
              id: 'msg-2',
              author_address: '0xabc',
              body: 'See you there.',
              created_at: '2026-03-28T10:15:00.000Z'
            }
          },
          201
        )
      );

    const { appendPactComment } = await import('./pactComments.js');
    await expect(
      appendPactComment({
        pactId: 9,
        address: '0xAbC',
        message: 'See you there.'
      })
    ).resolves.toEqual({
      id: 'msg-2',
      authorAddress: '0xabc',
      message: 'See you there.',
      createdAt: '2026-03-28T10:15:00.000Z'
    });

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      '/api/auth/session',
      expect.objectContaining({
        credentials: 'include'
      })
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      '/api/auth/nonce',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          address: '0xabc'
        })
      })
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      3,
      '/api/auth/verify',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          address: '0xabc',
          signature: '0xsigned'
        })
      })
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      4,
      '/api/auth/session',
      expect.objectContaining({
        credentials: 'include'
      })
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      5,
      '/api/pacts/9/messages',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          body: 'See you there.'
        })
      })
    );
  });

  it('refreshes the wallet session once if the backend rejects a stale chat session', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse({ authenticated: true, address: '0xabc' }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: 'A connected wallet address is required to post in pact chat.'
          },
          401
        )
      )
      .mockResolvedValueOnce(
        jsonResponse({
          message: 'Sign this message to verify your wallet for StakeWithFriends chat.'
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          authenticated: true,
          address: '0xabc'
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          authenticated: true,
          address: '0xabc'
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            message: {
              id: 'msg-3',
              author_address: '0xabc',
              body: 'Retry worked.',
              created_at: '2026-03-28T10:20:00.000Z'
            }
          },
          201
        )
      );

    const { appendPactComment } = await import('./pactComments.js');
    await expect(
      appendPactComment({
        pactId: 9,
        address: '0xabc',
        message: 'Retry worked.'
      })
    ).resolves.toEqual({
      id: 'msg-3',
      authorAddress: '0xabc',
      message: 'Retry worked.',
      createdAt: '2026-03-28T10:20:00.000Z'
    });

    expect(signWalletMessage).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenNthCalledWith(
      6,
      '/api/pacts/9/messages',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          body: 'Retry worked.'
        })
      })
    );
  });

  it('treats forbidden pact threads as participant-only access without surfacing a hard error', async () => {
    global.fetch.mockResolvedValueOnce(
      jsonResponse(
        {
          error: 'Pact participant or arbiter access is required.',
          requiresParticipantAccess: true,
          messages: []
        },
        403
      )
    );

    const { readPactCommentThread } = await import('./pactComments.js');
    await expect(readPactCommentThread(4, '0xdef')).resolves.toEqual({
      requiresParticipantAccess: true,
      messages: []
    });
  });
});
