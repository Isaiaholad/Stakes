import { shortenAddress } from '../../lib/formatters.js';

export const adminPactLimit = 200;
export const unsetAddress = '0x0000000000000000000000000000000000000000';
export const disputeReviewWindowMs = 24 * 60 * 60 * 1000;
export const disputeTimeoutMs = 7 * 24 * 60 * 60 * 1000;

export function matchesAdminSearch(pact, value) {
  const searchValue = String(value || '').trim().toLowerCase();
  if (!searchValue) {
    return true;
  }

  return [
    String(pact.id),
    pact.stage,
    pact.rawStatus,
    pact.title,
    pact.description,
    pact.eventType,
    pact.creator,
    pact.counterparty,
    pact.creatorUsername,
    pact.counterpartyUsername
  ]
    .filter(Boolean)
    .some((field) => String(field).toLowerCase().includes(searchValue));
}

export function formatWinnerLabel(address, pact) {
  if (!address || address === unsetAddress) {
    return 'Split';
  }

  if (address.toLowerCase() === String(pact.creator || '').toLowerCase()) {
    return pact.creatorUsername ? `@${pact.creatorUsername}` : shortenAddress(pact.creator);
  }

  if (address.toLowerCase() === String(pact.counterparty || '').toLowerCase()) {
    return pact.counterpartyUsername ? `@${pact.counterpartyUsername}` : shortenAddress(pact.counterparty);
  }

  return shortenAddress(address);
}

export function getPartyLabel(address, username) {
  if (!address || address === unsetAddress) {
    return 'Open join';
  }

  return username ? `@${username}` : shortenAddress(address);
}

export function getDisputeProofState(pact) {
  if (pact.rawStatus !== 'Disputed') {
    return {
      label: 'Conflict waiting for dispute',
      shell: 'bg-rose-100 text-rose-800'
    };
  }

  const creatorSubmitted = Boolean(pact.creatorEvidence?.trim());
  const counterpartySubmitted = Boolean(pact.counterpartyEvidence?.trim());

  if (creatorSubmitted && counterpartySubmitted) {
    return {
      label: 'Both proofs submitted',
      shell: 'bg-emerald-100 text-emerald-800'
    };
  }

  if (creatorSubmitted || counterpartySubmitted) {
    return {
      label: 'One proof submitted',
      shell: 'bg-amber-100 text-amber-800'
    };
  }

  return {
    label: 'Waiting on proof',
    shell: 'bg-slate/10 text-slate'
  };
}

export function getDeclarationSummary(pact) {
  const creatorSummary = pact.creatorDeclaration.submitted
    ? `Creator picked ${formatWinnerLabel(pact.creatorDeclaration.declaredWinner, pact)}`
    : 'Creator has not declared';
  const counterpartySummary = pact.counterpartyDeclaration.submitted
    ? `Counterparty picked ${formatWinnerLabel(pact.counterpartyDeclaration.declaredWinner, pact)}`
    : 'Counterparty has not declared';

  return `${creatorSummary}. ${counterpartySummary}.`;
}

export function getEscrowExposure(pact) {
  const stakeAmount = Number(pact.stakeFormatted || 0);

  if (pact.rawStatus === 'Proposed') {
    return stakeAmount;
  }

  if (pact.rawStatus === 'Active' || pact.rawStatus === 'Disputed') {
    return stakeAmount * 2;
  }

  return 0;
}

export function partitionPacts(pacts) {
  const groups = {
    disputes: [],
    loneSettlements: [],
    active: [],
    pending: [],
    resolved: [],
    cancelled: [],
    other: []
  };

  for (const pact of pacts) {
    if (pact.rawStatus === 'Resolved') {
      groups.resolved.push(pact);
      continue;
    }

    if (pact.rawStatus === 'Cancelled') {
      groups.cancelled.push(pact);
      continue;
    }

    if (pact.rawStatus === 'Disputed' || pact.canOpenMismatchDispute || pact.stage === 'Needs Dispute') {
      groups.disputes.push(pact);
      continue;
    }

    if (
      pact.canSettleAfterDeadline ||
      ['Result Submitted', 'Review Period', 'Settlement Due', 'Ready To Finalize'].includes(pact.stage)
    ) {
      groups.loneSettlements.push(pact);
      continue;
    }

    if (pact.rawStatus === 'Active' || pact.stage === 'Declaration Open' || pact.stage === 'Active') {
      groups.active.push(pact);
      continue;
    }

    if (
      pact.rawStatus === 'Proposed' ||
      ['Open For Join', 'Pending Acceptance', 'Acceptance Timed Out'].includes(pact.stage)
    ) {
      groups.pending.push(pact);
      continue;
    }

    groups.other.push(pact);
  }

  return groups;
}
