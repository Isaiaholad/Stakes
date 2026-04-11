import {
  BaseError,
  ContractFunctionRevertedError,
  ExecutionRevertedError,
  InsufficientFundsError,
  UserRejectedRequestError,
  createPublicClient,
  decodeEventLog,
  formatUnits,
  http,
  keccak256,
  maxUint256,
  parseUnits,
  stringToHex,
  zeroAddress
} from 'viem';
import { buildQueryString, fetchJson } from './api.js';
import { ensureWalletSession } from './authSession.js';
import {
  protocolControlAbi,
  pactManagerAbi,
  pactResolutionManagerAbi,
  pactVaultAbi,
  stablecoinAbi,
  submissionManagerAbi,
  usernameRegistryAbi,
  ADMIN_ROLE,
  ARBITER_ROLE
} from './abis.js';
import { supportedChain } from './chains.js';
import { hasUsernameRegistryConfigured, protocolConfig, isProtocolConfigured } from './contracts.js';
import { getWalletClient, switchToSupportedChain } from './wallet.js';

const publicClient = createPublicClient({
  chain: supportedChain,
  transport: http(protocolConfig.rpcUrl, {
    retryCount: 6,
    retryDelay: 400
  })
});

const protocolSnapshotTtlMs = 60_000;
let cachedProtocolBase = null;
let cachedProtocolBaseAt = 0;
const listReadConcurrency = 2;
const openFeedCoreReadConcurrency = 3;
const openFeedDetailsReadConcurrency = 2;
const fallbackListBatchSize = 12;
const recentlyCreatedPactTtlMs = 10 * 60_000;
const indexedPactPollIntervalMs = 3_000;
const indexedPactPollTimeoutMs = 2 * 60_000;
const singleSubmitterGracePeriodMs = 30 * 60 * 1000;
const recentlyCreatedPacts = new Map();
const indexedPactPolls = new Map();

const rawStatusMap = {
  0: 'None',
  1: 'Proposed',
  2: 'Active',
  3: 'Disputed',
  4: 'Resolved',
  5: 'Cancelled'
};

function assertConfigured() {
  if (!isProtocolConfigured()) {
    throw new Error('Contract addresses are missing. Update apps/web/.env with the deployed StakeWithFriends contracts.');
  }
}

function assertUsernameRegistryConfigured() {
  if (!hasUsernameRegistryConfigured()) {
    throw new Error('Username registry is missing. Update apps/web/.env with VITE_USERNAME_REGISTRY_ADDRESS.');
  }
}

