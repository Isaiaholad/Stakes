import { Shield } from 'lucide-react';
import { formatDateTime } from '../../lib/formatters.js';
import { zeroAddress } from 'viem';

export default function PactDeclarationsCard({
  pact,
  creatorLabel,
  counterpartyLabel,
  formatParticipant
}) {
  const isEfootball = String(pact.eventType || '').toLowerCase() === 'efootball';
  const cardTitle = isEfootball ? 'AI result submissions' : 'Declarations';
  const emptyLabel = isEfootball ? 'No AI result submitted yet' : 'No declaration yet';
  const oneSubmissionOnly = pact.creatorDeclaration.submitted !== pact.counterpartyDeclaration.submitted;
  const formatSubmission = (declaration) =>
    isEfootball
      ? `AI submitted ${formatParticipant(declaration.declaredWinner)} at ${formatDateTime(declaration.submittedAt)}`
      : `Declared ${formatParticipant(declaration.declaredWinner)} at ${formatDateTime(declaration.submittedAt)}`;

  return (
    <section className="rounded-[32px] bg-white/85 p-5 shadow-glow">
      <p className="font-display text-2xl text-ink">{cardTitle}</p>
      <div className="mt-4 space-y-3">
        <div className="rounded-[22px] border border-slate/10 bg-sand/65 p-4">
          <p className="text-sm font-semibold text-ink">Creator ({creatorLabel})</p>
          <p className="mt-1 text-sm text-slate/70">
            {pact.creatorDeclaration.submitted
              ? formatSubmission(pact.creatorDeclaration)
              : emptyLabel}
          </p>
        </div>
        <div className="rounded-[22px] border border-slate/10 bg-sand/65 p-4">
          <p className="text-sm font-semibold text-ink">Counterparty ({counterpartyLabel})</p>
          <p className="mt-1 text-sm text-slate/70">
            {pact.counterpartyDeclaration.submitted
              ? formatSubmission(pact.counterpartyDeclaration)
              : emptyLabel}
          </p>
        </div>
        {isEfootball && oneSubmissionOnly && pact.rawStatus !== 'Resolved' ? (
          <div className="rounded-[22px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            One detected result is visible here. The other participant can agree with it from Actions, or upload their own screenshot if the result is wrong.
          </div>
        ) : null}
        {pact.rawStatus === 'Resolved' ? (
          <div className="rounded-[22px] border border-slate/10 bg-mint/16 p-4 text-sm text-emerald-800">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              <p>
                {pact.winner === zeroAddress
                  ? 'This pact resolved as a split.'
                  : `Winner paid: ${formatParticipant(pact.winner)}`}
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
