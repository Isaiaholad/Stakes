import { Flag, Gavel, Shield } from 'lucide-react';
import { formatCountdown, formatDuration, shortenAddress } from '../../lib/formatters.js';
import { zeroAddress } from 'viem';

export function getWalletInitials(walletAddress) {
  if (!walletAddress || walletAddress === zeroAddress) {
    return '--';
  }

  return walletAddress.slice(2, 4).toUpperCase();
}

export function formatParticipantLabel(walletAddress, username) {
  if (!walletAddress || walletAddress === zeroAddress) {
    return 'Open';
  }

  return username ? `@${username}` : shortenAddress(walletAddress);
}

export function getParticipantBadge(walletAddress, username) {
  if (username) {
    return username.slice(0, 2).toUpperCase();
  }

  return getWalletInitials(walletAddress);
}

export function getDeclarationButtonShell(tone, isDisabled) {
  const shells = {
    self: 'border-emerald-300 bg-emerald-50 text-emerald-950',
    opponent: 'border-rose-300 bg-rose-50 text-rose-950'
  };

  return [
    'w-full rounded-[24px] border px-4 py-4 text-left transition',
    shells[tone] || shells.opponent,
    isDisabled ? 'cursor-not-allowed opacity-60' : 'hover:-translate-y-0.5 hover:shadow-sm'
  ].join(' ');
}

export function getReceiptStatusMessage(receipt) {
  if (!receipt) {
    return '';
  }

  const hash = receipt.transactionHash || '';
  const shortHash = hash ? `${hash.slice(0, 10)}...${hash.slice(-8)}` : 'Unknown hash';
  return `Status: ${receipt.status}. Tx hash: ${shortHash}.`;
}

export function getStageMessage(pact) {
  const declarationWindowLabel = formatDuration(pact.declarationWindowSeconds);
  return (
    {
      'Open For Join': 'This pact is public and waiting for the first counterparty to reserve the matching stake.',
      'Pending Acceptance': 'The creator already reserved stake. The event duration will start after the invited wallet accepts.',
      'Acceptance Timed Out': 'The counterparty did not accept within 12 hours. The creator can cancel and reclaim the reserved stake.',
      Active: 'Both stakes are locked. Wait for the event duration to finish before submitting the winner.',
      'Declaration Open': `The event duration is over. Participants can now declare the winner during the ${declarationWindowLabel} declaration window.`,
      'Result Submitted': 'One declaration is already on-chain. If the other side stays silent through the declaration window and grace period, that declaration wins automatically.',
      'Review Period': 'The declaration window closed with only one submitted result. The missing side can still raise a dispute during the 30-minute review period.',
      'Ready To Finalize': 'Both declarations match. StakeWithFriends is ready to auto-settle the payout from the pact page.',
      'Needs Dispute': 'Both declarations are in, but they do not match. StakeWithFriends can move the pact into dispute for arbiter review.',
      'Settlement Due': 'The declaration window closed. The pact now settles into a split, a lone declared winner, or a dispute for conflicting claims.',
      Disputed: 'This pact is waiting for an arbiter decision and final on-chain resolution.',
      Completed: 'This pact resolved on-chain and the winner can withdraw from the vault.',
      'Split Completed': 'This pact resolved to a split payout in the vault.',
      Cancelled: 'The creator cancelled before the counterparty joined.'
    }[pact.stage] || 'This pact is on-chain.'
  );
}

