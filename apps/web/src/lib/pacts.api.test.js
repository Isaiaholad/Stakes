import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ensureWalletSession = vi.fn();

vi.mock('./authSession.js', () => ({
  ensureWalletSession
}));

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}

function applyProtocolEnv() {
  vi.stubEnv('VITE_STABLECOIN_ADDRESS', '0x00000000000000000000000000000000000000a1');
  vi.stubEnv('VITE_PROTOCOL_CONTROL_ADDRESS', '0x00000000000000000000000000000000000000a2');
  vi.stubEnv('VITE_PACT_VAULT_ADDRESS', '0x00000000000000000000000000000000000000a3');
  vi.stubEnv('VITE_PACT_MANAGER_ADDRESS', '0x00000000000000000000000000000000000000a4');
  vi.stubEnv('VITE_SUBMISSION_MANAGER_ADDRESS', '0x00000000000000000000000000000000000000a5');
  vi.stubEnv('VITE_PACT_RESOLUTION_MANAGER_ADDRESS', '0x00000000000000000000000000000000000000a6');
}

async function loadPactsModule() {
  applyProtocolEnv();
  vi.resetModules();
  return import('./pacts.js');
}

const apiReadTestTimeoutMs = 15_000;

describe('indexed pact API reads', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    ensureWalletSession.mockReset();
    ensureWalletSession.mockResolvedValue({ authenticated: true, address: '0xabc' });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('reads dashboard, open feed, pact detail, and admin queue from the indexed API', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse({ pacts: [{ id: 7, stage: 'Completed', participantRole: 'creator' }] }))
      .mockResolvedValueOnce(jsonResponse({ pacts: [{ id: 8, stage: 'Open For Join' }] }))
      .mockResolvedValueOnce(jsonResponse({ pact: { id: 7, stage: 'Completed' } }))
      .mockResolvedValueOnce(jsonResponse({ protocol: { isAdmin: true }, pacts: [{ id: 5 }] }));

    const {
      readAdminQueue,
      readAllPacts,
      readLeaderboard,
      readOpenPacts,
      readPactById,
      readPactGameMetadata,
      storePactGameMetadata
    } = await loadPactsModule();

    await expect(readAllPacts('0xabc', { limit: 12 })).resolves.toEqual([
      { id: 7, stage: 'Completed', participantRole: 'creator' }
    ]);
    await expect(readOpenPacts('0xabc', { limit: 18 })).resolves.toEqual([{ id: 8, stage: 'Open For Join' }]);
    await expect(readPactById(7, '0xabc')).resolves.toEqual({ id: 7, stage: 'Completed' });
    await expect(readAdminQueue('0xabc', { limit: 50 })).resolves.toEqual({
      protocol: { isAdmin: true },
      pacts: [{ id: 5 }]
    });
    global.fetch.mockResolvedValueOnce(
      jsonResponse({
        leaderboard: [{ rank: 1, address: '0xabc', displayName: '@alpha', points: 90 }],
        availableGames: ['eFootball'],
        pointsModel: 'balanced-xp-v1',
        updatedAt: '2026-05-19T00:00:00.000Z',
        viewerRank: { rank: 1, address: '0xabc', displayName: '@alpha', points: 90 }
      })
    );
    await expect(readLeaderboard({ game: 'all', limit: 50, address: '0xabc' })).resolves.toMatchObject({
      leaderboard: [{ rank: 1, address: '0xabc', displayName: '@alpha', points: 90 }],
      availableGames: ['eFootball'],
      pointsModel: 'balanced-xp-v1',
      updatedAt: '2026-05-19T00:00:00.000Z',
      viewerRank: { rank: 1, address: '0xabc', displayName: '@alpha', points: 90 }
    });
    global.fetch
      .mockResolvedValueOnce(jsonResponse({ metadata: { pactId: 7, platform: 'chess.com' } }))
      .mockResolvedValueOnce(jsonResponse({ metadata: { pactId: 7, creatorPlatformUsername: 'KOLADEKKT' } }));
    await expect(readPactGameMetadata(7)).resolves.toEqual({ pactId: 7, platform: 'chess.com' });
    await expect(
      storePactGameMetadata(7, {
        address: '0xabc',
        platform: 'lichess',
        chessUsername: 'KOLADEKKT',
        chessColor: 'White'
      })
    ).resolves.toEqual({ pactId: 7, creatorPlatformUsername: 'KOLADEKKT' });
    expect(ensureWalletSession).toHaveBeenCalledWith('0xabc', 'Connect your wallet before opening the admin queue.');

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      '/api/dashboard?address=0xabc&limit=12',
      expect.objectContaining({ credentials: 'include' })
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      '/api/pacts/open?address=0xabc&limit=18',
      expect.objectContaining({ credentials: 'include' })
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      3,
      '/api/pacts/7?address=0xabc',
      expect.objectContaining({ credentials: 'include' })
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      4,
      '/api/admin/queue?address=0xabc&limit=50',
      expect.objectContaining({ credentials: 'include' })
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      5,
      '/api/leaderboard?game=all&limit=50&address=0xabc',
      expect.objectContaining({ credentials: 'include' })
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      6,
      '/api/pacts/7/game-metadata',
      expect.objectContaining({ credentials: 'include' })
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      7,
      '/api/pacts/7/game-metadata',
      expect.objectContaining({
        credentials: 'include',
        method: 'POST',
        body: JSON.stringify({
          address: '0xabc',
          platform: 'lichess',
          chessUsername: 'KOLADEKKT',
          chessColor: 'White'
        })
      })
    );
  }, apiReadTestTimeoutMs);

  it('returns a degraded leaderboard payload when the indexed ranking API is unavailable', async () => {
    global.fetch.mockRejectedValueOnce(new Error('leaderboard backend offline'));

    const { readLeaderboard } = await loadPactsModule();
    const result = await readLeaderboard({ game: 'all', limit: 50, address: '0xabc' });

    expect(result).toMatchObject({
      leaderboard: [],
      availableGames: [],
      pointsModel: 'balanced-xp-v1',
      viewerRank: null,
      unavailable: true,
      errorMessage: 'leaderboard backend offline'
    });
    expect(result.__readMeta).toMatchObject({
      source: 'degraded',
      message: 'leaderboard backend offline'
    });
  });

  it('treats a soft-unavailable leaderboard response as degraded data', async () => {
    global.fetch.mockResolvedValueOnce(
      jsonResponse({
        leaderboard: [],
        availableGames: [],
        pointsModel: 'balanced-xp-v1',
        viewerRank: null,
        unavailable: true,
        error: 'The indexed leaderboard is temporarily unavailable.'
      })
    );

    const { readLeaderboard } = await loadPactsModule();
    const result = await readLeaderboard({ game: 'all', limit: 50, address: '0xabc' });

    expect(result).toMatchObject({
      leaderboard: [],
      unavailable: true,
      errorMessage: 'The indexed leaderboard is temporarily unavailable.'
    });
    expect(result.__readMeta).toMatchObject({
      source: 'degraded',
      message: 'The indexed leaderboard is temporarily unavailable.'
    });
  });

  it('keeps a just-created open pact visible while the indexed API catches up', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse({ pacts: [] }))
      .mockResolvedValueOnce(jsonResponse({ pacts: [] }));

    const { __resetPendingIndexPactsForTests, readAllPacts, readOpenPacts, rememberCreatedPactPendingIndex } =
      await loadPactsModule();

    rememberCreatedPactPendingIndex(null, {
      account: '0xabc',
      pactId: 11,
      title: 'Chess Match Pact',
      description: 'Winner takes the escrow.',
      counterparty: '',
      eventDurationSeconds: 3600,
      declarationWindowSeconds: 1200,
      stakeAmount: '10'
    });

    await expect(readAllPacts('0xabc', { limit: 12 })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 11,
          isPendingIndex: true,
          participantRole: 'creator'
        })
      ])
    );

    await expect(readOpenPacts('', { limit: 18 })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 11,
          isPendingIndex: true,
          participantRole: 'viewer',
          stage: 'Open For Join'
        })
      ])
    );

    __resetPendingIndexPactsForTests();
  }, apiReadTestTimeoutMs);
});
