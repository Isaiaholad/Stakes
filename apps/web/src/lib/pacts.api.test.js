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
      .mockResolvedValueOnce(jsonResponse({ pacts: [{ id: 7, stage: 'Completed' }] }))
      .mockResolvedValueOnce(jsonResponse({ pacts: [{ id: 8, stage: 'Open For Join' }] }))
      .mockResolvedValueOnce(jsonResponse({ pact: { id: 7, stage: 'Completed' } }))
      .mockResolvedValueOnce(jsonResponse({ protocol: { isAdmin: true }, pacts: [{ id: 5 }] }));

    const { readAdminQueue, readAllPacts, readOpenPacts, readPactById } = await loadPactsModule();

    await expect(readAllPacts('0xabc', { limit: 12 })).resolves.toEqual([{ id: 7, stage: 'Completed' }]);
    await expect(readOpenPacts('0xabc', { limit: 18 })).resolves.toEqual([{ id: 8, stage: 'Open For Join' }]);
    await expect(readPactById(7, '0xabc')).resolves.toEqual({ id: 7, stage: 'Completed' });
    await expect(readAdminQueue('0xabc', { limit: 50 })).resolves.toEqual({
      protocol: { isAdmin: true },
      pacts: [{ id: 5 }]
    });
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
  }, apiReadTestTimeoutMs);

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
