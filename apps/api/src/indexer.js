import crypto from 'node:crypto';
import { decodeEventLog, keccak256, stringToHex, zeroAddress } from 'viem';
import {
  decodeIndexedLog,
  getBlockTimestamp,
  getLatestBlockNumber,
  pactManagerAbi,
  pactManagerEventAbi,
  pactResolutionManagerAbi,
  pactResolutionManagerEventAbi,
  pactVaultAbi,
  pactVaultEventAbi,
  publicClient,
  rawStatusMap,
  readContractWithRetry,
  submissionManagerAbi,
  submissionManagerEventAbi,
  usernameRegistryAbi,
  usernameRegistryEventAbi
} from './chain.js';
import { apiConfig, hasCoreContractsConfigured, hasUsernameRegistryConfigured } from './config.js';
import { all, ensureSyncState, get, nowIso, run } from './db.js';

function normalizeAddress(value) {
  return String(value || '').toLowerCase();
}

function normalizeSyncMode(value, fallback) {
  const normalized = String(value || fallback || '').trim().toLowerCase();
  return normalized || fallback;
}

function usernameHash(username) {
  return keccak256(stringToHex(String(username || '')));
}

function updateSyncState(syncKey, payload) {
  const current = get(`SELECT * FROM sync_state WHERE sync_key = ?`, [syncKey]) || {};
  run(
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
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(sync_key) DO UPDATE SET
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
      Number(payload.startBlock ?? current.start_block ?? 0),
      Number(payload.lastBlockNumber ?? current.last_block_number ?? 0),
      payload.lastBlockHash ?? current.last_block_hash ?? '',
      payload.status ?? current.status ?? 'idle',
      payload.lastError ?? current.last_error ?? '',
      payload.startedAt ?? current.started_at ?? '',
      payload.lastSyncedAt ?? current.last_synced_at ?? ''
    ]
  );
}

function upsertParticipant(pactId, participantAddress, role, timestampIso) {
  if (!participantAddress || participantAddress === zeroAddress) {
    return;
  }

  run(
    `
      INSERT INTO pact_participants (pact_id, participant_address, role, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(pact_id, participant_address) DO UPDATE SET
        role = excluded.role,
        updated_at = excluded.updated_at
    `,
    [pactId, normalizeAddress(participantAddress), role, timestampIso, timestampIso]
  );
}

function refreshAdminQueue(pactId) {
  const pact = get(
    `
      SELECT creator_address, counterparty_address, raw_status
      FROM pacts
      WHERE pact_id = ?
    `,
    [pactId]
  );

  if (!pact) {
    return;
  }

  const evidenceRows = all(`SELECT participant_address, created_at FROM pact_evidence WHERE pact_id = ?`, [pactId]);
  const creatorAddress = normalizeAddress(pact.creator_address);
  const counterpartyAddress = normalizeAddress(pact.counterparty_address);
  const hasCreatorEvidence = evidenceRows.some(
    (row) => normalizeAddress(row.participant_address) === creatorAddress
  );
  const hasCounterpartyEvidence = evidenceRows.some(
    (row) => normalizeAddress(row.participant_address) === counterpartyAddress
  );
  const queueStatus =
    pact.raw_status === 'Disputed'
      ? 'disputed'
      : pact.raw_status === 'Resolved' || pact.raw_status === 'Cancelled'
        ? 'closed'
        : pact.raw_status === 'Active'
          ? 'watch'
          : 'idle';
  const lastEvidenceAt = evidenceRows.length ? evidenceRows[evidenceRows.length - 1].created_at : '';
  const updatedAt = nowIso();

  run(
    `
      INSERT INTO admin_queue (
        pact_id,
        queue_status,
        evidence_count,
        has_creator_evidence,
        has_counterparty_evidence,
        last_evidence_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pact_id) DO UPDATE SET
        queue_status = excluded.queue_status,
        evidence_count = excluded.evidence_count,
        has_creator_evidence = excluded.has_creator_evidence,
        has_counterparty_evidence = excluded.has_counterparty_evidence,
        last_evidence_at = excluded.last_evidence_at,
        updated_at = excluded.updated_at
    `,
    [
      pactId,
      queueStatus,
      evidenceRows.length,
      hasCreatorEvidence ? 1 : 0,
      hasCounterpartyEvidence ? 1 : 0,
      lastEvidenceAt,
      updatedAt
    ]
  );
}

