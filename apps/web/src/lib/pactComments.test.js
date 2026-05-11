import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getAccessToken = vi.fn();
const signWalletMessage = vi.fn();

vi.mock('@privy-io/react-auth', () => ({
  getAccessToken
}));

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
    vi.resetModules();
    global.fetch = vi.fn();
    window.localStorage.clear();
    getAccessToken.mockReset();
    getAccessToken.mockResolvedValue('privy-token');
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
      '/api/auth/session',
      expect.objectContaining({
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer privy-token'
        })
      })
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      3,
      '/api/pacts/9/messages',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer privy-token'
        }),
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

    expect(getAccessToken).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenNthCalledWith(
      4,
      '/api/pacts/9/messages',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer privy-token'
        }),
        body: JSON.stringify({
          body: 'Retry worked.'
        })
      })
    );
  });

  it('falls back to a connected wallet signature when Privy is not available', async () => {
    getAccessToken.mockResolvedValue('');
    global.fetch
      .mockResolvedValueOnce(jsonResponse({ authenticated: false }))
      .mockResolvedValueOnce(
        jsonResponse({
          address: '0xabc',
          nonce: 'nonce-1',
          message: 'Sign in to StakeWithFriends.',
          expiresAt: '2026-03-28T10:10:00.000Z'
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          authenticated: true,
          address: '0xabc',
          expiresAt: '2026-03-28T10:10:00.000Z',
          sessionId: 'wallet-session'
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            message: {
              id: 'msg-4',
              author_address: '0xabc',
              body: 'Wallet signed.',
              created_at: '2026-03-28T10:25:00.000Z'
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
        message: 'Wallet signed.'
      })
    ).resolves.toEqual({
      id: 'msg-4',
      authorAddress: '0xabc',
      message: 'Wallet signed.',
      createdAt: '2026-03-28T10:25:00.000Z'
    });

    expect(signWalletMessage).toHaveBeenCalledWith('0xabc', 'Sign in to StakeWithFriends.');
    expect(global.fetch).toHaveBeenNthCalledWith(
      4,
      '/api/pacts/9/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer wallet-session'
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
