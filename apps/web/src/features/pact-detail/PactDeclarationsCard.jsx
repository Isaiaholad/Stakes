import { Shield } from 'lucide-react';
import { formatDateTime } from '../../lib/formatters.js';
import { zeroAddress } from 'viem';

export default function PactDeclarationsCard({
  pact,
  creatorLabel,
  counterpartyLabel,
  formatParticipant
}) {
  return (
    <section className="rounded-[32px] bg-white/85 p-5 shadow-glow">
      <p className="font-display text-2xl text-ink">Declarations</p>
      <div className="mt-4 space-y-3">
        <div className="rounded-[22px] border border-slate/10 bg-sand/65 p-4">
          <p className="text-sm font-semibold text-ink">Creator ({creatorLabel})</p>
          <p className="mt-1 text-sm text-slate/70">
            {pact.creatorDeclaration.submitted
              ? `Declared ${formatParticipant(pact.creatorDeclaration.declaredWinner)} at ${formatDateTime(pact.creatorDeclaration.submittedAt)}`
              : 'No declaration yet'}
          </p>
        </div>
        <div className="rounded-[22px] border border-slate/10 bg-sand/65 p-4">
          <p className="text-sm font-semibold text-ink">Counterparty ({counterpartyLabel})</p>
          <p className="mt-1 text-sm text-slate/70">
            {pact.counterpartyDeclaration.submitted
              ? `Declared ${formatParticipant(pact.counterpartyDeclaration.declaredWinner)} at ${formatDateTime(pact.counterpartyDeclaration.submittedAt)}`
              : 'No declaration yet'}
          </p>
        </div>
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
