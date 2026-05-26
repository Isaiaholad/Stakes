import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { beforeEach, test } from 'node:test';
import { encodeAbiParameters, encodeEventTopics, zeroAddress } from 'viem';

const addresses = {
  stablecoin: '0x00000000000000000000000000000000000000a1',
  protocolControl: '0x00000000000000000000000000000000000000a2',
  pactVault: '0x00000000000000000000000000000000000000a3',
  pactManager: '0x00000000000000000000000000000000000000a4',
  submissionManager: '0x00000000000000000000000000000000000000a5',
  pactResolutionManager: '0x00000000000000000000000000000000000000a6',
  usernameRegistry: '0x00000000000000000000000000000000000000a7'
};

const creator = '0x00000000000000000000000000000000000000c1';
const counterparty = '0x00000000000000000000000000000000000000c2';
const outsider = '0x00000000000000000000000000000000000000c3';
const admin = '0x00000000000000000000000000000000000000c4';

process.env.CORE_SYNC_MODE = 'log-backfill';
process.env.USERNAME_SYNC_MODE = 'log-backfill';
process.env.PACT_INDEX_START_BLOCK = '100';
process.env.USERNAME_INDEX_START_BLOCK = '200';
process.env.STORAGE_MODE = 'supabase-s3';
process.env.STABLECOIN_ADDRESS = addresses.stablecoin;
process.env.PROTOCOL_CONTROL_ADDRESS = addresses.protocolControl;
process.env.PACT_VAULT_ADDRESS = addresses.pactVault;
process.env.PACT_MANAGER_ADDRESS = addresses.pactManager;
process.env.SUBMISSION_MANAGER_ADDRESS = addresses.submissionManager;
process.env.PACT_RESOLUTION_MANAGER_ADDRESS = addresses.pactResolutionManager;
process.env.USERNAME_REGISTRY_ADDRESS = addresses.usernameRegistry;

const db = await import('../src/db.js');
const indexer = await import('../src/indexer.js');
const chain = await import('../src/chain.js');
const pacts = await import('../src/pacts.js');
const zeroHash = `0x${'00'.repeat(32)}`;
const testChainIdBase = 90_000_000 + (process.pid % 100_000);
let runtimeSequence = 0;
const allowDestructiveDbTests = process.env.ALLOW_DESTRUCTIVE_DB_TESTS === '1';
const dbTest = allowDestructiveDbTests ? test : test.skip;

function makeHash(byte) {
  return `0x${String(byte).padStart(2, '0').repeat(32)}`;
}

function makeAddress(value) {
  return `0x${BigInt(value).toString(16).padStart(40, '0')}`;
}

function buildLog({ abi, eventName, args, address, blockNumber, blockHash, txHash, logIndex }) {
  const eventAbi = abi.find((entry) => entry.type === 'event' && entry.name === eventName);
  const nonIndexedInputs = (eventAbi?.inputs || []).filter((input) => !input.indexed);
  const encoded = {
    topics: encodeEventTopics({
      abi: [eventAbi],
      eventName,
      args
    }),
    data: nonIndexedInputs.length
      ? encodeAbiParameters(
          nonIndexedInputs.map((input) => ({
            name: input.name,
            type: input.type
          })),
          nonIndexedInputs.map((input) => args[input.name])
        )
      : '0x'
  };

  return {
    address,
    blockNumber: BigInt(blockNumber),
    blockHash,
    transactionHash: txHash,
    logIndex,
    data: encoded.data,
    topics: encoded.topics
  };
}

function buildTestDeploymentKey(syncKey, runtimeAddresses = addresses, chainId = testChainIdBase) {
  const addressKeys =
    syncKey === 'usernames'
      ? ['usernameRegistry']
      : ['stablecoin', 'protocolControl', 'pactVault', 'pactManager', 'submissionManager', 'pactResolutionManager'];
  const scopedAddresses = Object.fromEntries(
    addressKeys.map((key) => [key, String(runtimeAddresses[key] || '').toLowerCase()])
  );

  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        syncKey,
        chainId,
        addresses: scopedAddresses
      })
    )
    .digest('hex');
}