export function normalizeUsername(value) {
  return String(value || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();
}

export function isValidUsername(value) {
  return /^[a-z0-9_]{3,20}$/.test(normalizeUsername(value));
}

function toIsoFromUnix(value) {
  const numericValue = Number(value || 0);
  if (!numericValue) {
    return null;
  }

  return new Date(numericValue * 1000).toISOString();
}

function normalizeDeclaration(declaration) {
  return {
    submitted: declaration[0],
    submittedAt: Number(declaration[1]) ? toIsoFromUnix(declaration[1]) : null,
    declaredWinner: declaration[2]
  };
}

function normalizeAddress(value) {
  return String(value || '').toLowerCase();
}

function attachReadMeta(payload, source, extra = {}) {
  if (!payload || (typeof payload !== 'object' && !Array.isArray(payload))) {
    return payload;
  }

  Object.defineProperty(payload, '__readMeta', {
    configurable: true,
    enumerable: false,
    value: {
      source,
      ...extra
    }
  });

  return payload;
}

function isUnsetAddress(value) {
  return !value || normalizeAddress(value) === normalizeAddress(zeroAddress);
}

function pruneRecentlyCreatedPacts() {
  const now = Date.now();

  for (const [pactId, entry] of recentlyCreatedPacts.entries()) {
    if (!entry || now - Number(entry.createdAtMs || 0) > recentlyCreatedPactTtlMs) {
      recentlyCreatedPacts.delete(pactId);
    }
  }
}

function getRecentPactEntry(pactId) {
  pruneRecentlyCreatedPacts();
  return recentlyCreatedPacts.get(Number(pactId)) || null;
}

function upsertPactList(list, pact, limit = 0) {
  const current = Array.isArray(list) ? list : [];
  const next = [pact, ...current.filter((item) => Number(item?.id || 0) !== Number(pact.id || 0))].sort(
    (left, right) => Number(right?.id || 0) - Number(left?.id || 0)
  );

  return limit > 0 ? next.slice(0, limit) : next;
}

function materializeRecentPactForAddress(basePact, currentAddress) {
  const normalizedCurrentAddress = normalizeAddress(currentAddress);
  const normalizedCreator = normalizeAddress(basePact.creator);
  const normalizedCounterparty = normalizeAddress(basePact.counterparty);
  const participantRole =
    normalizedCurrentAddress && normalizedCurrentAddress === normalizedCreator
      ? 'creator'
      : normalizedCurrentAddress && normalizedCounterparty && normalizedCurrentAddress === normalizedCounterparty
        ? 'counterparty'
        : 'viewer';
  const canCancel = participantRole === 'creator';

  return {
    ...basePact,
    participantRole,
    currentUserEvidence: '',
    canJoin: false,
    canCancel,
    canCancelExpired: false,
    canSubmitDeclaration: false,
    canFinalize: false,
    canOpenMismatchDispute: false,
    canSettleAfterDeadline: false,
    canSubmitEvidence: false,
    canAdminResolve: false,
    needsAction: canCancel
  };
}

function listRecentOptimisticPacts(currentAddress, { openOnly = false } = {}) {
  pruneRecentlyCreatedPacts();
  const normalizedCurrentAddress = normalizeAddress(currentAddress);

  return Array.from(recentlyCreatedPacts.values())
    .map((entry) => entry?.pact || null)
    .filter(Boolean)
    .filter((pact) => {
      if (openOnly && !pact.isOpen) {
        return false;
      }

      if (!normalizedCurrentAddress) {
        return pact.isOpen;
      }

      return (
        normalizeAddress(pact.creator) === normalizedCurrentAddress ||
        normalizeAddress(pact.counterparty) === normalizedCurrentAddress ||
        pact.isOpen
      );
    })
    .map((pact) => materializeRecentPactForAddress(pact, currentAddress))
    .sort((left, right) => Number(right?.id || 0) - Number(left?.id || 0));
}

function mergeOptimisticPacts(indexedPacts, currentAddress, { openOnly = false, limit = 0 } = {}) {
  const merged = Array.isArray(indexedPacts) ? [...indexedPacts] : [];
  const seen = new Set(merged.map((pact) => Number(pact?.id || 0)));

  for (const pact of listRecentOptimisticPacts(currentAddress, { openOnly })) {
    const pactId = Number(pact?.id || 0);
    if (!pactId || seen.has(pactId)) {
      continue;
    }

    merged.unshift(pact);
    seen.add(pactId);
  }

  merged.sort((left, right) => Number(right?.id || 0) - Number(left?.id || 0));
  return limit > 0 ? merged.slice(0, limit) : merged;
}

function prioritizeDashboardPacts(pacts, currentAddress, limit = 0) {
  const list = Array.isArray(pacts) ? [...pacts] : [];
  const normalizedCurrentAddress = normalizeAddress(currentAddress);

  if (!normalizedCurrentAddress) {
    const ordered = list.sort((left, right) => Number(right?.id || 0) - Number(left?.id || 0));
    return limit > 0 ? ordered.slice(0, limit) : ordered;
  }

  const sortByNewest = (items) => items.sort((left, right) => Number(right?.id || 0) - Number(left?.id || 0));
  const participant = sortByNewest(list.filter((pact) => pact?.participantRole && pact.participantRole !== 'viewer'));
  const open = sortByNewest(list.filter((pact) => pact?.stage === 'Open For Join'));
  const recent = sortByNewest(list);
  const seen = new Set();
  const prioritized = [];

  for (const group of [participant, open, recent]) {
    for (const pact of group) {
      const pactId = Number(pact?.id || 0);
      if (!pactId || seen.has(pactId)) {
        continue;
      }

      seen.add(pactId);
      prioritized.push(pact);

      if (limit > 0 && prioritized.length >= limit) {
        return prioritized;
      }
    }
  }

  return prioritized;
}

function sanitizeReason(value) {
  if (!value) {
    return 'Unknown error';
  }

  const firstLine = String(value)
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) {
    return 'Unknown error';
  }

  return firstLine
    .replace(/^execution reverted:?/i, '')
    .replace(/^The contract function "[^"]+" reverted with the following reason:\s*/i, '')
    .replace(/^The contract function "[^"]+" reverted\.?/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
    .replace(/\.$/, '');
}

function formatTransactionError(error, actionLabel) {
  const action = actionLabel || 'Transaction';

  if (error?.message && /^Status:/i.test(error.message)) {
    return `${action} failed. ${error.message}`;
  }

  if (error?.code === 4001) {
    return `${action} failed. Status: cancelled. Reason: You rejected the transaction in your wallet.`;
  }

  if (error instanceof BaseError) {
    const rejected = error.walk((cause) => cause instanceof UserRejectedRequestError);
    if (rejected) {
      return `${action} failed. Status: cancelled. Reason: You rejected the transaction in your wallet.`;
    }

    const insufficientFunds = error.walk((cause) => cause instanceof InsufficientFundsError);
    if (insufficientFunds) {
      return `${action} failed. Status: failed before submission. Reason: Your wallet does not have enough native gas token to cover the transaction fee.`;
    }

    const reverted = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
    if (reverted?.reason) {
      return `${action} failed. Status: reverted. Reason: ${sanitizeReason(reverted.reason)}.`;
    }

    const executionReverted = error.walk((cause) => cause instanceof ExecutionRevertedError);
    if (executionReverted?.shortMessage) {
      return `${action} failed. Status: reverted. Reason: ${sanitizeReason(executionReverted.shortMessage)}.`;
    }

    if (error.shortMessage && error.shortMessage !== 'An error occurred.') {
      return `${action} failed. Status: failed. Reason: ${sanitizeReason(error.shortMessage)}.`;
    }

    if (error.details) {
      return `${action} failed. Status: failed. Reason: ${sanitizeReason(error.details)}.`;
    }
  }

  if (error?.message) {
    return `${action} failed. Status: failed. Reason: ${sanitizeReason(error.message)}.`;
  }

  return `${action} failed. Status: failed. Reason: Unknown error.`;
}

export function getPublicClient() {
  assertConfigured();
  return publicClient;
}

