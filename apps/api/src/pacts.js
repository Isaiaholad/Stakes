import { formatUnits, zeroAddress } from 'viem';
import { all, get } from './db.js';

function normalizeAddress(value) {
  return String(value || '').toLowerCase();
}

const singleSubmitterGracePeriodMs = 30 * 60 * 1000;

function toIsoFromUnix(value) {
  const numericValue = Number(value || 0);
  if (!numericValue) {
    return null;
  }

  return new Date(numericValue * 1000).toISOString();
}

function normalizeDeclaration(record) {
  if (!record) {
    return {
      submitted: false,
      submittedAt: null,
      declaredWinner: zeroAddress
    };
  }

  return {
    submitted: Boolean(record.submitted),
    submittedAt: Number(record.submitted_at) ? toIsoFromUnix(record.submitted_at) : null,
    declaredWinner: record.declared_winner_address || zeroAddress
  };
}

function deriveStage(pact) {
  if (pact.rawStatus === 'Cancelled') {
    return 'Cancelled';
  }

  if (pact.rawStatus === 'Resolved') {
    return pact.winner === zeroAddress ? 'Split Completed' : 'Completed';
  }

  if (pact.rawStatus === 'Disputed') {
    return 'Disputed';
  }

  if (pact.rawStatus === 'Proposed') {
    if (pact.acceptanceExpired) {
      return 'Acceptance Timed Out';
    }

    return pact.counterparty === zeroAddress ? 'Open For Join' : 'Pending Acceptance';
  }

  if (pact.rawStatus === 'Active') {
    if (pact.eventEnd && Date.now() < new Date(pact.eventEnd).getTime()) {
      return 'Active';
    }

    if (pact.bothSubmitted && !pact.declarationsMatch) {
      return 'Needs Dispute';
    }

    if (pact.bothSubmitted && pact.declarationsMatch) {
      return 'Ready To Finalize';
    }

    const submissionDeadlineTime = pact.submissionDeadline ? new Date(pact.submissionDeadline).getTime() : 0;
    const singleSubmissionPending =
      pact.creatorDeclaration.submitted !== pact.counterpartyDeclaration.submitted;
    const reviewPeriodOpen =
      Boolean(submissionDeadlineTime) &&
      Date.now() > submissionDeadlineTime &&
      Date.now() <= submissionDeadlineTime + singleSubmitterGracePeriodMs;

    if (singleSubmissionPending && reviewPeriodOpen) {
      return 'Review Period';
    }

    if (pact.submissionDeadline && Date.now() > new Date(pact.submissionDeadline).getTime()) {
      return 'Settlement Due';
    }

    if (!pact.creatorDeclaration.submitted && !pact.counterpartyDeclaration.submitted) {
      return 'Declaration Open';
    }

    if (pact.creatorDeclaration.submitted !== pact.counterpartyDeclaration.submitted) {
      return 'Result Submitted';
    }
  }

  return pact.rawStatus;
}

function getUsernameMap(addresses) {
  const normalizedAddresses = [...new Set(addresses.map(normalizeAddress).filter(Boolean))];
  if (!normalizedAddresses.length) {
    return new Map();
  }

  const placeholders = normalizedAddresses.map(() => '?').join(', ');
  const rows = all(`SELECT address, username FROM usernames WHERE address IN (${placeholders})`, normalizedAddresses);
  return new Map(rows.map((row) => [normalizeAddress(row.address), row.username]));
}

function getMessageCounts(pactIds) {
  if (!pactIds.length) {
    return new Map();
  }

  const placeholders = pactIds.map(() => '?').join(', ');
  const rows = all(
    `
      SELECT pact_id, COUNT(*) AS message_count
      FROM pact_messages
      WHERE pact_id IN (${placeholders}) AND deleted_at = ''
      GROUP BY pact_id
    `,
    pactIds
  );

  return new Map(rows.map((row) => [Number(row.pact_id), Number(row.message_count)]));
}

function getDeclarationMap(pactIds) {
  if (!pactIds.length) {
    return new Map();
  }

  const placeholders = pactIds.map(() => '?').join(', ');
  const rows = all(`SELECT * FROM pact_declarations WHERE pact_id IN (${placeholders})`, pactIds);
  const map = new Map();

  for (const row of rows) {
    const pactId = Number(row.pact_id);
    const existing = map.get(pactId) || [];
    existing.push(row);
    map.set(pactId, existing);
  }

  return map;
}

function getEvidenceMap(pactIds) {
  if (!pactIds.length) {
    return new Map();
  }

  const placeholders = pactIds.map(() => '?').join(', ');
  const rows = all(
    `SELECT * FROM pact_evidence WHERE pact_id IN (${placeholders}) ORDER BY created_at ASC, id ASC`,
    pactIds
  );
  const map = new Map();

  for (const row of rows) {
    const pactId = Number(row.pact_id);
    const existing = map.get(pactId) || [];
    existing.push(row);
    map.set(pactId, existing);
  }

  return map;
}