function createRuntime({ logsByAddress = {}, latestBlockNumber = 0, blockHashes = {}, blockTimestamps = {}, chainId } = {}) {
  const runtimeChainId = Number(chainId || testChainIdBase + ++runtimeSequence);

  return {
    chainId: runtimeChainId,
    addresses,
    coreSyncMode: 'log-backfill',
    usernameSyncMode: 'log-backfill',
    contractStartBlocks: {
      core: 100n,
      usernames: 200n
    },
    hasCoreContractsConfigured: () => true,
    hasUsernameRegistryConfigured: () => true,
    publicClient: {
      async getLogs({ address, fromBlock, toBlock }) {
        return (logsByAddress[address] || []).filter(
          (log) => Number(log.blockNumber) >= Number(fromBlock) && Number(log.blockNumber) <= Number(toBlock)
        );
      },
      async getBlock({ blockNumber }) {
        return {
          hash: blockHashes[Number(blockNumber)] || makeHash(99),
          timestamp: BigInt(blockTimestamps[Number(blockNumber)] || 0)
        };
      }
    },
    getLatestBlockNumber: async () => latestBlockNumber,
    getBlockTimestamp: async (blockNumber) => blockTimestamps[Number(blockNumber)] || 0
  };
}

async function seedSyncCheckpoint(syncKey, runtime, { startBlock, lastBlockNumber, lastBlockHash = '' }) {
  await db.run(
    `
      INSERT INTO sync_state (
        sync_key,
        deployment_key,
        start_block,
        last_block_number,
        last_block_hash,
        status,
        last_error,
        started_at,
        last_synced_at
      )
      VALUES (?, ?, ?, ?, ?, 'idle', '', '', ?)
      ON CONFLICT(sync_key) DO UPDATE SET
        deployment_key = excluded.deployment_key,
        start_block = excluded.start_block,
        last_block_number = excluded.last_block_number,
        last_block_hash = excluded.last_block_hash,
        status = excluded.status,
        last_error = excluded.last_error,
        started_at = excluded.started_at,
        last_synced_at = excluded.last_synced_at
    `,
    [
      syncKey,
      buildTestDeploymentKey(syncKey, runtime.addresses, runtime.chainId),
      Number(startBlock),
      Number(lastBlockNumber),
      lastBlockHash,
      new Date().toISOString()
    ]
  );
}

async function resetTables() {
  await db.run(
    `
      TRUNCATE
        admin_queue,
        pact_messages,
        pact_evidence,
        pact_game_metadata,
        pact_declarations,
        pact_participants,
        pacts,
        usernames,
        auth_nonces,
        sessions,
        sync_state
      RESTART IDENTITY
    `
  );
}

async function insertPact({
  pactId,
  creatorAddress = creator,
  counterpartyAddress = zeroAddress,
  rawStatus = 'Proposed',
  acceptanceDeadline = Math.floor(Date.now() / 1000) + 3600
}) {
  const now = new Date().toISOString();
  await db.run(
    `
      INSERT INTO pacts (
        pact_id,
        creator_address,
        counterparty_address,
        description,
        event_type,
        stake_amount,
        acceptance_deadline,
        event_duration_seconds,
        declaration_window_seconds,
        raw_status,
        is_public,
        winner_address,
        agreed_result_hash,
        fee_recipient,
        fee_bps,
        creation_tx_hash,
        creation_block_number,
        last_event_block_number,
        last_event_name,
        last_resolution_by,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, 'Pact', 'Match', '1000000', ?, 300, 1200, ?, ?, '', '', '', 0, '', 100, 100, '', '', ?, ?)
      ON CONFLICT(pact_id) DO UPDATE SET
        creator_address = excluded.creator_address,
        counterparty_address = excluded.counterparty_address,
        description = excluded.description,
        event_type = excluded.event_type,
        stake_amount = excluded.stake_amount,
        acceptance_deadline = excluded.acceptance_deadline,
        event_duration_seconds = excluded.event_duration_seconds,
        declaration_window_seconds = excluded.declaration_window_seconds,
        raw_status = excluded.raw_status,
        is_public = excluded.is_public,
        winner_address = excluded.winner_address,
        agreed_result_hash = excluded.agreed_result_hash,
        fee_recipient = excluded.fee_recipient,
        fee_bps = excluded.fee_bps,
        creation_tx_hash = excluded.creation_tx_hash,
        creation_block_number = excluded.creation_block_number,
        last_event_block_number = excluded.last_event_block_number,
        last_event_name = excluded.last_event_name,
        last_resolution_by = excluded.last_resolution_by,
        updated_at = excluded.updated_at
    `,
    [
      pactId,
      creatorAddress.toLowerCase(),
      counterpartyAddress.toLowerCase(),
      acceptanceDeadline,
      rawStatus,
      counterpartyAddress === zeroAddress ? 1 : 0,
      now,
      now
    ]
  );
}