async function readProtocolBase() {
  assertConfigured();

  if (cachedProtocolBase && Date.now() - cachedProtocolBaseAt < protocolSnapshotTtlMs) {
    return cachedProtocolBase;
  }

  const [decimals, symbol, paused] = await Promise.all([
    readContractWithRetry({
      address: protocolConfig.addresses.stablecoin,
      abi: stablecoinAbi,
      functionName: 'decimals'
    }),
    readContractWithRetry({
      address: protocolConfig.addresses.stablecoin,
      abi: stablecoinAbi,
      functionName: 'symbol'
    }),
    readContractWithRetry({
      address: protocolConfig.addresses.protocolControl,
      abi: protocolControlAbi,
      functionName: 'paused'
    })
  ]);

  cachedProtocolBase = {
    decimals,
    symbol,
    paused
  };
  cachedProtocolBaseAt = Date.now();

  return cachedProtocolBase;
}

export async function readProtocolSnapshot(address) {
  const protocolBase = await readProtocolBase();
  const [arbiterRole, adminRole] = address
    ? await Promise.all([
        readContractWithRetry({
          address: protocolConfig.addresses.protocolControl,
          abi: protocolControlAbi,
          functionName: 'hasRole',
          args: [ARBITER_ROLE, address]
        }),
        readContractWithRetry({
          address: protocolConfig.addresses.protocolControl,
          abi: protocolControlAbi,
          functionName: 'hasRole',
          args: [ADMIN_ROLE, address]
        })
      ])
    : [false, false];

  return attachReadMeta({
    ...protocolBase,
    isArbiter: address ? Boolean(arbiterRole) : false,
    isAdmin: address ? Boolean(adminRole) : false
  }, 'chain');
}

export async function readVaultSnapshot(address) {
  assertConfigured();
  const protocol = await readProtocolSnapshot(address);

  if (!address) {
    return attachReadMeta({
      ...protocol,
      walletBalance: '0',
      allowance: '0',
      availableBalance: '0',
      reservedBalance: '0'
    }, 'chain');
  }

  const [walletBalance, allowance, availableBalance, reservedBalance] = await Promise.all([
    readContractWithRetry({
      address: protocolConfig.addresses.stablecoin,
      abi: stablecoinAbi,
      functionName: 'balanceOf',
      args: [address]
    }),
    readContractWithRetry({
      address: protocolConfig.addresses.stablecoin,
      abi: stablecoinAbi,
      functionName: 'allowance',
      args: [address, protocolConfig.addresses.pactVault]
    }),
    readContractWithRetry({
      address: protocolConfig.addresses.pactVault,
      abi: pactVaultAbi,
      functionName: 'availableBalance',
      args: [address]
    }),
    readContractWithRetry({
      address: protocolConfig.addresses.pactVault,
      abi: pactVaultAbi,
      functionName: 'reservedBalance',
      args: [address]
    })
  ]);

  return attachReadMeta({
    ...protocol,
    walletBalance: formatUnits(walletBalance, protocol.decimals),
    allowance,
    availableBalance: formatUnits(availableBalance, protocol.decimals),
    reservedBalance: formatUnits(reservedBalance, protocol.decimals)
  }, 'chain');
}

export async function readUsernameByAddress(address) {
  assertUsernameRegistryConfigured();

  if (!address || address === zeroAddress) {
    return '';
  }

  try {
    const payload = await fetchJson(`/usernames/address/${address}`);
    if (payload.username) {
      return payload.username;
    }
  } catch {
    // Fall back to the contract read if the indexed API is unavailable.
  }

  return (
    (await readContractWithRetry({
      address: protocolConfig.addresses.usernameRegistry,
      abi: usernameRegistryAbi,
      functionName: 'usernameOf',
      args: [address]
    })) || ''
  );
}

export async function readDisputeOpenedAt(pactId) {
  assertConfigured();

  const openedAt = await readContractWithRetry({
    address: protocolConfig.addresses.pactResolutionManager,
    abi: pactResolutionManagerAbi,
    functionName: 'disputeOpenedAt',
    args: [BigInt(pactId)]
  });

  return Number(openedAt || 0);
}

export async function resolveUsernameToAddress(username) {
  assertUsernameRegistryConfigured();

  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) {
    return zeroAddress;
  }

  try {
    const payload = await fetchJson(`/usernames/resolve${buildQueryString({ username: normalizedUsername })}`);
    if (payload.address && payload.address !== zeroAddress) {
      return payload.address;
    }
  } catch {
    // Fall back to the contract read if the indexed API is unavailable.
  }

  return (
    (await readContractWithRetry({
      address: protocolConfig.addresses.usernameRegistry,
      abi: usernameRegistryAbi,
      functionName: 'resolveUsername',
      args: [normalizedUsername]
    })) || zeroAddress
  );
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

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRateLimitError(error) {
  const values = [
    error?.message,
    error?.shortMessage,
    error?.details,
    error?.cause?.message,
    error?.cause?.shortMessage,
    error?.cause?.details
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());

  return values.some((value) => value.includes('429') || value.includes('requests limited to 15/sec') || value.includes('-32011'));
}

async function readContractWithRetry(config, attempt = 0) {
  try {
    return await publicClient.readContract(config);
  } catch (error) {
    if (attempt >= 3 || !isRateLimitError(error)) {
      throw error;
    }

    await wait(450 * (attempt + 1));
    return readContractWithRetry(config, attempt + 1);
  }
}

async function mapWithConcurrency(items, limit, task) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await task(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.max(1, Math.min(Number(limit) || 1, items.length || 1));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}