function buildPactView(record, protocol, currentAddress, usernames, declarationRows, evidenceRows, messageCount) {
  const creator = record.creator_address || zeroAddress;
  const counterparty = record.counterparty_address || zeroAddress;
  const participantRole =
    currentAddress && normalizeAddress(currentAddress) === normalizeAddress(creator)
      ? 'creator'
      : currentAddress && counterparty !== zeroAddress && normalizeAddress(currentAddress) === normalizeAddress(counterparty)
        ? 'counterparty'
        : 'viewer';
  const creatorDeclaration = normalizeDeclaration(
    declarationRows.find((row) => normalizeAddress(row.participant_address) === normalizeAddress(creator))
  );
  const counterpartyDeclaration = normalizeDeclaration(
    declarationRows.find((row) => normalizeAddress(row.participant_address) === normalizeAddress(counterparty))
  );
  const creatorEvidenceRow = evidenceRows.find((row) => normalizeAddress(row.participant_address) === normalizeAddress(creator));
  const counterpartyEvidenceRow = evidenceRows.find(
    (row) => normalizeAddress(row.participant_address) === normalizeAddress(counterparty)
  );
  const bothSubmitted = creatorDeclaration.submitted && counterpartyDeclaration.submitted;
  const declarationsMatch =
    bothSubmitted &&
    normalizeAddress(creatorDeclaration.declaredWinner) === normalizeAddress(counterpartyDeclaration.declaredWinner);
  const declaredWinner = declarationsMatch ? creatorDeclaration.declaredWinner : zeroAddress;
  const acceptanceDeadlineIso = toIsoFromUnix(record.acceptance_deadline);
  const eventStartedAtIso = toIsoFromUnix(record.event_started_at);
  const eventEndIso = toIsoFromUnix(record.event_end);
  const submissionDeadlineIso = toIsoFromUnix(record.submission_deadline);
  const now = Date.now();
  const acceptanceExpired = acceptanceDeadlineIso ? now > new Date(acceptanceDeadlineIso).getTime() : false;
  const stage = deriveStage({
    rawStatus: record.raw_status,
    counterparty,
    acceptanceExpired,
    eventEnd: eventEndIso,
    submissionDeadline: submissionDeadlineIso,
    creatorDeclaration,
    counterpartyDeclaration,
    bothSubmitted,
    declarationsMatch,
    winner: record.winner_address || zeroAddress
  });
  const currentUserEvidence =
    participantRole === 'creator'
      ? creatorEvidenceRow?.evidence_uri || ''
      : participantRole === 'counterparty'
        ? counterpartyEvidenceRow?.evidence_uri || ''
        : '';
  const eventEnded = Boolean(eventEndIso) && now >= new Date(eventEndIso).getTime();
  const declarationWindowClosed =
    Boolean(submissionDeadlineIso) && now > new Date(submissionDeadlineIso).getTime();
  const singleSubmissionPending =
    (creatorDeclaration.submitted && !counterpartyDeclaration.submitted) ||
    (!creatorDeclaration.submitted && counterpartyDeclaration.submitted);
  const singleSubmitterGraceDeadlineMs = submissionDeadlineIso
    ? new Date(submissionDeadlineIso).getTime() + singleSubmitterGracePeriodMs
    : 0;
  const singleSubmitterGraceElapsed =
    Boolean(singleSubmitterGraceDeadlineMs) && now > singleSubmitterGraceDeadlineMs;
  const myDeclaration =
    participantRole === 'creator'
      ? creatorDeclaration
      : participantRole === 'counterparty'
        ? counterpartyDeclaration
        : { submitted: false };
  const hasAdminRole = Boolean(protocol.isAdmin || protocol.isArbiter);
  const hasArbiterRole = Boolean(protocol.isArbiter);
  const missingDeclarerCanDispute =
    (participantRole === 'creator' && !creatorDeclaration.submitted && counterpartyDeclaration.submitted) ||
    (participantRole === 'counterparty' && !counterpartyDeclaration.submitted && creatorDeclaration.submitted);
  const canJoin =
    record.raw_status === 'Proposed' &&
    !acceptanceExpired &&
    currentAddress &&
    normalizeAddress(currentAddress) !== normalizeAddress(creator) &&
    (counterparty === zeroAddress || normalizeAddress(currentAddress) === normalizeAddress(counterparty));
  const canCancel = record.raw_status === 'Proposed' && participantRole === 'creator' && !acceptanceExpired;
  const canCancelExpired = record.raw_status === 'Proposed' && participantRole === 'creator' && acceptanceExpired;
  const canSubmitDeclaration =
    Boolean(currentAddress) &&
    participantRole !== 'viewer' &&
    record.raw_status === 'Active' &&
    eventEnded &&
    !declarationWindowClosed &&
    !myDeclaration.submitted;
  const canFinalize =
    Boolean(currentAddress) &&
    participantRole !== 'viewer' &&
    record.raw_status === 'Active' &&
    bothSubmitted &&
    declarationsMatch;
  const canOpenMismatchDispute =
    Boolean(currentAddress) &&
    record.raw_status === 'Active' &&
    bothSubmitted &&
    !declarationsMatch &&
    (participantRole !== 'viewer' || hasAdminRole);
  const canOpenUnansweredDeclarationDispute =
    Boolean(currentAddress) &&
    record.raw_status === 'Active' &&
    declarationWindowClosed &&
    !singleSubmitterGraceElapsed &&
    singleSubmissionPending &&
    missingDeclarerCanDispute;
  const canSettleAfterDeadline =
    Boolean(currentAddress) &&
    record.raw_status === 'Active' &&
    declarationWindowClosed &&
    (!singleSubmissionPending || singleSubmitterGraceElapsed) &&
    (participantRole !== 'viewer' || hasAdminRole);
  const canSubmitEvidence =
    Boolean(currentAddress) &&
    participantRole !== 'viewer' &&
    record.raw_status === 'Disputed' &&
    !currentUserEvidence;
  const canAdminResolve = hasArbiterRole && record.raw_status === 'Disputed';

  return {
    id: Number(record.pact_id),
    title: record.description || record.event_type || `Pact #${record.pact_id}`,
    description: record.description || '',
    eventType: record.event_type || 'Friendly bet',
    creator,
    counterparty,
    creatorUsername: usernames.get(normalizeAddress(creator)) || '',
    counterpartyUsername: usernames.get(normalizeAddress(counterparty)) || '',
    stakeAmount: record.stake_amount,
    stakeFormatted: formatUnits(BigInt(record.stake_amount || '0'), protocol.decimals),
    acceptanceDeadline: acceptanceDeadlineIso,
    acceptanceExpired,
    eventDurationSeconds: Number(record.event_duration_seconds || 0),
    declarationWindowSeconds: Number(record.declaration_window_seconds || 0),
    eventStartedAt: eventStartedAtIso,
    eventHasStarted: Boolean(eventStartedAtIso),
    eventEnd: eventEndIso,
    eventEnded,
    submissionDeadline: submissionDeadlineIso,
    declarationWindowClosed,
    singleSubmitterGraceDeadline: singleSubmitterGraceDeadlineMs ? new Date(singleSubmitterGraceDeadlineMs).toISOString() : null,
    rawStatus: record.raw_status,
    stage,
    winner: record.winner_address || zeroAddress,
    agreedResultHash: record.agreed_result_hash || '',
    bothSubmitted,
    declarationsMatch,
    declaredWinner,
    creatorDeclaration,
    counterpartyDeclaration,
    creatorEvidence: creatorEvidenceRow?.evidence_uri || '',
    counterpartyEvidence: counterpartyEvidenceRow?.evidence_uri || '',
    currentUserEvidence,
    participantRole,
    isOpen: counterparty === zeroAddress,
    canJoin,
    canCancel,
    canCancelExpired,
    canSubmitDeclaration,
    canFinalize,
    canOpenMismatchDispute,
    canOpenUnansweredDeclarationDispute,
    canSettleAfterDeadline,
    canSubmitEvidence,
    canAdminResolve,
    needsAction:
      Boolean(canJoin) ||
      Boolean(canCancel) ||
      Boolean(canCancelExpired) ||
      Boolean(canSubmitDeclaration) ||
      Boolean(canOpenMismatchDispute) ||
      Boolean(canOpenUnansweredDeclarationDispute) ||
      Boolean(canSettleAfterDeadline) ||
      Boolean(canSubmitEvidence) ||
      Boolean(canAdminResolve),
    feeSnapshot: {
      feeRecipient: record.fee_recipient || zeroAddress,
      feeBps: Number(record.fee_bps || 0)
    },
    messageCount: Number(messageCount || 0)
  };
}