beforeEach(async () => {
  await resetTables();
});

dbTest('syncOnce ingests pact lifecycle logs, fee snapshots, declarations, and usernames from a cold backfill', { concurrency: false }, async () => {
  const blockHashes = {
    101: makeHash(11),
    102: makeHash(12),
    103: makeHash(13),
    104: makeHash(14),
    105: makeHash(15),
    201: makeHash(21)
  };
  const blockTimestamps = {
    101: 1_710_000_101,
    102: 1_710_000_102,
    103: 1_710_000_103,
    104: 1_710_000_104,
    105: 1_710_000_105,
    201: 1_710_000_201
  };
  const logsByAddress = {
    [addresses.pactManager]: [
      buildLog({
        abi: chain.pactManagerEventAbi,
        eventName: 'PactCreated',
        address: addresses.pactManager,
        blockNumber: 101,
        blockHash: blockHashes[101],
        txHash: makeHash(31),
        logIndex: 0,
        args: {
          pactId: 1n,
          creator,
          counterparty,
          stakeAmount: 10_000_000n,
          acceptanceDeadline: 1_710_000_500n,
          eventDuration: 300n,
          declarationWindow: 1_200n,
          description: 'First to 10 points',
          eventType: 'Foosball'
        }
      }),
      buildLog({
        abi: chain.pactManagerEventAbi,
        eventName: 'PactJoined',
        address: addresses.pactManager,
        blockNumber: 102,
        blockHash: blockHashes[102],
        txHash: makeHash(32),
        logIndex: 0,
        args: {
          pactId: 1n,
          counterparty,
          eventStartedAt: 1_710_000_120n,
          eventEnd: 1_710_000_420n,
          submissionDeadline: 1_710_001_620n,
          declarationWindow: 1_200n
        }
      }),
      buildLog({
        abi: chain.pactManagerEventAbi,
        eventName: 'PactResolved',
        address: addresses.pactManager,
        blockNumber: 105,
        blockHash: blockHashes[105],
        txHash: makeHash(35),
        logIndex: 1,
        args: {
          pactId: 1n,
          winner: creator,
          agreedResultHash: zeroHash,
          resolvedBy: outsider
        }
      })
    ],
    [addresses.pactVault]: [
      buildLog({
        abi: chain.pactVaultEventAbi,
        eventName: 'PactFeeSnapshotCaptured',
        address: addresses.pactVault,
        blockNumber: 101,
        blockHash: blockHashes[101],
        txHash: makeHash(31),
        logIndex: 1,
        args: {
          pactId: 1n,
          feeRecipient: admin,
          feeBps: 250
        }
      })
    ],
    [addresses.submissionManager]: [
      buildLog({
        abi: chain.submissionManagerEventAbi,
        eventName: 'WinnerDeclared',
        address: addresses.submissionManager,
        blockNumber: 103,
        blockHash: blockHashes[103],
        txHash: makeHash(33),
        logIndex: 0,
        args: {
          pactId: 1n,
          user: creator,
          declaredWinner: creator
        }
      }),
      buildLog({
        abi: chain.submissionManagerEventAbi,
        eventName: 'WinnerDeclared',
        address: addresses.submissionManager,
        blockNumber: 104,
        blockHash: blockHashes[104],
        txHash: makeHash(34),
        logIndex: 0,
        args: {
          pactId: 1n,
          user: counterparty,
          declaredWinner: creator
        }
      })
    ],
    [addresses.pactResolutionManager]: [],
    [addresses.usernameRegistry]: [
      buildLog({
        abi: chain.usernameRegistryEventAbi,
        eventName: 'UsernameSet',
        address: addresses.usernameRegistry,
        blockNumber: 201,
        blockHash: blockHashes[201],
        txHash: makeHash(41),
        logIndex: 0,
        args: {
          user: creator,
          username: 'captain_creator'
        }
      })
    ]
  };

  const runtime = createRuntime({
    logsByAddress,
    latestBlockNumber: 201,
    blockHashes,
    blockTimestamps
  });

  await seedSyncCheckpoint('core', runtime, {
    startBlock: 100,
    lastBlockNumber: 99
  });
  await seedSyncCheckpoint('usernames', runtime, {
    startBlock: 200,
    lastBlockNumber: 199
  });

  await indexer.syncOnce(runtime);

  const pactRow = await db.get(`SELECT * FROM pacts WHERE pact_id = 1`);
  const declarationRows = await db.all(`SELECT * FROM pact_declarations WHERE pact_id = 1 ORDER BY participant_address ASC`);
  const syncRows = (await db.all(`SELECT sync_key, last_block_number, status FROM sync_state ORDER BY sync_key ASC`)).map(
    (row) => ({ ...row })
  );
  const recentPacts = await pacts.listRecentPacts(5, { decimals: 6, isAdmin: false, isArbiter: false }, creator);

  assert.equal(pactRow.description, 'First to 10 points');
  assert.equal(pactRow.raw_status, 'Resolved');
  assert.equal(pactRow.fee_recipient, admin.toLowerCase());
  assert.equal(pactRow.fee_bps, 250);
  assert.equal(pactRow.winner_address, creator.toLowerCase());
  assert.equal(declarationRows.length, 2);
  assert.equal(declarationRows[0].declared_winner_address, creator.toLowerCase());
  assert.equal((await db.get(`SELECT username FROM usernames WHERE address = ?`, [creator.toLowerCase()])).username, 'captain_creator');
  assert.deepEqual(syncRows, [
    { sync_key: 'core', last_block_number: 201, status: 'idle' },
    { sync_key: 'usernames', last_block_number: 201, status: 'idle' }
  ]);
  assert.equal(recentPacts.length, 1);
  assert.equal(recentPacts[0].stage, 'Completed');
  assert.equal(recentPacts[0].feeSnapshot.feeBps, 250);
  assert.equal(recentPacts[0].creatorUsername, 'captain_creator');
});

