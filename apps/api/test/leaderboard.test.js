import assert from 'node:assert/strict';
import { test } from 'node:test';
import { zeroAddress } from 'viem';

process.env.CORE_SYNC_MODE = 'log-backfill';
process.env.USERNAME_SYNC_MODE = 'log-backfill';
process.env.STORAGE_MODE = 'supabase-s3';
process.env.STABLECOIN_ADDRESS = '0x00000000000000000000000000000000000000a1';
process.env.PROTOCOL_CONTROL_ADDRESS = '0x00000000000000000000000000000000000000a2';
process.env.PACT_VAULT_ADDRESS = '0x00000000000000000000000000000000000000a3';
process.env.PACT_MANAGER_ADDRESS = '0x00000000000000000000000000000000000000a4';
process.env.SUBMISSION_MANAGER_ADDRESS = '0x00000000000000000000000000000000000000a5';
process.env.PACT_RESOLUTION_MANAGER_ADDRESS = '0x00000000000000000000000000000000000000a6';
process.env.USERNAME_REGISTRY_ADDRESS = '0x00000000000000000000000000000000000000a7';

const { buildLeaderboardPayload } = await import('../src/pacts.js');

const alpha = '0x0000000000000000000000000000000000000a11';
const beta = '0x0000000000000000000000000000000000000b22';
const gamma = '0x0000000000000000000000000000000000000c33';

function resolvedPact({
  pactId,
  creatorAddress = alpha,
  counterpartyAddress = beta,
  eventType = 'eFootball',
  stakeAmount = '1000000',
  winnerAddress = alpha,
  updatedAt = `2026-01-${String(pactId).padStart(2, '0')}T00:00:00.000Z`
}) {
  return {
    pact_id: pactId,
    creator_address: creatorAddress.toLowerCase(),
    counterparty_address: counterpartyAddress.toLowerCase(),
    event_type: eventType,
    stake_amount: stakeAmount,
    winner_address: winnerAddress.toLowerCase(),
    created_at: updatedAt,
    updated_at: updatedAt
  };
}

test('buildLeaderboardPayload computes balanced XP, evidence bonuses, streak cap, and username fallback', () => {
  const rows = [
    resolvedPact({ pactId: 1, creatorAddress: alpha, counterpartyAddress: beta, winnerAddress: alpha }),
    resolvedPact({
      pactId: 2,
      creatorAddress: alpha,
      counterpartyAddress: gamma,
      eventType: 'Chess',
      winnerAddress: zeroAddress
    }),
    resolvedPact({ pactId: 3, creatorAddress: alpha, counterpartyAddress: gamma, winnerAddress: alpha }),
    resolvedPact({ pactId: 4, creatorAddress: beta, counterpartyAddress: alpha, winnerAddress: alpha }),
    resolvedPact({ pactId: 5, creatorAddress: gamma, counterpartyAddress: alpha, winnerAddress: alpha }),
    resolvedPact({ pactId: 6, creatorAddress: alpha, counterpartyAddress: beta, winnerAddress: alpha }),
    resolvedPact({ pactId: 7, creatorAddress: alpha, counterpartyAddress: gamma, winnerAddress: alpha }),
    resolvedPact({ pactId: 8, creatorAddress: beta, counterpartyAddress: alpha, winnerAddress: alpha })
  ];
  const evidencePairs = new Set([`1:${alpha.toLowerCase()}`, `2:${alpha.toLowerCase()}`, `8:${beta.toLowerCase()}`]);
  const usernameMap = new Map([[alpha.toLowerCase(), 'alpha']]);
  const overall = buildLeaderboardPayload({
    rows,
    evidencePairs,
    usernameMap,
    game: 'all',
    limit: 50,
    viewerAddress: alpha,
    updatedAt: '2026-05-19T00:00:00.000Z'
  });
  const alphaRank = overall.leaderboard.find((entry) => entry.address === alpha.toLowerCase());
  const betaRank = overall.leaderboard.find((entry) => entry.address === beta.toLowerCase());

  assert.deepEqual(overall.availableGames, ['eFootball', 'Chess']);
  assert.equal(overall.pointsModel, 'balanced-xp-v1');
  assert.equal(alphaRank.rank, 1);
  assert.equal(alphaRank.username, 'alpha');
  assert.equal(alphaRank.displayName, '@alpha');
  assert.equal(alphaRank.matches, 8);
  assert.equal(alphaRank.wins, 7);
  assert.equal(alphaRank.losses, 0);
  assert.equal(alphaRank.splits, 1);
  assert.equal(alphaRank.evidenceCount, 2);
  assert.equal(alphaRank.currentStreak, 6);
  assert.equal(alphaRank.points, 660);
  assert.equal(overall.viewerRank.address, alpha.toLowerCase());
  assert.match(betaRank.displayName, /^0x0000\.\.\./);

  const efootball = buildLeaderboardPayload({
    rows,
    evidencePairs,
    usernameMap,
    game: 'eFootball',
    limit: 50,
    updatedAt: '2026-05-19T00:00:00.000Z'
  });
  const alphaEfootballRank = efootball.leaderboard.find((entry) => entry.address === alpha.toLowerCase());

  assert.equal(alphaEfootballRank.matches, 7);
  assert.equal(alphaEfootballRank.splits, 0);
  assert.equal(alphaEfootballRank.evidenceCount, 1);
  assert.equal(alphaEfootballRank.points, 620);
});