function hydrateRows(rows, protocol, currentAddress) {
  const pactIds = rows.map((row) => Number(row.pact_id));
  const declarationMap = getDeclarationMap(pactIds);
  const evidenceMap = getEvidenceMap(pactIds);
  const usernames = getUsernameMap(
    rows.flatMap((row) => [row.creator_address, row.counterparty_address]).filter(Boolean)
  );
  const messageCounts = getMessageCounts(pactIds);

  return rows.map((row) =>
    buildPactView(
      row,
      protocol,
      currentAddress,
      usernames,
      declarationMap.get(Number(row.pact_id)) || [],
      evidenceMap.get(Number(row.pact_id)) || [],
      messageCounts.get(Number(row.pact_id)) || 0
    )
  );
}

function dedupeRowsByPactId(rows) {
  const seen = new Set();
  const deduped = [];

  for (const row of rows) {
    const pactId = Number(row?.pact_id || 0);
    if (!pactId || seen.has(pactId)) {
      continue;
    }

    seen.add(pactId);
    deduped.push(row);
  }

  return deduped;
}

function listDashboardRows(limit, currentAddress) {
  const safeLimit = Math.max(Number(limit || 0), 0);
  const normalizedCurrentAddress = normalizeAddress(currentAddress);

  if (!safeLimit) {
    return [];
  }

  if (!normalizedCurrentAddress) {
    return all(`SELECT * FROM pacts ORDER BY pact_id DESC LIMIT ?`, [safeLimit]);
  }

  const participantRows = all(
    `
      SELECT *
      FROM pacts
      WHERE creator_address = ? OR counterparty_address = ?
      ORDER BY pact_id DESC
      LIMIT ?
    `,
    [normalizedCurrentAddress, normalizedCurrentAddress, Math.max(safeLimit * 3, safeLimit)]
  );

  const openRows = all(
    `
      SELECT *
      FROM pacts
      WHERE raw_status = 'Proposed' AND counterparty_address = ?
      ORDER BY pact_id DESC
      LIMIT ?
    `,
    [zeroAddress, Math.max(safeLimit * 3, safeLimit)]
  );

  const recentRows = all(`SELECT * FROM pacts ORDER BY pact_id DESC LIMIT ?`, [Math.max(safeLimit * 3, safeLimit)]);

  return dedupeRowsByPactId([...participantRows, ...openRows, ...recentRows]).slice(0, safeLimit);
}

