import { Link } from 'react-router-dom';
import StatusBadge from './StatusBadge.jsx';
import { useNow } from '../hooks/useNow.js';
import { formatCountdown, formatDuration, formatToken, shortenAddress } from '../lib/formatters.js';

export default function ChallengeCard({ challenge }) {
  const now = useNow(15_000);
  const statusLabel = challenge.isPendingIndex ? 'Pending Index' : challenge.stage;
  const counterpart =
    challenge.participantRole === 'creator'
      ? challenge.counterparty
      : challenge.participantRole === 'counterparty'
        ? challenge.creator
        : challenge.counterparty || challenge.creator;
  const creatorLabel = challenge.creatorUsername ? `@${challenge.creatorUsername}` : shortenAddress(challenge.creator);
  const counterpartLabel = challenge.counterpartyUsername ? `@${challenge.counterpartyUsername}` : shortenAddress(counterpart);

  return (
    <Link
      to={`/pact/${challenge.id}`}
      className="block rounded-[28px] border border-white/80 bg-white/85 p-5 shadow-glow transition-transform duration-200 hover:-translate-y-0.5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-lg text-ink">{challenge.eventType || challenge.title}</p>
          <p className="mt-1 text-sm text-slate/70">
            {challenge.participantRole === 'viewer' ? creatorLabel : `vs ${counterpartLabel}`}
          </p>
          {challenge.isPendingIndex ? (
            <p className="mt-1 text-xs text-slate/60">Created on-chain. Waiting for the indexed feed to catch up.</p>
          ) : null}
        </div>
        <StatusBadge status={statusLabel} />
      </div>
      <div className="mt-4 flex items-end justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate/60">Stake</p>
          <p className="font-display text-2xl text-ink">{formatToken(challenge.stakeFormatted)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-[0.2em] text-slate/60">Event duration</p>
          <p className="text-sm text-slate/70">
            {challenge.rawStatus === 'Proposed'
              ? formatDuration(challenge.eventDurationSeconds)
              : challenge.eventEnd
                ? formatCountdown(challenge.eventEnd, now)
                : formatDuration(challenge.eventDurationSeconds)}
          </p>
        </div>
      </div>
    </Link>
  );
}