async function getBlockTimeIso(blockNumber, cache, runtime = {}) {
  const numericBlockNumber = Number(blockNumber);
  if (!cache.has(numericBlockNumber)) {
    const timestamp = runtime.getBlockTimestamp
      ? await runtime.getBlockTimestamp(numericBlockNumber)
      : await getBlockTimestamp(numericBlockNumber);
    cache.set(numericBlockNumber, {
      unix: timestamp,
      iso: new Date(timestamp * 1000).toISOString()
    });
  }

  return cache.get(numericBlockNumber);
}

async function applyPactManagerEvent(log, decoded, blockTime) {
  const pactId = Number(decoded.args.pactId);
  const updatedAt = blockTime.iso;

  if (decoded.eventName === 'PactCreated') {
    run(
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
          creation_tx_hash,
          creation_block_number,
          last_event_block_number,
          last_event_name,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Proposed', ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(pact_id) DO UPDATE SET
          creator_address = excluded.creator_address,
          counterparty_address = excluded.counterparty_address,
          description = excluded.description,
          event_type = excluded.event_type,
          stake_amount = excluded.stake_amount,
          acceptance_deadline = excluded.acceptance_deadline,
          event_duration_seconds = excluded.event_duration_seconds,
          declaration_window_seconds = excluded.declaration_window_seconds,
          raw_status = 'Proposed',
          is_public = excluded.is_public,
          creation_tx_hash = excluded.creation_tx_hash,
          creation_block_number = excluded.creation_block_number,
          last_event_block_number = excluded.last_event_block_number,
          last_event_name = excluded.last_event_name,
          updated_at = excluded.updated_at
      `,
      [
        pactId,
        normalizeAddress(decoded.args.creator),
        normalizeAddress(decoded.args.counterparty),
        decoded.args.description || '',
        decoded.args.eventType || '',
        decoded.args.stakeAmount.toString(),
        Number(decoded.args.acceptanceDeadline),
        Number(decoded.args.eventDuration),
        Number(decoded.args.declarationWindow),
        decoded.args.counterparty === zeroAddress ? 1 : 0,
        log.transactionHash || '',
        Number(log.blockNumber),
        Number(log.blockNumber),
        decoded.eventName,
        updatedAt,
        updatedAt
      ]
    );

    upsertParticipant(pactId, decoded.args.creator, 'creator', updatedAt);
    if (decoded.args.counterparty !== zeroAddress) {
      upsertParticipant(pactId, decoded.args.counterparty, 'counterparty', updatedAt);
    }
    refreshAdminQueue(pactId);
    return;
  }

  if (decoded.eventName === 'PactJoined') {
    run(
      `
        UPDATE pacts
        SET
          counterparty_address = ?,
          event_started_at = ?,
          event_end = ?,
          submission_deadline = ?,
          declaration_window_seconds = ?,
          raw_status = 'Active',
          last_event_block_number = ?,
          last_event_name = ?,
          updated_at = ?
        WHERE pact_id = ?
      `,
      [
        normalizeAddress(decoded.args.counterparty),
        Number(decoded.args.eventStartedAt),
        Number(decoded.args.eventEnd),
        Number(decoded.args.submissionDeadline),
        Number(decoded.args.declarationWindow),
        Number(log.blockNumber),
        decoded.eventName,
        updatedAt,
        pactId
      ]
    );

    upsertParticipant(pactId, decoded.args.counterparty, 'counterparty', updatedAt);
    refreshAdminQueue(pactId);
    return;
  }

  if (decoded.eventName === 'PactCancelled' || decoded.eventName === 'PactExpired') {
    run(
      `
        UPDATE pacts
        SET
          raw_status = 'Cancelled',
          last_event_block_number = ?,
          last_event_name = ?,
          updated_at = ?
        WHERE pact_id = ?
      `,
      [Number(log.blockNumber), decoded.eventName, updatedAt, pactId]
    );
    refreshAdminQueue(pactId);
    return;
  }

  if (decoded.eventName === 'PactDisputed') {
    run(
      `
        UPDATE pacts
        SET
          raw_status = 'Disputed',
          last_event_block_number = ?,
          last_event_name = ?,
          updated_at = ?
        WHERE pact_id = ?
      `,
      [Number(log.blockNumber), decoded.eventName, updatedAt, pactId]
    );
    refreshAdminQueue(pactId);
    return;
  }

  if (decoded.eventName === 'PactResolved') {
    run(
      `
        UPDATE pacts
        SET
          raw_status = 'Resolved',
          winner_address = ?,
          agreed_result_hash = ?,
          last_resolution_by = ?,
          last_event_block_number = ?,
          last_event_name = ?,
          updated_at = ?
        WHERE pact_id = ?
      `,
      [
        normalizeAddress(decoded.args.winner),
        decoded.args.agreedResultHash || '',
        normalizeAddress(decoded.args.resolvedBy),
        Number(log.blockNumber),
        decoded.eventName,
        updatedAt,
        pactId
      ]
    );
    refreshAdminQueue(pactId);
  }
}

function applyWinnerDeclared(log, decoded, blockTime) {
  const pactId = Number(decoded.args.pactId);
  const address = normalizeAddress(decoded.args.user);
  const updatedAt = blockTime.iso;

  run(
    `
      INSERT INTO pact_declarations (
        pact_id,
        participant_address,
        submitted,
        submitted_at,
        declared_winner_address,
        declaration_source,
        tx_hash,
        updated_at
      )
      VALUES (?, ?, 1, ?, ?, 'onchain', ?, ?)
      ON CONFLICT(pact_id, participant_address) DO UPDATE SET
        submitted = excluded.submitted,
        submitted_at = excluded.submitted_at,
        declared_winner_address = excluded.declared_winner_address,
        declaration_source = excluded.declaration_source,
        tx_hash = excluded.tx_hash,
        updated_at = excluded.updated_at
    `,
    [
      pactId,
      address,
      blockTime.unix,
      normalizeAddress(decoded.args.declaredWinner),
      log.transactionHash || '',
      updatedAt
    ]
  );

  refreshAdminQueue(pactId);
}

function applyEvidenceSubmitted(log, decoded, blockTime) {
  const pactId = Number(decoded.args.pactId);
  const address = normalizeAddress(decoded.args.user);
  const evidenceUri = String(decoded.args.evidenceUri || '').trim();
  if (!evidenceUri) {
    return;
  }

  run(
    `
      INSERT INTO pact_evidence (
        pact_id,
        participant_address,
        evidence_uri,
        source,
        tx_hash,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pact_id, participant_address, evidence_uri) DO UPDATE SET
        source = excluded.source,
        tx_hash = excluded.tx_hash,
        updated_at = excluded.updated_at
    `,
    [
      pactId,
      address,
      evidenceUri,
      evidenceUri.includes('catbox') ? 'catbox-public' : 'onchain',
      log.transactionHash || '',
      blockTime.iso,
      blockTime.iso
    ]
  );

  refreshAdminQueue(pactId);
}

function applyFeeSnapshot(log, decoded, blockTime) {
  const pactId = Number(decoded.args.pactId);
  run(
    `
      UPDATE pacts
      SET
        fee_recipient = ?,
        fee_bps = ?,
        updated_at = ?
      WHERE pact_id = ?
    `,
    [normalizeAddress(decoded.args.feeRecipient), Number(decoded.args.feeBps), blockTime.iso, pactId]
  );
}

function applyUsernameEvent(decoded, blockTime) {
  const address = normalizeAddress(decoded.args.user);

  if (decoded.eventName === 'UsernameSet') {
    const username = String(decoded.args.username || '').trim().toLowerCase();
    if (!username) {
      return;
    }

    run(
      `
        INSERT INTO usernames (address, username, username_hash, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(address) DO UPDATE SET
          username = excluded.username,
          username_hash = excluded.username_hash,
          updated_at = excluded.updated_at
      `,
      [address, username, usernameHash(username), blockTime.iso]
    );
    return;
  }

  if (decoded.eventName === 'UsernameCleared') {
    run(`DELETE FROM usernames WHERE address = ?`, [address]);
  }
}

async function readContractState(config, runtime = {}) {
  if (runtime.readContractWithRetry) {
    return runtime.readContractWithRetry(config);
  }

  return readContractWithRetry(config);
}

async function readLatestCheckpoint(runtime = {}) {
  const latestBlockNumber = runtime.getLatestBlockNumber ? await runtime.getLatestBlockNumber() : await getLatestBlockNumber();
  const latestBlockHash = await readCheckpointHash(latestBlockNumber, runtime);

  return {
    latestBlockNumber: Number(latestBlockNumber || 0),
    latestBlockHash: latestBlockHash || ''
  };
}

function markSyncState(syncKey, startBlock, checkpoint, status = 'idle') {
  updateSyncState(syncKey, {
    startBlock: Number(startBlock),
    lastBlockNumber: Number(checkpoint?.latestBlockNumber || 0),
    lastBlockHash: checkpoint?.latestBlockHash || '',
    status,
    lastError: '',
    startedAt: status === 'syncing' ? nowIso() : '',
    lastSyncedAt: nowIso()
  });
}

function upsertDeclarationState(pactId, participantAddress, declaration, updatedAt) {
  if (!participantAddress || participantAddress === zeroAddress) {
    return;
  }

  run(
    `
      INSERT INTO pact_declarations (
        pact_id,
        participant_address,
        submitted,
        submitted_at,
        declared_winner_address,
        declaration_source,
        tx_hash,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, 'state-backfill', '', ?)
      ON CONFLICT(pact_id, participant_address) DO UPDATE SET
        submitted = excluded.submitted,
        submitted_at = excluded.submitted_at,
        declared_winner_address = excluded.declared_winner_address,
        declaration_source = excluded.declaration_source,
        updated_at = excluded.updated_at
    `,
    [
      pactId,
      normalizeAddress(participantAddress),
      declaration?.[0] ? 1 : 0,
      Number(declaration?.[1] || 0),
      normalizeAddress(declaration?.[2] || zeroAddress),
      updatedAt
    ]
  );
}

function upsertEvidenceState(pactId, participantAddress, evidenceUri, updatedAt) {
  const normalizedAddress = normalizeAddress(participantAddress);
  const normalizedEvidenceUri = String(evidenceUri || '').trim();
  if (!normalizedAddress || normalizedAddress === zeroAddress || !normalizedEvidenceUri) {
    return;
  }

  run(
    `
      INSERT INTO pact_evidence (
        pact_id,
        participant_address,
        evidence_uri,
        source,
        tx_hash,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, 'onchain-state', '', ?, ?)
      ON CONFLICT(pact_id, participant_address, evidence_uri) DO UPDATE SET
        source = excluded.source,
        updated_at = excluded.updated_at
    `,
    [pactId, normalizedAddress, normalizedEvidenceUri, updatedAt, updatedAt]
  );
}

function listPactIdsToReconcile(nextPactId) {
  const highestIndexedPactId = Number(get(`SELECT MAX(pact_id) AS pact_id FROM pacts`)?.pact_id || 0);
  const activePactIds = all(
    `
      SELECT pact_id
      FROM pacts
      WHERE raw_status NOT IN ('Resolved', 'Cancelled')
      ORDER BY pact_id ASC
    `
  ).map((row) => Number(row.pact_id));
  const pactIds = new Set(activePactIds);

  for (let pactId = highestIndexedPactId + 1; pactId < nextPactId; pactId += 1) {
    pactIds.add(pactId);
  }

  return [...pactIds].sort((left, right) => left - right);
}

function chunkValues(values, chunkSize) {
  const size = Math.max(Number(chunkSize || 1), 1);
  const chunks = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

async function reconcileSinglePactFromState(pactId, addresses, runtime = {}) {
  const [core, description, eventType] = await Promise.all([
    readContractState(
      {
        address: addresses.pactManager,
        abi: pactManagerAbi,
        functionName: 'getPactCore',
        args: [BigInt(pactId)]
      },
      runtime
    ),
    readContractState(
      {
        address: addresses.pactManager,
        abi: pactManagerAbi,
        functionName: 'descriptions',
        args: [BigInt(pactId)]
      },
      runtime
    ),
    readContractState(
      {
        address: addresses.pactManager,
        abi: pactManagerAbi,
        functionName: 'eventTypes',
        args: [BigInt(pactId)]
      },
      runtime
    )
  ]);

  const creator = normalizeAddress(core[0]);
  if (!creator || creator === zeroAddress) {
    return;
  }

  const counterparty = normalizeAddress(core[1]);
  const existing = get(
    `
      SELECT created_at, creation_tx_hash, creation_block_number, last_event_block_number, last_event_name, fee_recipient, fee_bps
      FROM pacts
      WHERE pact_id = ?
    `,
    [pactId]
  );
  const updatedAt = nowIso();
  const feeSnapshot = await readContractState(
    {
      address: addresses.pactVault,
      abi: pactVaultAbi,
      functionName: 'pactFeeSnapshotOf',
      args: [BigInt(pactId)]
    },
    runtime
  ).catch(() => [existing?.fee_recipient || zeroAddress, BigInt(Number(existing?.fee_bps || 0)), Boolean(existing?.fee_bps)]);
  const feeRecipient = normalizeAddress(feeSnapshot?.[0] || existing?.fee_recipient || zeroAddress);
  const feeBps = Number(feeSnapshot?.[1] || existing?.fee_bps || 0);
  const feeInitialized = Boolean(feeSnapshot?.[2]);

  run(
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
        event_started_at,
        event_end,
        submission_deadline,
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
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pact_id) DO UPDATE SET
        creator_address = excluded.creator_address,
        counterparty_address = excluded.counterparty_address,
        description = excluded.description,
        event_type = excluded.event_type,
        stake_amount = excluded.stake_amount,
        acceptance_deadline = excluded.acceptance_deadline,
        event_duration_seconds = excluded.event_duration_seconds,
        declaration_window_seconds = excluded.declaration_window_seconds,
        event_started_at = excluded.event_started_at,
        event_end = excluded.event_end,
        submission_deadline = excluded.submission_deadline,
        raw_status = excluded.raw_status,
        is_public = excluded.is_public,
        winner_address = excluded.winner_address,
        agreed_result_hash = excluded.agreed_result_hash,
        updated_at = excluded.updated_at
    `,
    [
      pactId,
      creator,
      counterparty,
      description || '',
      eventType || '',
      core[2].toString(),
      Number(core[3] || 0),
      Number(core[4] || 0),
      Number(core[11] || 0),
      Number(core[5] || 0),
      Number(core[6] || 0),
      Number(core[7] || 0),
      rawStatusMap[Number(core[8])] || 'Unknown',
      counterparty === zeroAddress ? 1 : 0,
      normalizeAddress(core[9] || zeroAddress),
      core[10] || '',
      feeInitialized ? feeRecipient : existing?.fee_recipient || '',
      feeInitialized ? feeBps : Number(existing?.fee_bps || 0),
      existing?.creation_tx_hash || '',
      Number(existing?.creation_block_number || 0),
      Number(existing?.last_event_block_number || 0),
      existing?.last_event_name || 'state-backfill',
      existing?.created_at || updatedAt,
      updatedAt
    ]
  );

  upsertParticipant(pactId, creator, 'creator', updatedAt);
  if (counterparty && counterparty !== zeroAddress) {
    upsertParticipant(pactId, counterparty, 'counterparty', updatedAt);

    const [creatorDeclaration, counterpartyDeclaration] = await Promise.all([
      readContractState(
        {
          address: addresses.submissionManager,
          abi: submissionManagerAbi,
          functionName: 'getDeclaration',
          args: [BigInt(pactId), creator]
        },
        runtime
      ),
      readContractState(
        {
          address: addresses.submissionManager,
          abi: submissionManagerAbi,
          functionName: 'getDeclaration',
          args: [BigInt(pactId), counterparty]
        },
        runtime
      )
    ]);

    upsertDeclarationState(pactId, creator, creatorDeclaration, updatedAt);
    upsertDeclarationState(pactId, counterparty, counterpartyDeclaration, updatedAt);

    if ((rawStatusMap[Number(core[8])] || 'Unknown') === 'Disputed') {
      const [creatorEvidence, counterpartyEvidence] = await Promise.all([
        readContractState(
          {
            address: addresses.pactResolutionManager,
            abi: pactResolutionManagerAbi,
            functionName: 'getDisputeEvidence',
            args: [BigInt(pactId), creator]
          },
          runtime
        ),
        readContractState(
          {
            address: addresses.pactResolutionManager,
            abi: pactResolutionManagerAbi,
            functionName: 'getDisputeEvidence',
            args: [BigInt(pactId), counterparty]
          },
          runtime
        )
      ]);

      upsertEvidenceState(pactId, creator, creatorEvidence, updatedAt);
      upsertEvidenceState(pactId, counterparty, counterpartyEvidence, updatedAt);
    }
  }

  refreshAdminQueue(pactId);
}

async function reconcilePactsFromState(runtime = {}) {
  const addresses = runtime.addresses || apiConfig.addresses;
  if (!addresses.pactManager) {
    return;
  }

  const nextPactIdRaw = await readContractState(
    {
      address: addresses.pactManager,
      abi: pactManagerAbi,
      functionName: 'nextPactId'
    },
    runtime
  );
  const nextPactId = Number(nextPactIdRaw || 1);

  if (nextPactId <= 1) {
    return;
  }

  const pactIds = listPactIdsToReconcile(nextPactId);
  if (!pactIds.length) {
    return;
  }

  const concurrency = Math.max(Number(runtime.stateReconcileConcurrency || apiConfig.stateReconcileConcurrency || 1), 1);
  for (const pactBatch of chunkValues(pactIds, concurrency)) {
    await Promise.all(pactBatch.map((pactId) => reconcileSinglePactFromState(pactId, addresses, runtime)));
  }
}

async function reconcileKnownUsernamesFromState(runtime = {}) {
  const addresses = runtime.addresses || apiConfig.addresses;
  if (!addresses.usernameRegistry) {
    return;
  }

  const participantAddresses = all(
    `
      SELECT creator_address AS address FROM pacts
      UNION
      SELECT counterparty_address AS address FROM pacts
      UNION
      SELECT author_address AS address FROM pact_messages
    `
  )
    .map((row) => normalizeAddress(row.address))
    .filter((address) => address && address !== zeroAddress);

  const seen = new Set();

  for (const participantAddress of participantAddresses) {
    if (seen.has(participantAddress)) {
      continue;
    }

    seen.add(participantAddress);
    const username = String(
      (await readContractState(
        {
          address: addresses.usernameRegistry,
          abi: usernameRegistryAbi,
          functionName: 'usernameOf',
          args: [participantAddress]
        },
        runtime
      ).catch(() => '')) || ''
    )
      .trim()
      .toLowerCase();

    if (!username) {
      continue;
    }

    run(
      `
        INSERT INTO usernames (address, username, username_hash, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(address) DO UPDATE SET
          username = excluded.username,
          username_hash = excluded.username_hash,
          updated_at = excluded.updated_at
      `,
      [participantAddress, username, usernameHash(username), nowIso()]
    );
  }
}

async function syncCoreFromStateSnapshot(startBlock, runtime = {}) {
  ensureSyncState('core', startBlock);
  const checkpoint = await readLatestCheckpoint(runtime);

  markSyncState('core', startBlock, checkpoint, 'syncing');
  await reconcilePactsFromState(runtime);
  markSyncState('core', startBlock, checkpoint, 'idle');
}

async function syncUsernamesFromStateSnapshot(startBlock, runtime = {}) {
  ensureSyncState('usernames', startBlock);
  const checkpoint = await readLatestCheckpoint(runtime);

  markSyncState('usernames', startBlock, checkpoint, 'syncing');
  await reconcileKnownUsernamesFromState(runtime);
  markSyncState('usernames', startBlock, checkpoint, 'idle');
}

async function applyCoreLog(source, log, blockTimeCache, runtime = {}) {
  const blockTime = await getBlockTimeIso(log.blockNumber, blockTimeCache, runtime);

  if (source.key === 'pactManager') {
    let decoded;
    try {
      decoded = decodeEventLog({
        abi: pactManagerEventAbi,
        data: log.data,
        topics: log.topics
      });
    } catch {
      return;
    }
    await applyPactManagerEvent(log, decoded, blockTime);
    return;
  }

  if (source.key === 'submissionManager') {
    let decoded;
    try {
      decoded = decodeEventLog({
        abi: submissionManagerEventAbi,
        data: log.data,
        topics: log.topics
      });
    } catch {
      return;
    }
    applyWinnerDeclared(log, decoded, blockTime);
    return;
  }

  if (source.key === 'resolutionManager') {
    let decoded;
    try {
      decoded = decodeEventLog({
        abi: pactResolutionManagerEventAbi,
        data: log.data,
        topics: log.topics
      });
    } catch {
      return;
    }

    if (decoded.eventName === 'DisputeEvidenceSubmitted') {
      applyEvidenceSubmitted(log, decoded, blockTime);
    }

    if (decoded.eventName === 'PactDisputed') {
      run(
        `
          UPDATE pacts
          SET raw_status = 'Disputed', last_event_block_number = ?, last_event_name = ?, updated_at = ?
          WHERE pact_id = ?
        `,
        [Number(log.blockNumber), decoded.eventName, blockTime.iso, Number(decoded.args.pactId)]
      );
      refreshAdminQueue(Number(decoded.args.pactId));
    }
    return;
  }

  if (source.key === 'pactVault') {
    let decoded;
    try {
      decoded = decodeEventLog({
        abi: pactVaultEventAbi,
        data: log.data,
        topics: log.topics
      });
    } catch {
      return;
    }
    applyFeeSnapshot(log, decoded, blockTime);
  }
}

async function applyUsernameLog(log, blockTimeCache, runtime = {}) {
  let decoded;
  try {
    decoded = decodeEventLog({
      abi: usernameRegistryEventAbi,
      data: log.data,
      topics: log.topics
    });
  } catch {
    return;
  }
  const blockTime = await getBlockTimeIso(log.blockNumber, blockTimeCache, runtime);
  applyUsernameEvent(decoded, blockTime);
}

async function fetchLogsForSource(source, fromBlock, toBlock, runtime = {}) {
  if (!source.address) {
    return [];
  }

  const client = runtime.publicClient || publicClient;
  const logs = await client.getLogs({
    address: source.address,
    fromBlock: BigInt(fromBlock),
    toBlock: BigInt(toBlock)
  });

  return logs.map((log) => ({ ...log, __source: source.key }));
}

async function readCheckpointHash(blockNumber, runtime = {}) {
  if (!Number.isFinite(Number(blockNumber)) || Number(blockNumber) <= 0) {
    return '';
  }

  const client = runtime.publicClient || publicClient;
  const block = await client.getBlock({
    blockNumber: BigInt(blockNumber)
  });
  return block?.hash || '';
}

function clearIndexedRowsForSync(syncKey) {
  if (syncKey === 'core') {
    run(`DELETE FROM admin_queue`);
    run(`DELETE FROM pact_declarations`);
    run(`DELETE FROM pact_participants`);
    run(`DELETE FROM pacts`);
    run(`DELETE FROM pact_evidence WHERE source != 'catbox-metadata'`);
    return;
  }

  if (syncKey === 'usernames') {
    run(`DELETE FROM usernames`);
  }
}

async function ensureReorgSafeCheckpoint(syncKey, startBlock, state, runtime = {}) {
  if (!state?.last_block_number || !state?.last_block_hash) {
    return state;
  }

  const currentHash = await readCheckpointHash(Number(state.last_block_number), runtime);
  if (!currentHash || currentHash === state.last_block_hash) {
    return state;
  }

  clearIndexedRowsForSync(syncKey);
  updateSyncState(syncKey, {
    startBlock: Number(startBlock),
    lastBlockNumber: Math.max(Number(startBlock) - 1, 0),
    lastBlockHash: '',
    status: 'idle',
    lastError: '',
    startedAt: '',
    lastSyncedAt: nowIso()
  });

  return get(`SELECT * FROM sync_state WHERE sync_key = ?`, [syncKey]);
}

export async function syncLogSources({ syncKey, startBlock, sources, applyLog, runtime = {} }) {
  ensureSyncState(syncKey, startBlock);
  let state = get(`SELECT * FROM sync_state WHERE sync_key = ?`, [syncKey]);
  state = await ensureReorgSafeCheckpoint(syncKey, startBlock, state, runtime);
  const latestBlockNumber = runtime.getLatestBlockNumber ? await runtime.getLatestBlockNumber() : await getLatestBlockNumber();
  let fromBlock = Math.max(Number(state?.last_block_number || Math.max(Number(startBlock) - 1, 0)) + 1, Number(startBlock));
  const batchSize = Number(runtime.syncBatchSize || apiConfig.syncBatchSize);
  const maxBatchesPerRun = Math.max(Number(runtime.syncMaxBatchesPerRun || apiConfig.syncMaxBatchesPerRun || 1), 1);
  let processedBatches = 0;

  updateSyncState(syncKey, {
    startBlock: Number(startBlock),
    lastBlockNumber: Number(state?.last_block_number || Math.max(Number(startBlock) - 1, 0)),
    status: 'syncing',
    lastError: '',
    startedAt: nowIso(),
    lastSyncedAt: state?.last_synced_at || ''
  });

  const blockTimeCache = new Map();

  while (fromBlock <= latestBlockNumber && processedBatches < maxBatchesPerRun) {
    const toBlock = Math.min(fromBlock + batchSize - 1, latestBlockNumber);
    const batches = await Promise.all(
      sources.map((source) => fetchLogsForSource(source, fromBlock, toBlock, runtime))
    );
    const logs = batches
      .flat()
      .sort((left, right) => {
        if (left.blockNumber === right.blockNumber) {
          return Number(left.logIndex || 0) - Number(right.logIndex || 0);
        }

        return Number(left.blockNumber) - Number(right.blockNumber);
      });

    for (const log of logs) {
      const source = sources.find((entry) => entry.key === log.__source);
      await applyLog(source, log, blockTimeCache, runtime);
    }

    const lastLog = logs[logs.length - 1];
    const checkpointHash = lastLog?.blockHash || (await readCheckpointHash(toBlock, runtime));
    updateSyncState(syncKey, {
      startBlock: Number(startBlock),
      lastBlockNumber: toBlock,
      lastBlockHash: checkpointHash,
      status: 'syncing',
      lastError: '',
      startedAt: state?.started_at || nowIso(),
      lastSyncedAt: nowIso()
    });

    fromBlock = toBlock + 1;
    processedBatches += 1;
  }

  if (fromBlock > latestBlockNumber) {
    updateSyncState(syncKey, {
      startBlock: Number(startBlock),
      lastBlockNumber: latestBlockNumber,
      status: 'idle',
      lastError: '',
      lastSyncedAt: nowIso()
    });
  }
}

export async function syncOnce(runtime = {}) {
  const contractStartBlocks = runtime.contractStartBlocks || apiConfig.contractStartBlocks;
  const addresses = runtime.addresses || apiConfig.addresses;
  const coreSyncMode = normalizeSyncMode(runtime.coreSyncMode || apiConfig.coreSyncMode, 'state-snapshot');
  const usernameSyncMode = normalizeSyncMode(runtime.usernameSyncMode || apiConfig.usernameSyncMode, 'state-snapshot');
  const coreConfigured = runtime.hasCoreContractsConfigured
    ? runtime.hasCoreContractsConfigured()
    : hasCoreContractsConfigured();
  const usernamesConfigured = runtime.hasUsernameRegistryConfigured
    ? runtime.hasUsernameRegistryConfigured()
    : hasUsernameRegistryConfigured();

  if (coreConfigured) {
    if (coreSyncMode === 'log-backfill') {
      await syncLogSources({
        syncKey: 'core',
        startBlock: contractStartBlocks.core,
        sources: [
          { key: 'pactManager', address: addresses.pactManager },
          { key: 'submissionManager', address: addresses.submissionManager },
          { key: 'resolutionManager', address: addresses.pactResolutionManager },
          { key: 'pactVault', address: addresses.pactVault }
        ],
        applyLog: applyCoreLog,
        runtime
      });
    } else {
      await syncCoreFromStateSnapshot(contractStartBlocks.core, runtime);
    }
  }

  if (usernamesConfigured) {
    if (usernameSyncMode === 'log-backfill') {
      await syncLogSources({
        syncKey: 'usernames',
        startBlock: contractStartBlocks.usernames,
        sources: [{ key: 'usernameRegistry', address: addresses.usernameRegistry }],
        applyLog: (_source, log, blockTimeCache, currentRuntime) => applyUsernameLog(log, blockTimeCache, currentRuntime),
        runtime
      });
    } else {
      await syncUsernamesFromStateSnapshot(contractStartBlocks.usernames, runtime);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function startIndexerLoop({ once = false } = {}) {
  while (true) {
    try {
      await syncOnce();
    } catch (error) {
      const message = error?.message || 'Unknown sync error';
      if (hasCoreContractsConfigured()) {
        updateSyncState('core', {
          startBlock: Number(apiConfig.contractStartBlocks.core),
          status: 'error',
          lastError: message,
          lastSyncedAt: nowIso()
        });
      }

      if (hasUsernameRegistryConfigured()) {
        updateSyncState('usernames', {
          startBlock: Number(apiConfig.contractStartBlocks.usernames),
          status: 'error',
          lastError: message,
          lastSyncedAt: nowIso()
        });
      }

      if (once) {
        throw error;
      }
    }

    if (once) {
      return;
    }

    await sleep(apiConfig.syncPollIntervalMs);
  }
}