dbTest('pact read-model helpers paginate recent and open pacts from indexed rows', { concurrency: false }, async () => {
  const futureDeadline = Math.floor(Date.now() / 1000) + 3600;
  const basePactId = Number((await db.get(`SELECT COALESCE(MAX(pact_id), 0) + 100 AS pact_id FROM pacts`))?.pact_id || 100);
  const currentUser = makeAddress(basePactId + 1);
  const opponent = makeAddress(basePactId + 2);
  const viewer = makeAddress(basePactId + 3);

  await insertPact({
    pactId: basePactId + 1,
    creatorAddress: currentUser,
    rawStatus: 'Resolved',
    counterpartyAddress: opponent,
    acceptanceDeadline: futureDeadline
  });
  await insertPact({ pactId: basePactId + 2, creatorAddress: currentUser, rawStatus: 'Proposed', acceptanceDeadline: futureDeadline });
  await insertPact({
    pactId: basePactId + 3,
    creatorAddress: currentUser,
    rawStatus: 'Active',
    counterpartyAddress: opponent,
    acceptanceDeadline: futureDeadline
  });
  await insertPact({ pactId: basePactId + 4, creatorAddress: currentUser, rawStatus: 'Proposed', acceptanceDeadline: futureDeadline });
  await insertPact({
    pactId: basePactId + 5,
    creatorAddress: currentUser,
    rawStatus: 'Resolved',
    counterpartyAddress: opponent,
    acceptanceDeadline: futureDeadline
  });
  await insertPact({ pactId: basePactId + 6, creatorAddress: currentUser, rawStatus: 'Proposed', acceptanceDeadline: futureDeadline });

  await db.run(
    `INSERT INTO pact_messages (id, pact_id, author_address, body, created_at) VALUES (?, ?, ?, 'Ready when you are', ?)`,
    [`msg-${basePactId + 6}`, basePactId + 6, currentUser.toLowerCase(), new Date().toISOString()]
  );

  const protocol = { decimals: 6, isAdmin: false, isArbiter: false };
  const recent = await pacts.listRecentPacts(3, protocol, currentUser);
  const open = await pacts.listOpenPacts(2, protocol, viewer);

  assert.deepEqual(
    recent.map((pact) => pact.id),
    [basePactId + 6, basePactId + 5, basePactId + 4]
  );
  assert.deepEqual(
    open.map((pact) => pact.id),
    [basePactId + 6, basePactId + 4]
  );
  assert.equal(recent[0].messageCount, 1);
  assert.equal(open[0].stage, 'Open For Join');
});