function buildPactView(
  id,
  protocol,
  core,
  description,
  eventType,
  creatorDeclaration,
  counterpartyDeclaration,
  bothSubmitted,
  matchInfo,
  evidence,
  currentAddress
) {
  const [
    creator,
    counterparty,
    stakeAmount,
    acceptanceDeadline,
    eventDuration,
    eventStartedAt,
    eventEnd,
    submissionDeadline,
    rawStatusId,
    winner,
    agreedResultHash,
    declarationWindow
  ] = core;
  const rawStatus = rawStatusMap[Number(rawStatusId)] || 'Unknown';
  const participantRole =
    currentAddress?.toLowerCase() === creator.toLowerCase()
      ? 'creator'
      : currentAddress && counterparty !== zeroAddress && currentAddress.toLowerCase() === counterparty.toLowerCase()
        ? 'counterparty'
        : 'viewer';
  const acceptanceDeadlineIso = toIsoFromUnix(acceptanceDeadline);
  const eventStartedAtIso = toIsoFromUnix(eventStartedAt);
  const eventEndIso = toIsoFromUnix(eventEnd);
  const submissionDeadlineIso = toIsoFromUnix(submissionDeadline);
  const now = Date.now();
  const acceptanceExpired = acceptanceDeadlineIso ? now > new Date(acceptanceDeadlineIso).getTime() : false;
  const currentUserEvidence =
    participantRole === 'creator'
      ? evidence.creator
      : participantRole === 'counterparty'
        ? evidence.counterparty
        : '';
  const stage = deriveStage({
    rawStatus,
    counterparty,
    acceptanceExpired,
    eventEnd: eventEndIso,
    submissionDeadline: submissionDeadlineIso,
    creatorDeclaration,
    counterpartyDeclaration,
    bothSubmitted,
    declarationsMatch: matchInfo?.[0],
    winner
  });
  const canJoin =
    rawStatus === 'Proposed' &&
    !acceptanceExpired &&
    currentAddress &&
    currentAddress.toLowerCase() !== creator.toLowerCase() &&
    (counterparty === zeroAddress || currentAddress.toLowerCase() === counterparty.toLowerCase());
  const canCancel = rawStatus === 'Proposed' && participantRole === 'creator' && !acceptanceExpired;
  const canCancelExpired = rawStatus === 'Proposed' && participantRole === 'creator' && acceptanceExpired;
  const eventHasStarted = Boolean(eventStartedAtIso);
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
  const canSubmitDeclaration =
    Boolean(currentAddress) &&
    participantRole !== 'viewer' &&
    rawStatus === 'Active' &&
    eventEnded &&
    !declarationWindowClosed &&
    !myDeclaration.submitted;
  const canFinalize =
    Boolean(currentAddress) &&
    participantRole !== 'viewer' &&
    rawStatus === 'Active' &&
    bothSubmitted &&
    Boolean(matchInfo?.[0]);
  const canOpenMismatchDispute =
    Boolean(currentAddress) &&
    rawStatus === 'Active' &&
    bothSubmitted &&
    !matchInfo?.[0] &&
    (participantRole !== 'viewer' || hasAdminRole);
  const canOpenUnansweredDeclarationDispute =
    Boolean(currentAddress) &&
    rawStatus === 'Active' &&
    declarationWindowClosed &&
    !singleSubmitterGraceElapsed &&
    singleSubmissionPending &&
    missingDeclarerCanDispute;
  const canSettleAfterDeadline =
    Boolean(currentAddress) &&
    rawStatus === 'Active' &&
    declarationWindowClosed &&
    (!singleSubmissionPending || singleSubmitterGraceElapsed) &&
    (participantRole !== 'viewer' || hasAdminRole);
  const canSubmitEvidence =
    Boolean(currentAddress) &&
    participantRole !== 'viewer' &&
    rawStatus === 'Disputed' &&
    !currentUserEvidence;
  const canAdminResolve = hasArbiterRole && rawStatus === 'Disputed';

  return {
    id: Number(id),
    title: description || eventType || `Pact #${id}`,
    description: description || '',
    eventType: eventType || 'Friendly bet',
    creator,
    counterparty,
    stakeAmount,
    stakeFormatted: formatUnits(stakeAmount, protocol.decimals),
    acceptanceDeadline: acceptanceDeadlineIso,
    acceptanceExpired,
    eventDurationSeconds: Number(eventDuration || 0),
    declarationWindowSeconds: Number(declarationWindow || 0),
    eventStartedAt: eventStartedAtIso,
    eventHasStarted,
    eventEnd: eventEndIso,
    eventEnded,
    submissionDeadline: submissionDeadlineIso,
    declarationWindowClosed,
    singleSubmitterGraceDeadline: singleSubmitterGraceDeadlineMs ? new Date(singleSubmitterGraceDeadlineMs).toISOString() : null,
    rawStatus,
    stage,
    winner,
    agreedResultHash,
    bothSubmitted,
    declarationsMatch: Boolean(matchInfo?.[0]),
    declaredWinner: matchInfo?.[1] || zeroAddress,
    creatorDeclaration,
    counterpartyDeclaration,
    creatorEvidence: evidence.creator,
    counterpartyEvidence: evidence.counterparty,
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
      Boolean(canAdminResolve)
  };
}

