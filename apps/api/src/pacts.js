import { formatUnits, zeroAddress } from 'viem';
import { all, get, nowIso, run } from './db.js';

function normalizeAddress(value) {
  return String(value || '').toLowerCase();
}

const singleSubmitterGracePeriodMs = 30 * 60 * 1000;
const leaderboardPointsModel = 'balanced-xp-v1';
const leaderboardGamePresets = ['eFootball', 'Chess'];
const normalizedZeroAddress = normalizeAddress(zeroAddress);

function maskAddress(value) {
  const address = String(value || '');
  if (!address) {
    return 'Unknown player';
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function normalizeGameFilter(value) {
  return String(value || 'all').trim().toLowerCase();
}

function isJoinedAddress(value) {
  const normalizedAddress = normalizeAddress(value);
  return Boolean(normalizedAddress && normalizedAddress !== normalizedZeroAddress);
}

function isValidLeaderboardResult(row) {
  const creator = normalizeAddress(row?.creator_address);
  const counterparty = normalizeAddress(row?.counterparty_address);
  const winner = normalizeAddress(row?.winner_address);

  return (
    isJoinedAddress(creator) &&
    isJoinedAddress(counterparty) &&
    Boolean(winner) &&
    (winner === normalizedZeroAddress || winner === creator || winner === counterparty)
  );
}

function parseStakeRaw(value) {
  try {
    return BigInt(String(value || '0'));
  } catch {
    return 0n;
  }
}

function compareBigIntDescending(left, right) {
  if (left === right) {
    return 0;
  }

  return left > right ? -1 : 1;
}

function timestampMs(value) {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sortGameNames(games) {
  return [...games].sort((left, right) => {
    const leftPresetIndex = leaderboardGamePresets.findIndex((game) => game.toLowerCase() === String(left).toLowerCase());
    const rightPresetIndex = leaderboardGamePresets.findIndex((game) => game.toLowerCase() === String(right).toLowerCase());
    const leftIsPreset = leftPresetIndex !== -1;
    const rightIsPreset = rightPresetIndex !== -1;

    if (leftIsPreset && rightIsPreset) {
      return leftPresetIndex - rightPresetIndex;
    }

    if (leftIsPreset) {
      return -1;
    }

    if (rightIsPreset) {
      return 1;
    }

    return String(left).localeCompare(String(right));
  });
}

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

function isOnChainEvidenceRow(row) {
  return Boolean(String(row?.tx_hash || '').trim());
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

async function getUsernameMap(addresses) {
  const normalizedAddresses = [...new Set(addresses.map(normalizeAddress).filter(Boolean))];
  if (!normalizedAddresses.length) {
    return new Map();
  }

  const placeholders = normalizedAddresses.map(() => '?').join(', ');
  const rows = await all(`SELECT address, username FROM usernames WHERE address IN (${placeholders})`, normalizedAddresses);
  return new Map(rows.map((row) => [normalizeAddress(row.address), row.username]));
}

async function getMessageCounts(pactIds) {
  if (!pactIds.length) {
    return new Map();
  }

  const placeholders = pactIds.map(() => '?').join(', ');
  const rows = await all(
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

async function getDeclarationMap(pactIds) {
  if (!pactIds.length) {
    return new Map();
  }

  const placeholders = pactIds.map(() => '?').join(', ');
  const rows = await all(`SELECT * FROM pact_declarations WHERE pact_id IN (${placeholders})`, pactIds);
  const map = new Map();

  for (const row of rows) {
    const pactId = Number(row.pact_id);
    const existing = map.get(pactId) || [];
    existing.push(row);
    map.set(pactId, existing);
  }

  return map;
}

async function getEvidenceMap(pactIds) {
  if (!pactIds.length) {
    return new Map();
  }

  const placeholders = pactIds.map(() => '?').join(', ');
  const rows = await all(
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
  const creatorEvidenceRows = evidenceRows.filter((row) => normalizeAddress(row.participant_address) === normalizeAddress(creator));
  const counterpartyEvidenceRows = evidenceRows.filter(
    (row) => normalizeAddress(row.participant_address) === normalizeAddress(counterparty)
  );
  const creatorEvidenceRow = creatorEvidenceRows[0];
  const counterpartyEvidenceRow = counterpartyEvidenceRows[0];
  const creatorOnChainEvidenceRow = creatorEvidenceRows.find(isOnChainEvidenceRow);
  const counterpartyOnChainEvidenceRow = counterpartyEvidenceRows.find(isOnChainEvidenceRow);
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
  const currentUserOnChainEvidence =
    participantRole === 'creator'
      ? creatorOnChainEvidenceRow?.evidence_uri || ''
      : participantRole === 'counterparty'
        ? counterpartyOnChainEvidenceRow?.evidence_uri || ''
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
  const isJoinedParticipant = participantRole === 'creator' || participantRole === 'counterparty';
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
    (isJoinedParticipant || hasAdminRole);
  const canSubmitEvidence =
    Boolean(currentAddress) &&
    participantRole !== 'viewer' &&
    record.raw_status === 'Disputed' &&
    !currentUserOnChainEvidence;
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
    creatorOnChainEvidence: creatorOnChainEvidenceRow?.evidence_uri || '',
    counterpartyOnChainEvidence: counterpartyOnChainEvidenceRow?.evidence_uri || '',
    creatorEvidenceOnChain: Boolean(creatorOnChainEvidenceRow),
    counterpartyEvidenceOnChain: Boolean(counterpartyOnChainEvidenceRow),
    hasOnChainDisputeEvidence: Boolean(creatorOnChainEvidenceRow || counterpartyOnChainEvidenceRow),
    currentUserEvidence,
    currentUserOnChainEvidence,
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

async function hydrateRows(rows, protocol, currentAddress) {
  const pactIds = rows.map((row) => Number(row.pact_id));
  const declarationMap = await getDeclarationMap(pactIds);
  const evidenceMap = await getEvidenceMap(pactIds);
  const usernames = await getUsernameMap(
    rows.flatMap((row) => [row.creator_address, row.counterparty_address]).filter(Boolean)
  );
  const messageCounts = await getMessageCounts(pactIds);

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

async function getLeaderboardEvidencePairs(pactIds) {
  if (!pactIds.length) {
    return new Set();
  }

  const placeholders = pactIds.map(() => '?').join(', ');
  const rows = await all(
    `
      SELECT pact_id, participant_address
      FROM pact_evidence
      WHERE pact_id IN (${placeholders})
      GROUP BY pact_id, participant_address
    `,
    pactIds
  );

  return new Set(rows.map((row) => `${Number(row.pact_id)}:${normalizeAddress(row.participant_address)}`));
}

function createLeaderboardAccumulator(address) {
  return {
    address,
    matches: 0,
    wins: 0,
    losses: 0,
    splits: 0,
    evidenceCount: 0,
    totalStakeRaw: 0n,
    lastResolvedAt: '',
    lastResolvedPactId: 0,
    gameCounts: new Map(),
    resolvedResults: []
  };
}

function getFavoriteGame(gameCounts) {
  const rankedGames = [...gameCounts.entries()].sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }

    return String(left[0]).localeCompare(String(right[0]));
  });

  return rankedGames[0]?.[0] || 'Unknown';
}

function getCurrentStreak(resolvedResults) {
  const latestResults = [...resolvedResults].sort((left, right) => {
    const timeDelta = timestampMs(right.resolvedAt) - timestampMs(left.resolvedAt);
    if (timeDelta !== 0) {
      return timeDelta;
    }

    return Number(right.pactId || 0) - Number(left.pactId || 0);
  });

  let streak = 0;
  for (const result of latestResults) {
    if (!result.won) {
      break;
    }

    streak += 1;
  }

  return streak;
}

function buildLeaderboardEntry(accumulator, usernames) {
  const username = usernames.get(accumulator.address) || '';
  const currentStreak = getCurrentStreak(accumulator.resolvedResults);
  const winDenominator = accumulator.wins + accumulator.losses;
  const winRate = winDenominator ? accumulator.wins / winDenominator : 0;
  const points =
    accumulator.matches * 20 +
    accumulator.wins * 60 +
    accumulator.splits * 10 +
    accumulator.evidenceCount * 10 +
    Math.min(currentStreak * 10, 50);

  return {
    rank: 0,
    address: accumulator.address,
    username,
    displayName: username ? `@${username}` : maskAddress(accumulator.address),
    points,
    matches: accumulator.matches,
    wins: accumulator.wins,
    losses: accumulator.losses,
    splits: accumulator.splits,
    winRate,
    currentStreak,
    evidenceCount: accumulator.evidenceCount,
    favoriteGame: getFavoriteGame(accumulator.gameCounts),
    totalStakeRaw: accumulator.totalStakeRaw.toString(),
    lastResolvedAt: accumulator.lastResolvedAt || null
  };
}

function compareLeaderboardEntries(left, right) {
  if (right.points !== left.points) {
    return right.points - left.points;
  }

  if (right.wins !== left.wins) {
    return right.wins - left.wins;
  }

  if (right.winRate !== left.winRate) {
    return right.winRate - left.winRate;
  }

  const stakeComparison = compareBigIntDescending(parseStakeRaw(left.totalStakeRaw), parseStakeRaw(right.totalStakeRaw));
  if (stakeComparison !== 0) {
    return stakeComparison;
  }

  const resolvedAtComparison = timestampMs(right.lastResolvedAt) - timestampMs(left.lastResolvedAt);
  if (resolvedAtComparison !== 0) {
    return resolvedAtComparison;
  }

  return left.address.localeCompare(right.address);
}

export function buildLeaderboardPayload({
  rows = [],
  evidencePairs = new Set(),
  usernameMap = new Map(),
  game = 'all',
  limit = 50,
  viewerAddress = '',
  updatedAt = nowIso()
} = {}) {
  const safeLimit = Math.min(Math.max(Number(limit || 50), 1), 100);
  const normalizedGameFilter = normalizeGameFilter(game);
  const normalizedViewerAddress = normalizeAddress(viewerAddress);
  const joinedRows = rows.filter(isValidLeaderboardResult);
  const availableGames = sortGameNames(
    new Set(joinedRows.map((row) => String(row.event_type || '').trim()).filter(Boolean))
  );
  const filteredRows =
    normalizedGameFilter === 'all'
      ? joinedRows
      : joinedRows.filter((row) => normalizeGameFilter(row.event_type) === normalizedGameFilter);
  const players = new Map();

  for (const row of filteredRows) {
    const pactId = Number(row.pact_id || 0);
    const creator = normalizeAddress(row.creator_address);
    const counterparty = normalizeAddress(row.counterparty_address);
    const winner = normalizeAddress(row.winner_address);
    const isSplit = winner === normalizedZeroAddress;
    const resolvedAt = row.updated_at || row.created_at || '';
    const stakeRaw = parseStakeRaw(row.stake_amount);
    const gameName = String(row.event_type || '').trim() || 'Unknown';

    for (const address of [creator, counterparty]) {
      if (!players.has(address)) {
        players.set(address, createLeaderboardAccumulator(address));
      }

      const player = players.get(address);
      const won = !isSplit && winner === address;
      player.matches += 1;
      player.totalStakeRaw += stakeRaw;
      player.gameCounts.set(gameName, Number(player.gameCounts.get(gameName) || 0) + 1);
      player.resolvedResults.push({
        pactId,
        resolvedAt,
        won
      });

      if (isSplit) {
        player.splits += 1;
      } else if (won) {
        player.wins += 1;
      } else {
        player.losses += 1;
      }

      if (evidencePairs.has(`${pactId}:${address}`)) {
        player.evidenceCount += 1;
      }

      const latestKnownTime = timestampMs(player.lastResolvedAt);
      const nextTime = timestampMs(resolvedAt);
      if (
        nextTime > latestKnownTime ||
        (nextTime === latestKnownTime && pactId > Number(player.lastResolvedPactId || 0))
      ) {
        player.lastResolvedAt = resolvedAt;
        player.lastResolvedPactId = pactId;
      }
    }
  }

  const rankedLeaderboard = [...players.values()]
    .map((player) => buildLeaderboardEntry(player, usernameMap))
    .sort(compareLeaderboardEntries)
    .map((entry, index) => ({
      ...entry,
      rank: index + 1
    }));
  const viewerRank =
    normalizedViewerAddress && rankedLeaderboard.find((entry) => normalizeAddress(entry.address) === normalizedViewerAddress)
      ? rankedLeaderboard.find((entry) => normalizeAddress(entry.address) === normalizedViewerAddress)
      : null;

  return {
    leaderboard: rankedLeaderboard.slice(0, safeLimit),
    availableGames,
    pointsModel: leaderboardPointsModel,
    updatedAt,
    viewerRank
  };
}

export async function listLeaderboard({ game = 'all', limit = 50, viewerAddress = '' } = {}) {
  const resolvedRows = await all(
    `
      SELECT
        pact_id,
        creator_address,
        counterparty_address,
        event_type,
        stake_amount,
        winner_address,
        created_at,
        updated_at
      FROM pacts
      WHERE raw_status = 'Resolved'
        AND creator_address <> ?
        AND counterparty_address <> ?
      ORDER BY updated_at DESC, pact_id DESC
    `,
    [zeroAddress, zeroAddress]
  );
  const normalizedGameFilter = normalizeGameFilter(game);
  const joinedRows = resolvedRows.filter(isValidLeaderboardResult);
  const filteredRows =
    normalizedGameFilter === 'all'
      ? joinedRows
      : joinedRows.filter((row) => normalizeGameFilter(row.event_type) === normalizedGameFilter);
  const pactIds = filteredRows.map((row) => Number(row.pact_id)).filter(Boolean);
  const evidencePairs = await getLeaderboardEvidencePairs(pactIds);
  const playerAddresses = [
    ...new Set(filteredRows.flatMap((row) => [row.creator_address, row.counterparty_address]).map(normalizeAddress).filter(Boolean))
  ];
  const usernameMap = await getUsernameMap(playerAddresses);

  return buildLeaderboardPayload({
    rows: resolvedRows,
    evidencePairs,
    usernameMap,
    game,
    limit,
    viewerAddress
  });
}

async function listDashboardRows(limit, currentAddress) {
  const safeLimit = Math.max(Number(limit || 0), 0);
  const normalizedCurrentAddress = normalizeAddress(currentAddress);

  if (!safeLimit) {
    return [];
  }

  if (!normalizedCurrentAddress) {
    return await all(
      `
        SELECT *
        FROM pacts
        WHERE raw_status = 'Proposed' AND counterparty_address = ?
        ORDER BY pact_id DESC
        LIMIT ?
      `,
      [zeroAddress, safeLimit]
    );
  }

  const participantRows = await all(
    `
      SELECT *
      FROM pacts
      WHERE creator_address = ? OR counterparty_address = ?
      ORDER BY pact_id DESC
      LIMIT ?
    `,
    [normalizedCurrentAddress, normalizedCurrentAddress, Math.max(safeLimit * 3, safeLimit)]
  );

  const openRows = await all(
    `
      SELECT *
      FROM pacts
      WHERE raw_status = 'Proposed' AND counterparty_address = ?
      ORDER BY pact_id DESC
      LIMIT ?
    `,
    [zeroAddress, Math.max(safeLimit * 3, safeLimit)]
  );

  return dedupeRowsByPactId([...participantRows, ...openRows]).slice(0, safeLimit);
}

export async function listRecentPacts(limit, protocol, currentAddress) {
  const rows = await listDashboardRows(limit, currentAddress);
  return await hydrateRows(rows, protocol, currentAddress);
}

export async function listOpenPacts(limit, protocol, currentAddress) {
  const rows = await all(
    `
      SELECT *
      FROM pacts
      WHERE raw_status = 'Proposed' AND counterparty_address = ?
      ORDER BY pact_id DESC
      LIMIT ?
    `,
    [zeroAddress, Math.max(limit * 3, limit)]
  );

  const hydratedRows = await hydrateRows(rows, protocol, currentAddress);
  return hydratedRows
    .filter((pact) => pact.stage === 'Open For Join')
    .slice(0, limit);
}

export async function getPactById(pactId, protocol, currentAddress) {
  const row = await get(`SELECT * FROM pacts WHERE pact_id = ?`, [pactId]);
  if (!row) {
    return null;
  }

  const [pact] = await hydrateRows([row], protocol, currentAddress);
  return pact || null;
}

export async function listAdminQueuePacts(limit, protocol, currentAddress) {
  const rows = await all(`SELECT * FROM pacts ORDER BY pact_id DESC LIMIT ?`, [limit]);
  return await hydrateRows(rows, protocol, currentAddress);
}

export async function getPactAccessRecord(pactId) {
  return await get(
    `
      SELECT pact_id, creator_address, counterparty_address, raw_status, event_type, description
      FROM pacts
      WHERE pact_id = ?
    `,
    [pactId]
  );
}

export async function addressIsParticipant(pactId, address) {
  if (!address) {
    return false;
  }

  const row = await get(
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

export async function usernameByAddress(address) {
  if (!address) {
    return '';
  }

  const row = await get(`SELECT username FROM usernames WHERE address = ?`, [normalizeAddress(address)]);
  return row?.username || '';
}

export async function addressByUsername(username) {
  if (!username) {
    return zeroAddress;
  }

  const row = await get(`SELECT address FROM usernames WHERE username = ?`, [String(username).trim().toLowerCase()]);
  return row?.address || zeroAddress;
}

export async function listPactMessages(pactId, limit = 200) {
  return await all(
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

export async function listPactEvidence(pactId) {
  return await all(
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

function normalizeChessColor(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'white') {
    return 'White';
  }
  if (normalized === 'black') {
    return 'Black';
  }
  return '';
}

function normalizePlatformUsername(value) {
  return String(value || '').trim().replace(/^@+/, '');
}

function normalizeGameMetadataRow(row) {
  if (!row) {
    return null;
  }

  let analysis = null;
  if (row.analysis_json) {
    try {
      analysis = JSON.parse(row.analysis_json);
    } catch {
      analysis = null;
    }
  }

  return {
    pactId: Number(row.pact_id),
    gameType: row.game_type || '',
    platform: row.platform || '',
    creatorPlatformUsername: row.creator_platform_username || '',
    counterpartyPlatformUsername: row.counterparty_platform_username || '',
    creatorColor: row.creator_color || '',
    counterpartyColor: row.counterparty_color || '',
    gameUrl: row.game_url || '',
    verificationStatus: row.verification_status || '',
    verificationSource: row.verification_source || '',
    verificationConfidence: Number(row.verification_confidence || 0),
    analysis,
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || ''
  };
}

export async function getPactGameMetadata(pactId) {
  const row = await get(
    `
      SELECT *
      FROM pact_game_metadata
      WHERE pact_id = ?
      LIMIT 1
    `,
    [Number(pactId)]
  );

  return normalizeGameMetadataRow(row);
}

export async function upsertPactGameMetadata(pactId, patch = {}) {
  const existing = await getPactGameMetadata(pactId);
  const now = nowIso();
  const next = {
    pactId: Number(pactId),
    gameType: String(patch.gameType ?? existing?.gameType ?? '').trim(),
    platform: String(patch.platform ?? existing?.platform ?? '').trim(),
    creatorPlatformUsername: normalizePlatformUsername(
      patch.creatorPlatformUsername ?? existing?.creatorPlatformUsername ?? ''
    ),
    counterpartyPlatformUsername: normalizePlatformUsername(
      patch.counterpartyPlatformUsername ?? existing?.counterpartyPlatformUsername ?? ''
    ),
    creatorColor: normalizeChessColor(patch.creatorColor ?? existing?.creatorColor ?? ''),
    counterpartyColor: normalizeChessColor(patch.counterpartyColor ?? existing?.counterpartyColor ?? ''),
    gameUrl: String(patch.gameUrl ?? existing?.gameUrl ?? '').trim(),
    verificationStatus: String(patch.verificationStatus ?? existing?.verificationStatus ?? '').trim(),
    verificationSource: String(patch.verificationSource ?? existing?.verificationSource ?? '').trim(),
    verificationConfidence: Number(patch.verificationConfidence ?? existing?.verificationConfidence ?? 0),
    analysis: patch.analysis ?? existing?.analysis ?? null,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };

  await run(
    `
      INSERT INTO pact_game_metadata (
        pact_id,
        game_type,
        platform,
        creator_platform_username,
        counterparty_platform_username,
        creator_color,
        counterparty_color,
        game_url,
        verification_status,
        verification_source,
        verification_confidence,
        analysis_json,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (pact_id) DO UPDATE SET
        game_type = excluded.game_type,
        platform = excluded.platform,
        creator_platform_username = excluded.creator_platform_username,
        counterparty_platform_username = excluded.counterparty_platform_username,
        creator_color = excluded.creator_color,
        counterparty_color = excluded.counterparty_color,
        game_url = excluded.game_url,
        verification_status = excluded.verification_status,
        verification_source = excluded.verification_source,
        verification_confidence = excluded.verification_confidence,
        analysis_json = excluded.analysis_json,
        updated_at = excluded.updated_at
    `,
    [
      next.pactId,
      next.gameType,
      next.platform,
      next.creatorPlatformUsername,
      next.counterpartyPlatformUsername,
      next.creatorColor,
      next.counterpartyColor,
      next.gameUrl,
      next.verificationStatus,
      next.verificationSource,
      next.verificationConfidence,
      next.analysis ? JSON.stringify(next.analysis) : '',
      next.createdAt,
      next.updatedAt
    ]
  );

  return await getPactGameMetadata(pactId);
}