dbTest('dashboard helpers prioritize pacts involving the connected wallet even when newer unrelated rows exist', { concurrency: false }, async () => {
  const futureDeadline = Math.floor(Date.now() / 1000) + 3600;
  const basePactId = Number((await db.get(`SELECT COALESCE(MAX(pact_id), 0) + 100 AS pact_id FROM pacts`))?.pact_id || 100);
  const currentUser = makeAddress(basePactId + 10);
  const opponent = makeAddress(basePactId + 11);
  const unrelatedA = makeAddress(basePactId + 12);
  const unrelatedB = makeAddress(basePactId + 13);

  await insertPact({
    pactId: basePactId + 1,
    creatorAddress: currentUser,
    counterpartyAddress: opponent,
    rawStatus: 'Proposed',
    acceptanceDeadline: futureDeadline
  });
  await insertPact({ pactId: basePactId + 2, creatorAddress: unrelatedA, rawStatus: 'Proposed', acceptanceDeadline: futureDeadline });
  await insertPact({
    pactId: basePactId + 3,
    creatorAddress: unrelatedB,
    rawStatus: 'Resolved',
    counterpartyAddress: unrelatedA,
    acceptanceDeadline: futureDeadline
  });
  await insertPact({ pactId: basePactId + 4, creatorAddress: unrelatedA, rawStatus: 'Proposed', acceptanceDeadline: futureDeadline });
  await insertPact({
    pactId: basePactId + 5,
    creatorAddress: unrelatedB,
    rawStatus: 'Resolved',
    counterpartyAddress: unrelatedA,
    acceptanceDeadline: futureDeadline
  });
  await insertPact({ pactId: basePactId + 6, creatorAddress: unrelatedA, rawStatus: 'Proposed', acceptanceDeadline: futureDeadline });

  const protocol = { decimals: 6, isAdmin: false, isArbiter: false };
  const recent = await pacts.listRecentPacts(3, protocol, currentUser);

  assert.deepEqual(
    recent.map((pact) => pact.id),
    [basePactId + 1, basePactId + 6, basePactId + 4]
  );
  assert.equal(recent[0].participantRole, 'creator');
  assert.equal(recent[0].canCancel, true);
});