async function readPactView(pactId, protocol, currentAddress) {
  const [core, description, eventType] = await Promise.all([
    readContractWithRetry({
      address: protocolConfig.addresses.pactManager,
      abi: pactManagerAbi,
      functionName: 'getPactCore',
      args: [pactId]
    }),
    readContractWithRetry({
      address: protocolConfig.addresses.pactManager,
      abi: pactManagerAbi,
      functionName: 'descriptions',
      args: [pactId]
    }),
    readContractWithRetry({
      address: protocolConfig.addresses.pactManager,
      abi: pactManagerAbi,
      functionName: 'eventTypes',
      args: [pactId]
    })
  ]);

  const creator = core[0];
  const counterparty = core[1];
  const rawStatus = rawStatusMap[Number(core[8])] || 'Unknown';
  let creatorDeclaration = { submitted: false, submittedAt: null, declaredWinner: zeroAddress };
  let counterpartyDeclaration = { submitted: false, submittedAt: null, declaredWinner: zeroAddress };
  let bothSubmitted = false;
  let matchInfo = [false, zeroAddress];
  let evidence = { creator: '', counterparty: '' };

  if (counterparty !== zeroAddress && (rawStatus === 'Active' || rawStatus === 'Disputed')) {
    const [creatorRaw, counterpartyRaw, bothSubmittedRaw, matchRaw] = await Promise.all([
      readContractWithRetry({
        address: protocolConfig.addresses.submissionManager,
        abi: submissionManagerAbi,
        functionName: 'getDeclaration',
        args: [pactId, creator]
      }),
      readContractWithRetry({
        address: protocolConfig.addresses.submissionManager,
        abi: submissionManagerAbi,
        functionName: 'getDeclaration',
        args: [pactId, counterparty]
      }),
      readContractWithRetry({
        address: protocolConfig.addresses.submissionManager,
        abi: submissionManagerAbi,
        functionName: 'bothSubmitted',
        args: [pactId]
      }),
      readContractWithRetry({
        address: protocolConfig.addresses.submissionManager,
        abi: submissionManagerAbi,
        functionName: 'declarationsMatch',
        args: [pactId]
      })
    ]);

    creatorDeclaration = normalizeDeclaration(creatorRaw);
    counterpartyDeclaration = normalizeDeclaration(counterpartyRaw);
    bothSubmitted = bothSubmittedRaw;
    matchInfo = matchRaw;

    if (rawStatus === 'Disputed') {
      const [creatorEvidence, counterpartyEvidence] = await Promise.all([
        readContractWithRetry({
          address: protocolConfig.addresses.pactResolutionManager,
          abi: pactResolutionManagerAbi,
          functionName: 'getDisputeEvidence',
          args: [pactId, creator]
        }),
        readContractWithRetry({
          address: protocolConfig.addresses.pactResolutionManager,
          abi: pactResolutionManagerAbi,
          functionName: 'getDisputeEvidence',
          args: [pactId, counterparty]
        })
      ]);

      evidence = {
        creator: creatorEvidence,
        counterparty: counterpartyEvidence
      };
    }
  }

  return buildPactView(
    pactId,
    protocol,
    core,
    description,
    eventType,
    creatorDeclaration,
    counterpartyDeclaration,
    bothSubmitted,
    matchInfo,
    evidence,
    currentAddress
  );
}

async function readNextPactId() {
  return readContractWithRetry({
    address: protocolConfig.addresses.pactManager,
    abi: pactManagerAbi,
    functionName: 'nextPactId'
  });
}

async function fetchIndexedPactById(pactId, currentAddress) {
  const payload = await fetchJson(`/pacts/${Number(pactId)}${buildQueryString({ address: currentAddress })}`);
  return attachReadMeta(payload.pact, 'indexed');
}

function toPactIdRange(highestPactId, count) {
  const ids = [];

  for (let pactId = highestPactId; pactId >= 1 && ids.length < count; pactId -= 1) {
    ids.push(BigInt(pactId));
  }

  return ids;
}

async function readPactListFromChain(currentAddress, { limit = 12, filter = null, concurrency = listReadConcurrency } = {}) {
  const protocol = await readProtocolSnapshot(currentAddress);
  const nextPactId = Number(await readNextPactId());

  if (!nextPactId || nextPactId <= 1) {
    return attachReadMeta([], 'chain');
  }

  const matchedPacts = [];
  let highestPactId = nextPactId - 1;

  while (highestPactId >= 1 && (!limit || matchedPacts.length < limit)) {
    const batchIds = toPactIdRange(highestPactId, fallbackListBatchSize);
    const batch = await mapWithConcurrency(batchIds, concurrency, async (pactId) => {
      try {
        return await readPactView(pactId, protocol, currentAddress);
      } catch {
        return null;
      }
    });

    for (const pact of batch.filter(Boolean)) {
      if (!filter || filter(pact)) {
        matchedPacts.push(pact);
      }
    }

    highestPactId = Number(batchIds[batchIds.length - 1] || 1n) - 1;
  }

  const ordered = matchedPacts.sort((left, right) => Number(right?.id || 0) - Number(left?.id || 0));
  return attachReadMeta(limit > 0 ? ordered.slice(0, limit) : ordered, 'chain');
}

async function readDashboardPactsFromChain(currentAddress, { limit = 12 } = {}) {
  const protocol = await readProtocolSnapshot(currentAddress);
  const nextPactId = Number(await readNextPactId());

  if (!nextPactId || nextPactId <= 1) {
    return attachReadMeta([], 'chain');
  }

  const discoveredPacts = [];
  let highestPactId = nextPactId - 1;
  let scannedCount = 0;
  const maxScanCount = Math.max((limit || 12) * 6, 72);
  const discoveryTarget = Math.max((limit || 12) * 3, limit || 12);

  while (highestPactId >= 1 && scannedCount < maxScanCount && discoveredPacts.length < discoveryTarget) {
    const batchIds = toPactIdRange(highestPactId, fallbackListBatchSize);
    const batch = await mapWithConcurrency(batchIds, listReadConcurrency, async (pactId) => {
      try {
        return await readPactView(pactId, protocol, currentAddress);
      } catch {
        return null;
      }
    });

    discoveredPacts.push(...batch.filter(Boolean));
    scannedCount += batchIds.length;
    highestPactId = Number(batchIds[batchIds.length - 1] || 1n) - 1;
  }

  return attachReadMeta(prioritizeDashboardPacts(discoveredPacts, currentAddress, limit), 'chain');
}