export function listRecentPacts(limit, protocol, currentAddress) {
  const rows = listDashboardRows(limit, currentAddress);
  return hydrateRows(rows, protocol, currentAddress);
}

export function listOpenPacts(limit, protocol, currentAddress) {
  const rows = all(
    `
      SELECT *
      FROM pacts
      WHERE raw_status = 'Proposed' AND counterparty_address = ?
      ORDER BY pact_id DESC
      LIMIT ?
    `,
    [zeroAddress, Math.max(limit * 3, limit)]
  );

  return hydrateRows(rows, protocol, currentAddress)
    .filter((pact) => pact.stage === 'Open For Join')
    .slice(0, limit);
}

export function getPactById(pactId, protocol, currentAddress) {
  const row = get(`SELECT * FROM pacts WHERE pact_id = ?`, [pactId]);
  if (!row) {
    return null;
  }

  return hydrateRows([row], protocol, currentAddress)[0] || null;
}

export function listAdminQueuePacts(limit, protocol, currentAddress) {
  const rows = all(`SELECT * FROM pacts ORDER BY pact_id DESC LIMIT ?`, [limit]);
  return hydrateRows(rows, protocol, currentAddress);
}

export function getPactAccessRecord(pactId) {
  return get(
    `
      SELECT pact_id, creator_address, counterparty_address, raw_status
      FROM pacts
      WHERE pact_id = ?
    `,
    [pactId]
  );
}

export function addressIsParticipant(pactId, address) {
  if (!address) {
    return false;
  }

  const row = get(
    `
      SELECT 1
      FROM pact_participants
      WHERE pact_id = ? AND participant_address = ?
      LIMIT 1
    `,
    [pactId, normalizeAddress(address)]
  );

  return Boolean(row);
}

export function usernameByAddress(address) {
  if (!address) {
    return '';
  }

  const row = get(`SELECT username FROM usernames WHERE address = ?`, [normalizeAddress(address)]);
  return row?.username || '';
}

export function addressByUsername(username) {
  if (!username) {
    return zeroAddress;
  }

  const row = get(`SELECT address FROM usernames WHERE username = ?`, [String(username).trim().toLowerCase()]);
  return row?.address || zeroAddress;
}

export function listPactMessages(pactId, limit = 200) {
  return all(
    `
      SELECT id, pact_id, author_address, body, created_at, updated_at, deleted_at
      FROM pact_messages
      WHERE pact_id = ? AND deleted_at = ''
      ORDER BY created_at ASC
      LIMIT ?
    `,
    [pactId, limit]
  );
}

export function listPactEvidence(pactId) {
  return all(
    `
      SELECT
        id,
        pact_id,
        participant_address,
        evidence_uri,
        source,
        content_hash_sha256,
        mime_type,
        size_bytes,
        original_name,
        tx_hash,
        created_at,
        updated_at
      FROM pact_evidence
      WHERE pact_id = ?
      ORDER BY created_at DESC, id DESC
    `,
    [pactId]
  );
}
