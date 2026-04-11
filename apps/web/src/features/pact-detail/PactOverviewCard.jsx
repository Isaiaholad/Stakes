import { Copy } from 'lucide-react';
import StatusBadge from '../../components/StatusBadge.jsx';
import { formatCountdown, formatDateTime, formatDuration, formatToken } from '../../lib/formatters.js';
import { getStageMessage } from './pactDetailUtils.js';

const urlPattern = /(https?:\/\/[^\s]+)/gi;

function isUrlPart(value) {
  return /^https?:\/\/\S+$/i.test(String(value || ''));
}

function renderTextWithLinks(value) {
  return String(value || '')
    .split(/\n+/)
    .filter(Boolean)
    .map((line, lineIndex) => {
      const parts = line.split(urlPattern);

      return (
        <p key={`${lineIndex}-${line}`} className={lineIndex > 0 ? 'mt-2' : ''}>
          {parts.map((part, partIndex) =>
            isUrlPart(part) ? (
              <a
                key={`${lineIndex}-${partIndex}`}
                href={part}
                target="_blank"
                rel="noreferrer"
                className="break-all font-medium text-coral underline underline-offset-4"
              >
                {part}
              </a>
            ) : (
              <span key={`${lineIndex}-${partIndex}`}>{part}</span>
            )
          )}
        </p>
      );
    });
}

export default function PactOverviewCard({
  pact,
  protocolSymbol,
  creatorLabel,
  creatorSublabel,
  counterpartyLabel,
  counterpartySublabel,
  finalResultStatus,
  now,
  onCopyShareLink
}) {
  return (
    <section className="rounded-[32px] bg-white/85 p-5 shadow-glow">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-slate/50">On-chain pact</p>
          <h1 className="mt-2 font-display text-3xl text-ink">{pact.eventType || pact.title}</h1>
          <p className="mt-2 text-sm text-slate/70">{getStageMessage(pact)}</p>
        </div>
        <StatusBadge status={pact.stage} />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-[24px] bg-sand p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-slate/50">Stake</p>
          <p className="mt-2 font-display text-2xl text-ink">{formatToken(pact.stakeFormatted, protocolSymbol)}</p>
        </div>
        <div className="rounded-[24px] bg-ink p-4 text-sand">
          <p className="text-xs uppercase tracking-[0.22em] text-sand/60">Total escrow</p>
          <p className="mt-2 font-display text-2xl">{formatToken(Number(pact.stakeFormatted) * 2, protocolSymbol)}</p>
        </div>
        <div className="rounded-[24px] bg-sand p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-slate/50">Creator</p>
          <p className="mt-2 text-sm font-semibold text-ink">{creatorLabel}</p>
          {creatorSublabel ? <p className="mt-1 text-xs text-slate/60">{creatorSublabel}</p> : null}
        </div>
        <div className="rounded-[24px] bg-sand p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-slate/50">Counterparty</p>
          <p className="mt-2 text-sm font-semibold text-ink">{counterpartyLabel}</p>
          {counterpartySublabel ? <p className="mt-1 text-xs text-slate/60">{counterpartySublabel}</p> : null}
        </div>
      </div>

      <div className="mt-5 rounded-[24px] bg-sand/70 p-4 text-sm text-slate/75">
        <p><strong>Event duration:</strong> {formatDuration(pact.eventDurationSeconds)}</p>
        {pact.rawStatus === 'Proposed' ? (
          <>
            <p className="mt-1"><strong>Starts when accepted:</strong> The timer begins after the counterparty joins.</p>
            <p className="mt-1"><strong>Acceptance timeout:</strong> {formatDateTime(pact.acceptanceDeadline)} ({formatCountdown(pact.acceptanceDeadline, now)})</p>
            <p className="mt-1"><strong>Declaration window:</strong> {formatDuration(pact.declarationWindowSeconds)}</p>
          </>
        ) : (
          <>
            <p className="mt-1"><strong>Started:</strong> {formatDateTime(pact.eventStartedAt)}</p>
            <p className="mt-1"><strong>Time remaining:</strong> {formatCountdown(pact.eventEnd, now)}</p>
            <p className="mt-1"><strong>Active until:</strong> {formatDateTime(pact.eventEnd)}</p>
            <p className="mt-1"><strong>Declaration window:</strong> {formatDuration(pact.declarationWindowSeconds)} · closes {formatDateTime(pact.submissionDeadline)} ({formatCountdown(pact.submissionDeadline, now)})</p>
          </>
        )}
        {pact.description ? <div className="mt-3 break-words">{renderTextWithLinks(pact.description)}</div> : null}
      </div>

      <div className={`mt-4 rounded-[24px] border p-4 ${finalResultStatus.shell}`}>
        <div className="flex items-start gap-3">
          <div className={`rounded-2xl bg-white/70 p-2 ${finalResultStatus.iconColor}`}>
            <finalResultStatus.Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.22em] opacity-70">Final result status</p>
            <p className="mt-2 font-display text-xl">{finalResultStatus.title}</p>
            <p className="mt-2 text-sm leading-6 opacity-85">{finalResultStatus.message}</p>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onCopyShareLink}
        className="mt-4 inline-flex items-center gap-2 rounded-full bg-sand px-4 py-3 text-sm font-semibold text-ink"
      >
        <Copy className="h-4 w-4" />
        Copy pact link
      </button>
    </section>
  );
}