dbTest('reorg-safe sync clears stale indexed rows and replays from the configured start block', { concurrency: false }, async () => {
  await insertPact({ pactId: 999, rawStatus: 'Resolved', counterpartyAddress: counterparty });
  await db.run(
    `
      INSERT INTO pact_evidence (
        pact_id,
        participant_address,
        evidence_uri,
        source,
        created_at,
        updated_at
      )
      VALUES (999, ?, 'https://rjhwefsorvhnflvwnkud.supabase.co/storage/v1/object/public/evidence/archive.png', 'supabase-storage', ?, ?)
    `,
    [creator.toLowerCase(), new Date().toISOString(), new Date().toISOString()]
  );
  await db.run(
    `
      INSERT INTO sync_state (
        sync_key,
        start_block,
        last_block_number,
        last_block_hash,
        status,
        last_error,
        started_at,
        last_synced_at
      )
      VALUES ('core', 100, 101, ?, 'idle', '', '', ?)
    `,
    [makeHash(77), new Date().toISOString()]
  );

  const blockHashes = {
    100: makeHash(10),
    101: makeHash(11)
  };
  const blockTimestamps = {
    100: 1_710_100_100,
    101: 1_710_100_101
  };
  const logsByAddress = {
    [addresses.pactManager]: [
      buildLog({
        abi: chain.pactManagerEventAbi,
        eventName: 'PactCreated',
        address: addresses.pactManager,
        blockNumber: 100,
        blockHash: blockHashes[100],
        txHash: makeHash(51),
        logIndex: 0,
        args: {
          pactId: 1n,
          creator,
          counterparty,
          stakeAmount: 2_000_000n,
          acceptanceDeadline: 1_710_100_500n,
          eventDuration: 300n,
          declarationWindow: 1_200n,
          description: 'Replay pact',
          eventType: 'Replay'
        }
      }),
      buildLog({
        abi: chain.pactManagerEventAbi,
        eventName: 'PactJoined',
        address: addresses.pactManager,
        blockNumber: 101,
        blockHash: blockHashes[101],
        txHash: makeHash(52),
        logIndex: 0,
        args: {
          pactId: 1n,
          counterparty,
          eventStartedAt: 1_710_100_120n,
          eventEnd: 1_710_100_420n,
          submissionDeadline: 1_710_101_620n,
          declarationWindow: 1_200n
        }
      })
    ],
    [addresses.pactVault]: [],
    [addresses.submissionManager]: [],
    [addresses.pactResolutionManager]: []
  };

  await indexer.syncOnce(
    createRuntime({
      logsByAddress,
      latestBlockNumber: 101,
      blockHashes,
      blockTimestamps
    })
  );

  const pactIds = (await db.all(`SELECT pact_id FROM pacts WHERE pact_id IN (1, 999) ORDER BY pact_id ASC`)).map((row) =>
    Number(row.pact_id)
  );
  const syncState = await db.get(`SELECT * FROM sync_state WHERE sync_key = 'core'`);
  const preservedMetadata = (await db.all(`SELECT evidence_uri, source FROM pact_evidence ORDER BY id ASC`)).map((row) => ({
    ...row
  }));

  assert.deepEqual(pactIds, [1]);
  assert.equal(syncState.last_block_hash, blockHashes[101]);
  assert.equal(syncState.last_block_number, 101);
  assert.deepEqual(preservedMetadata, [
    {
      evidence_uri: 'https://rjhwefsorvhnflvwnkud.supabase.co/storage/v1/object/public/evidence/archive.png',
      source: 'supabase-storage'
    }
  ]);
});

dbTest('syncOnce refreshes pact state during long backfills so stale open joins do not linger', { concurrency: false }, async () => {
  await insertPact({ pactId: 1, rawStatus: 'Proposed', counterpartyAddress: zeroAddress });

  const latestBlockNumber = 450;
  const runtime = {
    ...createRuntime({
      logsByAddress: {
        [addresses.pactManager]: [],
        [addresses.pactVault]: [],
        [addresses.submissionManager]: [],
        [addresses.pactResolutionManager]: []
      },
      latestBlockNumber
    }),
    addresses,
    coreSyncMode: 'state-snapshot',
    usernameSyncMode: 'state-snapshot',
    contractStartBlocks: {
      core: 100n,
      usernames: 200n
    },
    hasCoreContractsConfigured: () => true,
    hasUsernameRegistryConfigured: () => false,
    syncBatchSize: 100,
    syncMaxBatchesPerRun: 1,
    async readContractWithRetry({ address, functionName, args = [] }) {
      if (address === addresses.pactManager && functionName === 'nextPactId') {
        return 2n;
      }

      if (address === addresses.pactManager && functionName === 'getPactCore' && Number(args[0]) === 1) {
        return [
          creator,
          counterparty,
          1_000_000n,
          1_710_200_500n,
          300n,
          1_710_200_120n,
          1_710_200_420n,
          1_710_201_620n,
          2,
          zeroAddress,
          zeroHash,
          1_200n
        ];
      }

      if (address === addresses.pactManager && functionName === 'descriptions' && Number(args[0]) === 1) {
        return 'Live pact';
      }

      if (address === addresses.pactManager && functionName === 'eventTypes' && Number(args[0]) === 1) {
        return 'Chess';
      }

      if (address === addresses.submissionManager && functionName === 'getDeclaration') {
        return [false, 0n, zeroAddress];
      }

      throw new Error(`Unexpected state read: ${functionName} on ${address}`);
    }
  };

  await indexer.syncOnce(runtime);

  const pact = await db.get(
    `SELECT raw_status, counterparty_address, event_started_at, event_end, submission_deadline FROM pacts WHERE pact_id = 1`
  );
  const syncState = await db.get(`SELECT status, last_block_number FROM sync_state WHERE sync_key = 'core'`);

  assert.equal(pact.raw_status, 'Active');
  assert.equal(pact.counterparty_address, counterparty.toLowerCase());
  assert.equal(Number(pact.event_started_at), 1_710_200_120);
  assert.equal(Number(pact.event_end), 1_710_200_420);
  assert.equal(Number(pact.submission_deadline), 1_710_201_620);
  assert.equal(syncState.status, 'idle');
  assert.equal(Number(syncState.last_block_number), latestBlockNumber);
});