async function fetchIndexedDashboard(currentAddress, limit) {
  const payload = await fetchJson(`/dashboard${buildQueryString({ address: currentAddress, limit })}`);
  return attachReadMeta(Array.isArray(payload.pacts) ? payload.pacts : [], 'indexed');
}

async function fetchIndexedOpenPacts(currentAddress, limit) {
  const payload = await fetchJson(`/pacts/open${buildQueryString({ address: currentAddress, limit })}`);
  return attachReadMeta(Array.isArray(payload.pacts) ? payload.pacts : [], 'indexed');
}

function shouldSkipIndexedRead(preferIndexed) {
  return preferIndexed === false;
}

export async function readAllPacts(currentAddress, options = {}) {
  assertConfigured();
  const limit = Number(options.limit || 0);

  let pacts;
  if (shouldSkipIndexedRead(options.preferIndexed)) {
    pacts = await readDashboardPactsFromChain(currentAddress, { limit: limit || 12 });
  } else {
    try {
      pacts = await fetchIndexedDashboard(currentAddress, limit);
    } catch {
      pacts = await readDashboardPactsFromChain(currentAddress, { limit: limit || 12 });
    }
  }

  return attachReadMeta(
    mergeOptimisticPacts(prioritizeDashboardPacts(Array.isArray(pacts) ? pacts : [], currentAddress, limit || 12), currentAddress, { limit }),
    pacts?.__readMeta?.source || 'indexed'
  );
}

export async function readOpenPacts(currentAddress, options = {}) {
  assertConfigured();
  const limit = Number(options.limit || 0);

  let pacts;
  if (shouldSkipIndexedRead(options.preferIndexed)) {
    pacts = await readPactListFromChain(currentAddress, {
      limit: limit || 18,
      filter: (pact) => pact.stage === 'Open For Join',
      concurrency: openFeedDetailsReadConcurrency
    });
  } else {
    try {
      pacts = await fetchIndexedOpenPacts(currentAddress, limit);
    } catch {
      pacts = await readPactListFromChain(currentAddress, {
        limit: limit || 18,
        filter: (pact) => pact.stage === 'Open For Join',
        concurrency: openFeedDetailsReadConcurrency
      });
    }
  }

  return attachReadMeta(
    mergeOptimisticPacts(Array.isArray(pacts) ? pacts : [], currentAddress, {
      openOnly: true,
      limit
    }),
    pacts?.__readMeta?.source || 'indexed'
  );
}

export async function readPactById(pactId, currentAddress, options = {}) {
  assertConfigured();
  const numericPactId = Number(pactId);
  if (!numericPactId || numericPactId < 1) {
    throw new Error('Pact not found.');
  }

  try {
    if (shouldSkipIndexedRead(options.preferIndexed)) {
      throw new Error('Skipping indexed read until the live chain fallback is preferred.');
    }

    return await fetchIndexedPactById(numericPactId, currentAddress);
  } catch (error) {
    try {
      const protocol = await readProtocolSnapshot(currentAddress);
      return attachReadMeta(await readPactView(numericPactId, protocol, currentAddress), 'chain');
    } catch (chainError) {
      const recentPactEntry = getRecentPactEntry(numericPactId);
      if (!recentPactEntry) {
        throw chainError || error;
      }

      return materializeRecentPactForAddress(recentPactEntry.pact, currentAddress);
    }
  }
}

