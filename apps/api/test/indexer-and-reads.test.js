import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, test } from 'node:test';
import { encodeAbiParameters, encodeEventTopics, zeroAddress } from 'viem';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'swf-api-tests-'));
const databasePath = path.join(tempRoot, 'stakewithfriends.sqlite');

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

process.env.DATABASE_PATH = databasePath;
process.env.CORE_SYNC_MODE = 'log-backfill';
process.env.USERNAME_SYNC_MODE = 'log-backfill';
process.env.PACT_INDEX_START_BLOCK = '100';
process.env.USERNAME_INDEX_START_BLOCK = '200';
process.env.STORAGE_MODE = 'catbox-public';
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

function makeHash(byte) {
  return `0x${String(byte).padStart(2, '0').repeat(32)}`;
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

function createRuntime({ logsByAddress = {}, latestBlockNumber = 0, blockHashes = {}, blockTimestamps = {} } = {}) {
  return {
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

function resetTables() {
  for (const table of [
    'admin_queue',
    'pact_messages',
    'pact_evidence',
    'pact_declarations',
    'pact_participants',
    'pacts',
    'usernames',
    'auth_nonces',
    'sessions',
    'sync_state'
  ]) {
    db.run(`DELETE FROM ${table}`);
  }
}

function insertPact({
  pactId,
  creatorAddress = creator,
  counterpartyAddress = zeroAddress,
  rawStatus = 'Proposed',
  acceptanceDeadline = Math.floor(Date.now() / 1000) + 3600
}) {
  const now = new Date().toISOString();
  db.run(
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

beforeEach(() => {
  resetTables();
});

after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('syncOnce ingests pact lifecycle logs, fee snapshots, declarations, and usernames from a cold backfill', async () => {
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

  await indexer.syncOnce(
    createRuntime({
      logsByAddress,
      latestBlockNumber: 201,
      blockHashes,
      blockTimestamps
    })
  );

  const pactRow = db.get(`SELECT * FROM pacts WHERE pact_id = 1`);
  const declarationRows = db.all(`SELECT * FROM pact_declarations WHERE pact_id = 1 ORDER BY participant_address ASC`);
  const syncRows = db
    .all(`SELECT sync_key, last_block_number, status FROM sync_state ORDER BY sync_key ASC`)
    .map((row) => ({ ...row }));
  const recentPacts = pacts.listRecentPacts(5, { decimals: 6, isAdmin: false, isArbiter: false }, creator);

  assert.equal(pactRow.description, 'First to 10 points');
  assert.equal(pactRow.raw_status, 'Resolved');
  assert.equal(pactRow.fee_recipient, admin.toLowerCase());
  assert.equal(pactRow.fee_bps, 250);
  assert.equal(pactRow.winner_address, creator.toLowerCase());
  assert.equal(declarationRows.length, 2);
  assert.equal(declarationRows[0].declared_winner_address, creator.toLowerCase());
  assert.equal(db.get(`SELECT username FROM usernames WHERE address = ?`, [creator.toLowerCase()]).username, 'captain_creator');
  assert.deepEqual(syncRows, [
    { sync_key: 'core', last_block_number: 201, status: 'idle' },
    { sync_key: 'usernames', last_block_number: 201, status: 'idle' }
  ]);
  assert.equal(recentPacts.length, 1);
  assert.equal(recentPacts[0].stage, 'Completed');
  assert.equal(recentPacts[0].feeSnapshot.feeBps, 250);
  assert.equal(recentPacts[0].creatorUsername, 'captain_creator');
});

test('pact read-model helpers paginate recent and open pacts from indexed rows', async () => {
  const futureDeadline = Math.floor(Date.now() / 1000) + 3600;

  insertPact({ pactId: 1, rawStatus: 'Resolved', counterpartyAddress: counterparty, acceptanceDeadline: futureDeadline });
  insertPact({ pactId: 2, rawStatus: 'Proposed', acceptanceDeadline: futureDeadline });
  insertPact({ pactId: 3, rawStatus: 'Active', counterpartyAddress: counterparty, acceptanceDeadline: futureDeadline });
  insertPact({ pactId: 4, rawStatus: 'Proposed', acceptanceDeadline: futureDeadline });
  insertPact({ pactId: 5, rawStatus: 'Resolved', counterpartyAddress: counterparty, acceptanceDeadline: futureDeadline });
  insertPact({ pactId: 6, rawStatus: 'Proposed', acceptanceDeadline: futureDeadline });

  db.run(
    `INSERT INTO pact_messages (id, pact_id, author_address, body, created_at) VALUES ('msg-1', 6, ?, 'Ready when you are', ?)`,
    [creator.toLowerCase(), new Date().toISOString()]
  );

  const protocol = { decimals: 6, isAdmin: false, isArbiter: false };
  const recent = pacts.listRecentPacts(3, protocol, creator);
  const open = pacts.listOpenPacts(2, protocol, outsider);

  assert.deepEqual(
    recent.map((pact) => pact.id),
    [6, 5, 4]
  );
  assert.deepEqual(
    open.map((pact) => pact.id),
    [6, 4]
  );
  assert.equal(recent[0].messageCount, 1);
  assert.equal(open[0].stage, 'Open For Join');
});

test('dashboard helpers prioritize pacts involving the connected wallet even when newer unrelated rows exist', async () => {
  const futureDeadline = Math.floor(Date.now() / 1000) + 3600;

  insertPact({
    pactId: 1,
    creatorAddress: creator,
    counterpartyAddress: counterparty,
    rawStatus: 'Proposed',
    acceptanceDeadline: futureDeadline
  });
  insertPact({ pactId: 2, creatorAddress: outsider, rawStatus: 'Proposed', acceptanceDeadline: futureDeadline });
  insertPact({ pactId: 3, creatorAddress: admin, rawStatus: 'Resolved', counterpartyAddress: outsider, acceptanceDeadline: futureDeadline });
  insertPact({ pactId: 4, creatorAddress: outsider, rawStatus: 'Proposed', acceptanceDeadline: futureDeadline });
  insertPact({ pactId: 5, creatorAddress: admin, rawStatus: 'Resolved', counterpartyAddress: outsider, acceptanceDeadline: futureDeadline });
  insertPact({ pactId: 6, creatorAddress: outsider, rawStatus: 'Proposed', acceptanceDeadline: futureDeadline });

  const protocol = { decimals: 6, isAdmin: false, isArbiter: false };
  const recent = pacts.listRecentPacts(3, protocol, creator);

  assert.deepEqual(
    recent.map((pact) => pact.id),
    [1, 6, 4]
  );
  assert.equal(recent[0].participantRole, 'creator');
  assert.equal(recent[0].canCancel, true);
});

test('reorg-safe sync clears stale indexed rows and replays from the configured start block', async () => {
  insertPact({ pactId: 999, rawStatus: 'Resolved', counterpartyAddress: counterparty });
  db.run(
    `
      INSERT INTO pact_evidence (
        pact_id,
        participant_address,
        evidence_uri,
        source,
        created_at,
        updated_at
      )
      VALUES (999, ?, 'https://files.catbox.moe/archive.png', 'catbox-metadata', ?, ?)
    `,
    [creator.toLowerCase(), new Date().toISOString(), new Date().toISOString()]
  );
  db.run(
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

  const pactIds = db.all(`SELECT pact_id FROM pacts ORDER BY pact_id ASC`).map((row) => Number(row.pact_id));
  const syncState = db.get(`SELECT * FROM sync_state WHERE sync_key = 'core'`);
  const preservedMetadata = db
    .all(`SELECT evidence_uri, source FROM pact_evidence ORDER BY id ASC`)
    .map((row) => ({ ...row }));

  assert.deepEqual(pactIds, [1]);
  assert.equal(syncState.last_block_hash, blockHashes[101]);
  assert.equal(syncState.last_block_number, 101);
  assert.deepEqual(preservedMetadata, [
    {
      evidence_uri: 'https://files.catbox.moe/archive.png',
      source: 'catbox-metadata'
    }
  ]);
});

test('syncOnce refreshes pact state during long backfills so stale open joins do not linger', async () => {
  insertPact({ pactId: 1, rawStatus: 'Proposed', counterpartyAddress: zeroAddress });

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

  const pact = db.get(
    `SELECT raw_status, counterparty_address, event_started_at, event_end, submission_deadline FROM pacts WHERE pact_id = 1`
  );
  const syncState = db.get(`SELECT status, last_block_number FROM sync_state WHERE sync_key = 'core'`);

  assert.equal(pact.raw_status, 'Active');
  assert.equal(pact.counterparty_address, counterparty.toLowerCase());
  assert.equal(Number(pact.event_started_at), 1_710_200_120);
  assert.equal(Number(pact.event_end), 1_710_200_420);
  assert.equal(Number(pact.submission_deadline), 1_710_201_620);
  assert.equal(syncState.status, 'idle');
  assert.equal(Number(syncState.last_block_number), latestBlockNumber);
});

test('state snapshots only revisit unresolved indexed pacts plus newly discovered pact ids', async () => {
  insertPact({ pactId: 1, rawStatus: 'Resolved', counterpartyAddress: counterparty });
  insertPact({ pactId: 2, rawStatus: 'Active', counterpartyAddress: counterparty });

  const visitedPactIds = [];
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
        return 4n;
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

        if (pactId === 3) {
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
      }

      if (address === addresses.pactManager && functionName === 'descriptions' && Number(args[0]) === 2) {
        return 'Existing active pact';
      }

      if (address === addresses.pactManager && functionName === 'descriptions' && Number(args[0]) === 3) {
        return 'Fresh proposed pact';
      }

      if (address === addresses.pactManager && functionName === 'eventTypes' && Number(args[0]) === 2) {
        return 'Basketball';
      }

      if (address === addresses.pactManager && functionName === 'eventTypes' && Number(args[0]) === 3) {
        return 'Chess';
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

  await indexer.syncOnce(runtime);

  assert.deepEqual(visitedPactIds.sort((left, right) => left - right), [2, 3]);
  assert.equal(db.get(`SELECT raw_status FROM pacts WHERE pact_id = 1`).raw_status, 'Resolved');
  assert.equal(db.get(`SELECT raw_status FROM pacts WHERE pact_id = 2`).raw_status, 'Active');
  assert.equal(db.get(`SELECT raw_status FROM pacts WHERE pact_id = 3`).raw_status, 'Proposed');
});