export function getFinalResultStatus(pact, formatParticipant, referenceTime) {
  const eventEnded = referenceTime >= new Date(pact.eventEnd).getTime();
  const deadlineEnded = referenceTime > new Date(pact.submissionDeadline).getTime();

  if (pact.rawStatus === 'Resolved') {
    return {
      title: 'Final result declared',
      message:
        pact.winner === zeroAddress
          ? 'This pact resolved as a split payout.'
          : `Winner declared: ${formatParticipant(pact.winner)}. The payout has been resolved in the vault.`,
      shell: 'border-emerald-200 bg-mint/16 text-emerald-900',
      iconColor: 'text-emerald-700',
      Icon: Shield
    };
  }

  if (pact.rawStatus === 'Disputed') {
    return {
      title: 'Final result under review',
      message: 'The pact has ended and is waiting for arbiter resolution.',
      shell: 'border-amber-200 bg-amber-50 text-amber-950',
      iconColor: 'text-amber-700',
      Icon: Gavel
    };
  }

  if (pact.rawStatus === 'Cancelled') {
    return {
      title: 'No final result',
      message: 'This pact was cancelled before it became active.',
      shell: 'border-slate/10 bg-sand/65 text-slate/80',
      iconColor: 'text-slate/60',
      Icon: Shield
    };
  }

  if (pact.rawStatus === 'Proposed') {
    return {
      title: pact.acceptanceExpired ? 'Acceptance timed out' : 'Final result not open yet',
      message: pact.acceptanceExpired
        ? 'The 12-hour acceptance window expired before this pact became active.'
        : 'This pact must be accepted before the event duration and result window can begin.',
      shell: 'border-slate/10 bg-sand/65 text-slate/80',
      iconColor: 'text-slate/60',
      Icon: Flag
    };
  }

  if (!eventEnded) {
    return {
      title: 'Final result opens when the pact ends',
      message: `Participants can declare the result after the event duration runs out in ${formatCountdown(pact.eventEnd, referenceTime)}.`,
      shell: 'border-slate/10 bg-sand/65 text-slate/80',
      iconColor: 'text-slate/60',
      Icon: Flag
    };
  }

  if (pact.stage === 'Declaration Open') {
    return {
      title: 'Final result waiting on declarations',
      message: `The pact has ended. Either side can declare the winner during the ${formatDuration(pact.declarationWindowSeconds)} declaration window.`,
      shell: 'border-indigo-200 bg-indigo-50 text-indigo-950',
      iconColor: 'text-indigo-700',
      Icon: Flag
    };
  }

  if (pact.stage === 'Result Submitted') {
    return {
      title: 'One declaration received',
      message: 'One side already declared. If the other side stays silent through the declaration window and grace period, that declaration wins automatically.',
      shell: 'border-indigo-200 bg-indigo-50 text-indigo-950',
      iconColor: 'text-indigo-700',
      Icon: Flag
    };
  }

  if (pact.stage === 'Review Period') {
    return {
      title: 'Review period is open',
      message: 'Only one declaration was submitted. The other side can still raise a dispute during the 30-minute review period before the lone declaration settles.',
      shell: 'border-amber-200 bg-amber-50 text-amber-950',
      iconColor: 'text-amber-700',
      Icon: Gavel
    };
  }

  if (pact.stage === 'Ready To Finalize') {
    return {
      title: 'Final result confirmed',
      message: 'Both declarations match. StakeWithFriends now auto-settles the payout on-chain.',
      shell: 'border-emerald-200 bg-mint/16 text-emerald-900',
      iconColor: 'text-emerald-700',
      Icon: Shield
    };
  }

  if (pact.stage === 'Needs Dispute') {
    return {
      title: 'Final result contested',
      message: 'Declarations do not match. StakeWithFriends now moves the pact into dispute for arbiter review.',
      shell: 'border-rose-200 bg-rose-50 text-rose-950',
      iconColor: 'text-rose-700',
      Icon: Gavel
    };
  }

  if (pact.stage === 'Settlement Due' || deadlineEnded) {
    return {
      title: 'Final result awaiting settlement',
      message: 'The declaration window closed. The pact now settles into a split, a lone declared winner, or a dispute for conflicting claims.',
      shell: 'border-rose-200 bg-rose-50 text-rose-950',
      iconColor: 'text-rose-700',
      Icon: Gavel
    };
  }

  return {
    title: 'Final result pending',
    message: 'This pact has ended and is waiting for the next result step.',
    shell: 'border-slate/10 bg-sand/65 text-slate/80',
    iconColor: 'text-slate/60',
    Icon: Flag
  };
}