dbTest('state snapshots only revisit unresolved indexed pacts plus newly discovered pact ids', { concurrency: false }, async () => {
  await insertPact({ pactId: 1, rawStatus: 'Resolved', counterpartyAddress: counterparty });
  await insertPact({ pactId: 2, rawStatus: 'Active', counterpartyAddress: counterparty });

  const visitedPactIds = [];
  const freshPactId = Number((await db.get(`SELECT MAX(pact_id) AS pact_id FROM pacts`))?.pact_id || 2) + 1;
  const nextPactId = freshPactId + 1;
  const runtime = {
    ...createRuntime({
      latestBlockNumber: 900
    }),
    addresses,
    coreSyncMode: 'state-snapshot',
    usernameSyncMode: 'state-snapshot',
    contractStartBlocks: {
      core: 100n,
      usernames: 200n
    },
    hasCoreContractsConfigured: () => true,
    hasUsernameRegistryConfigured: () => false,
    stateReconcileConcurrency: 2,
    async readContractWithRetry({ address, functionName, args = [] }) {
      if (address === addresses.pactManager && functionName === 'nextPactId') {
        return BigInt(nextPactId);
      }

      if (address === addresses.pactManager && functionName === 'getPactCore') {
        const pactId = Number(args[0]);
        visitedPactIds.push(pactId);
        if (pactId === 2) {
          return [
            creator,
            counterparty,
            1_000_000n,
            1_710_200_500n,
            300n,
            1_710_200_120n,
            1_710_200_420n,
            1_710_201_620n,
            2,
            zeroAddress,
            zeroHash,
            1_200n
          ];
        }

        if (pactId === freshPactId) {
          return [
            outsider,
            zeroAddress,
            2_000_000n,
            1_710_200_900n,
            600n,
            0n,
            0n,
            0n,
            1,
            zeroAddress,
            zeroHash,
            1_200n
          ];
        }

        return [
          zeroAddress,
          zeroAddress,
          0n,
          0n,
          0n,
          0n,
          0n,
          0n,
          0,
          zeroAddress,
          zeroHash,
          0n
        ];
      }

      if (address === addresses.pactManager && functionName === 'descriptions' && Number(args[0]) === 2) {
        return 'Existing active pact';
      }

      if (address === addresses.pactManager && functionName === 'descriptions' && Number(args[0]) === freshPactId) {
        return 'Fresh proposed pact';
      }

      if (address === addresses.pactManager && functionName === 'descriptions') {
        return '';
      }

      if (address === addresses.pactManager && functionName === 'eventTypes' && Number(args[0]) === 2) {
        return 'Basketball';
      }

      if (address === addresses.pactManager && functionName === 'eventTypes' && Number(args[0]) === freshPactId) {
        return 'Chess';
      }

      if (address === addresses.pactManager && functionName === 'eventTypes') {
        return '';
      }

      if (address === addresses.pactVault && functionName === 'pactFeeSnapshotOf') {
        return [admin, 250n, true];
      }

      if (address === addresses.submissionManager && functionName === 'getDeclaration') {
        return [false, 0n, zeroAddress];
      }

      throw new Error(`Unexpected state read: ${functionName} on ${address}`);
    }
  };

  await seedSyncCheckpoint('core', runtime, {
    startBlock: 100,
    lastBlockNumber: 899
  });

  await indexer.syncOnce(runtime);

  assert.ok(visitedPactIds.includes(2));
  assert.ok(visitedPactIds.includes(freshPactId));
  assert.equal(visitedPactIds.includes(1), false);
  assert.equal((await db.get(`SELECT raw_status FROM pacts WHERE pact_id = 1`)).raw_status, 'Resolved');
  assert.equal((await db.get(`SELECT raw_status FROM pacts WHERE pact_id = 2`)).raw_status, 'Active');
  assert.equal((await db.get(`SELECT raw_status FROM pacts WHERE pact_id = ?`, [freshPactId])).raw_status, 'Proposed');
});