export function rememberCreatedPactPendingIndex(
  queryClient,
  {
    account,
    pactId,
    title,
    description,
    counterparty,
    eventDurationSeconds,
    declarationWindowSeconds,
    stakeAmount,
    symbol = 'USDC',
    dashboardLimit = 12,
    openFeedLimit = 18
  }
) {
  const numericPactId = Number(pactId);
  if (!numericPactId || !account) {
    return null;
  }

  const now = Date.now();
  const basePact = {
    id: numericPactId,
    title: description || title || `Pact #${numericPactId}`,
    description: description || '',
    eventType: title || description || `Pact #${numericPactId}`,
    creator: account,
    creatorUsername: '',
    counterparty: counterparty || zeroAddress,
    counterpartyUsername: '',
    stakeAmount: String(stakeAmount || '0'),
    stakeFormatted: String(stakeAmount || '0'),
    stakeSymbol: symbol,
    acceptanceDeadline: null,
    acceptanceExpired: false,
    eventDurationSeconds: Number(eventDurationSeconds || 0),
    declarationWindowSeconds: Number(declarationWindowSeconds || 0),
    eventStartedAt: null,
    eventHasStarted: false,
    eventEnd: null,
    eventEnded: false,
    submissionDeadline: null,
    declarationWindowClosed: false,
    rawStatus: 'Proposed',
    stage: isUnsetAddress(counterparty) ? 'Open For Join' : 'Pending Acceptance',
    winner: zeroAddress,
    agreedResultHash: '0x',
    bothSubmitted: false,
    declarationsMatch: false,
    declaredWinner: zeroAddress,
    creatorDeclaration: { submitted: false, submittedAt: null, declaredWinner: zeroAddress },
    counterpartyDeclaration: { submitted: false, submittedAt: null, declaredWinner: zeroAddress },
    creatorEvidence: '',
    counterpartyEvidence: '',
    isOpen: isUnsetAddress(counterparty),
    isPendingIndex: true,
    pendingIndexSince: new Date(now).toISOString()
  };

  pruneRecentlyCreatedPacts();
  recentlyCreatedPacts.set(numericPactId, {
    createdAtMs: now,
    pact: basePact
  });

  if (queryClient) {
    queryClient.setQueryData(['pacts', account, dashboardLimit], (current) =>
      upsertPactList(current, materializeRecentPactForAddress(basePact, account), dashboardLimit)
    );

    if (basePact.isOpen) {
      queryClient.setQueryData(['explore-pacts', openFeedLimit], (current) =>
        upsertPactList(current, materializeRecentPactForAddress(basePact, ''), openFeedLimit)
      );
    }
  }

  if (!queryClient || indexedPactPolls.has(numericPactId)) {
    return basePact;
  }

  const poller = (async () => {
    const startedAt = Date.now();

    while (Date.now() - startedAt < indexedPactPollTimeoutMs) {
      try {
        const indexedPact = await fetchIndexedPactById(numericPactId, account);
        if (indexedPact) {
          recentlyCreatedPacts.delete(numericPactId);
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['pacts'] }),
            queryClient.invalidateQueries({ queryKey: ['explore-pacts'] }),
            queryClient.invalidateQueries({ queryKey: ['admin-pacts'] }),
            queryClient.invalidateQueries({ queryKey: ['pact'] })
          ]);
          return indexedPact;
        }
      } catch {
        // Keep polling until the indexed read model catches up.
      }

      await wait(indexedPactPollIntervalMs);
    }

    return null;
  })().finally(() => {
    indexedPactPolls.delete(numericPactId);
  });

  indexedPactPolls.set(numericPactId, poller);
  return basePact;
}

export function __resetPendingIndexPactsForTests() {
  recentlyCreatedPacts.clear();
  indexedPactPolls.clear();
}

export async function readAdminQueue(currentAddress, options = {}) {
  assertConfigured();
  const limit = Number(options.limit || 0);

  if (!shouldSkipIndexedRead(options.preferIndexed)) {
    try {
      if (currentAddress) {
        await ensureWalletSession(currentAddress, 'Connect your wallet before opening the admin queue.');
      }

      const payload = await fetchJson(`/admin/queue${buildQueryString({ address: currentAddress, limit })}`);
      return attachReadMeta(
        {
          protocol: payload.protocol,
          pacts: Array.isArray(payload.pacts) ? payload.pacts : []
        },
        'indexed'
      );
    } catch {
      // Fall through to the live chain fallback when the indexed admin queue is unavailable or stale.
    }
  }

  const protocol = await readProtocolSnapshot(currentAddress);
  if (!protocol.isAdmin && !protocol.isArbiter) {
    throw new Error('Admin or arbiter access is required.');
  }

  const pacts = await readPactListFromChain(currentAddress, { limit: limit || 50 });
  return attachReadMeta(
    {
      protocol,
      pacts: Array.isArray(pacts) ? pacts : []
    },
    'chain'
  );
}

async function writeContractTransaction({ actionLabel, account, address, abi, functionName, args = [] }) {
  assertConfigured();

  try {
    await switchToSupportedChain();
    const walletClient = getWalletClient(account);
    const { request } = await publicClient.simulateContract({
      account,
      address,
      abi,
      functionName,
      args
    });

    const hash = await walletClient.writeContract({
      ...request,
      account,
      chain: supportedChain,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status === 'reverted') {
      throw new Error(
        `Status: reverted on-chain. Transaction hash: ${receipt.transactionHash || hash}.`
      );
    }

    return receipt;
  } catch (error) {
    throw new Error(formatTransactionError(error, actionLabel || functionName));
  }
}

export async function approveVault(account) {
  return writeContractTransaction({
    actionLabel: 'Approve vault spending',
    account,
    address: protocolConfig.addresses.stablecoin,
    abi: stablecoinAbi,
    functionName: 'approve',
    args: [protocolConfig.addresses.pactVault, maxUint256]
  });
}

export async function depositToVault(account, amount, decimals) {
  return writeContractTransaction({
    actionLabel: 'Deposit',
    account,
    address: protocolConfig.addresses.pactVault,
    abi: pactVaultAbi,
    functionName: 'deposit',
    args: [parseUnits(amount, decimals)]
  });
}

export async function withdrawFromVault(account, amount, decimals) {
  return writeContractTransaction({
    actionLabel: 'Withdraw',
    account,
    address: protocolConfig.addresses.pactVault,
    abi: pactVaultAbi,
    functionName: 'withdraw',
    args: [parseUnits(amount, decimals)]
  });
}

export async function setUsername(account, username) {
  assertUsernameRegistryConfigured();

  const normalizedUsername = normalizeUsername(username);
  if (!isValidUsername(normalizedUsername)) {
    throw new Error('Username must use 3-20 lowercase letters, numbers, or underscores.');
  }

  return writeContractTransaction({
    actionLabel: 'Set username',
    account,
    address: protocolConfig.addresses.usernameRegistry,
    abi: usernameRegistryAbi,
    functionName: 'setUsername',
    args: [normalizedUsername]
  });
}

export async function clearUsername(account) {
  assertUsernameRegistryConfigured();

  return writeContractTransaction({
    actionLabel: 'Clear username',
    account,
    address: protocolConfig.addresses.usernameRegistry,
    abi: usernameRegistryAbi,
    functionName: 'clearUsername',
    args: []
  });
}

export async function createPact(
  account,
  { title, description, counterparty, eventDurationSeconds, declarationWindowSeconds, stakeAmount, decimals }
) {
  const args = [
    counterparty || zeroAddress,
    description || title,
    title,
    BigInt(eventDurationSeconds)
  ];

  if (declarationWindowSeconds) {
    args.push(BigInt(declarationWindowSeconds));
  }

  args.push(parseUnits(stakeAmount, decimals));

  const receipt = await writeContractTransaction({
    actionLabel: 'Create pact',
    account,
    address: protocolConfig.addresses.pactManager,
    abi: pactManagerAbi,
    functionName: 'createPact',
    args
  });

  let pactId = null;

  for (const log of receipt.logs || []) {
    try {
      const decoded = decodeEventLog({
        abi: pactManagerAbi,
        data: log.data,
        topics: log.topics
      });

      if (decoded.eventName === 'PactCreated') {
        pactId = Number(decoded.args.pactId);
        break;
      }
    } catch {
      // Ignore non-matching logs in the receipt.
    }
  }

  return {
    receipt,
    pactId
  };
}

export async function joinPact(account, pactId) {
  return writeContractTransaction({
    actionLabel: 'Join pact',
    account,
    address: protocolConfig.addresses.pactManager,
    abi: pactManagerAbi,
    functionName: 'joinPact',
    args: [BigInt(pactId)]
  });
}

export async function cancelPact(account, pactId) {
  return writeContractTransaction({
    actionLabel: 'Cancel pact',
    account,
    address: protocolConfig.addresses.pactManager,
    abi: pactManagerAbi,
    functionName: 'cancelUnjoinedPact',
    args: [BigInt(pactId)]
  });
}

export async function cancelExpiredPact(account, pactId) {
  return writeContractTransaction({
    actionLabel: 'Cancel expired pact',
    account,
    address: protocolConfig.addresses.pactManager,
    abi: pactManagerAbi,
    functionName: 'cancelExpiredPact',
    args: [BigInt(pactId)]
  });
}

export async function submitWinner(account, pactId, declaredWinner) {
  return writeContractTransaction({
    actionLabel: 'Submit winner',
    account,
    address: protocolConfig.addresses.submissionManager,
    abi: submissionManagerAbi,
    functionName: 'submitWinner',
    args: [BigInt(pactId), declaredWinner]
  });
}

export async function finalizeMatchedResult(account, pactId) {
  return writeContractTransaction({
    actionLabel: 'Finalize result',
    account,
    address: protocolConfig.addresses.pactResolutionManager,
    abi: pactResolutionManagerAbi,
    functionName: 'finalizeMatchedResult',
    args: [BigInt(pactId)]
  });
}

export async function openMismatchDispute(account, pactId) {
  return writeContractTransaction({
    actionLabel: 'Open mismatch dispute',
    account,
    address: protocolConfig.addresses.pactResolutionManager,
    abi: pactResolutionManagerAbi,
    functionName: 'openDisputeFromMismatch',
    args: [BigInt(pactId)]
  });
}

export async function openUnansweredDeclarationDispute(account, pactId) {
  return writeContractTransaction({
    actionLabel: 'Open unanswered declaration dispute',
    account,
    address: protocolConfig.addresses.pactResolutionManager,
    abi: pactResolutionManagerAbi,
    functionName: 'openDisputeFromUnansweredDeclaration',
    args: [BigInt(pactId)]
  });
}

export async function settleAfterDeclarationWindow(account, pactId) {
  return writeContractTransaction({
    actionLabel: 'Settle declaration window',
    account,
    address: protocolConfig.addresses.pactResolutionManager,
    abi: pactResolutionManagerAbi,
    functionName: 'settleAfterDeclarationWindow',
    args: [BigInt(pactId)]
  });
}

export async function submitDisputeEvidence(account, pactId, evidenceUri) {
  return writeContractTransaction({
    actionLabel: 'Submit dispute evidence',
    account,
    address: protocolConfig.addresses.pactResolutionManager,
    abi: pactResolutionManagerAbi,
    functionName: 'submitDisputeEvidence',
    args: [BigInt(pactId), evidenceUri]
  });
}

export async function adminResolveWinner(account, pactId, winner, resolutionRef) {
  return writeContractTransaction({
    actionLabel: 'Resolve winner',
    account,
    address: protocolConfig.addresses.pactResolutionManager,
    abi: pactResolutionManagerAbi,
    functionName: 'adminResolveWinner',
    args: [BigInt(pactId), winner, keccak256(stringToHex(resolutionRef || 'manual-review'))]
  });
}

export async function adminResolveSplit(account, pactId, creatorShareBps, resolutionRef) {
  return writeContractTransaction({
    actionLabel: 'Resolve split',
    account,
    address: protocolConfig.addresses.pactResolutionManager,
    abi: pactResolutionManagerAbi,
    functionName: 'adminResolveSplit',
    args: [BigInt(pactId), creatorShareBps, keccak256(stringToHex(resolutionRef || 'manual-review'))]
  });
}

export async function forceSplitAfterDisputeTimeout(account, pactId) {
  return writeContractTransaction({
    actionLabel: 'Force dispute split',
    account,
    address: protocolConfig.addresses.pactResolutionManager,
    abi: pactResolutionManagerAbi,
    functionName: 'forceSplitAfterDisputeTimeout',
    args: [BigInt(pactId)]
  });
}
