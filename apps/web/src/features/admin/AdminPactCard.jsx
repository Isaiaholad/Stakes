import { Link } from 'react-router-dom';
import StatusBadge from '../../components/StatusBadge.jsx';
import { formatDateTime, formatToken } from '../../lib/formatters.js';
import {
  getDeclarationSummary,
  getDisputeProofState,
  getPartyLabel
} from './adminPageUtils.js';

function AdminActionStrip({
  pact,
  resolutionRef,
  setResolutionRefForPact,
  settleMutation,
  mismatchDisputeMutation,
  resolveWinnerMutation,
  resolveSplitMutation,
  getDisputeTiming
}) {
  const {
    creatorHasEvidence,
    counterpartyHasEvidence,
    adminReviewReady,
    disputeTimeoutAt
  } = getDisputeTiming(pact.id, pact);

  if (pact.rawStatus === 'Disputed' && pact.canAdminResolve) {
    return (
      <div className="mt-4 rounded-[22px] border border-amber-200 bg-amber-50 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-slate/55">Resolution</p>
        <p className="mt-2 text-sm text-amber-950">
          {!creatorHasEvidence && !counterpartyHasEvidence
            ? 'At least one side must submit dispute proof before this pact can be resolved.'
            : 'At least one side has submitted proof. Resolve the final outcome from here.'}
        </p>
        <input
          value={resolutionRef}
          onChange={(event) => setResolutionRefForPact(pact.id, event.target.value)}
          placeholder="resolution note"
          className="mt-3 w-full rounded-[18px] border border-amber-200 bg-white px-4 py-3 text-sm outline-none"
        />
        <div className="mt-3 space-y-2">
          <button
            type="button"
            onClick={() => resolveWinnerMutation.mutate({ pactId: pact.id, winner: pact.creator })}
            disabled={!adminReviewReady || resolveWinnerMutation.isPending || resolveSplitMutation.isPending}
            className="w-full rounded-full bg-ink px-4 py-3 text-sm font-semibold text-sand disabled:cursor-not-allowed disabled:opacity-55"
          >
            Award {getPartyLabel(pact.creator, pact.creatorUsername)}
          </button>
          <button
            type="button"
            onClick={() => resolveWinnerMutation.mutate({ pactId: pact.id, winner: pact.counterparty })}
            disabled={!adminReviewReady || resolveWinnerMutation.isPending || resolveSplitMutation.isPending}
            className="w-full rounded-full bg-ink px-4 py-3 text-sm font-semibold text-sand disabled:cursor-not-allowed disabled:opacity-55"
          >
            Award {getPartyLabel(pact.counterparty, pact.counterpartyUsername)}
          </button>
          <button
            type="button"
            onClick={() => resolveSplitMutation.mutate({ pactId: pact.id })}
            disabled={!adminReviewReady || resolveWinnerMutation.isPending || resolveSplitMutation.isPending}
            className="w-full rounded-full bg-sand px-4 py-3 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-55"
          >
            Resolve split
          </button>
        </div>
        {disputeTimeoutAt ? (
          <p className="mt-3 text-xs text-slate/60">
            If admin does not resolve this dispute, either participant can force a split after {formatDateTime(disputeTimeoutAt)}.
          </p>
        ) : null}
      </div>
    );
  }

  if (pact.rawStatus === 'Disputed') {
    return (
      <div className="mt-4 rounded-[22px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <p className="font-semibold">Arbiter role is required to resolve disputes</p>
        <p className="mt-2">
          This wallet can monitor the dispute queue, but only a wallet with the arbiter role can award a winner or resolve a split.
        </p>
      </div>
    );
  }

  if (pact.canOpenMismatchDispute) {
    return (
      <div className="mt-4 rounded-[22px] border border-rose-200 bg-rose-50 p-4">
        <p className="text-sm text-rose-900">This pact has conflicting declarations and can be pushed into dispute from here.</p>
        <button
          type="button"
          onClick={() => mismatchDisputeMutation.mutate({ pactId: pact.id })}
          disabled={mismatchDisputeMutation.isPending}
          className="mt-3 w-full rounded-full bg-rose-600 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-55"
        >
          {mismatchDisputeMutation.isPending ? 'Opening dispute...' : 'Open dispute now'}
        </button>
      </div>
    );
  }

  if (pact.canSettleAfterDeadline) {
    return (
      <div className="mt-4 rounded-[22px] border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-sm text-emerald-900">
          This timed outcome is ready to close. Use this fallback if the pact is still holding reserved funds.
        </p>
        <button
          type="button"
          onClick={() => settleMutation.mutate({ pactId: pact.id })}
          disabled={settleMutation.isPending}
          className="mt-3 w-full rounded-full bg-emerald-600 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-55"
        >
          {settleMutation.isPending ? 'Settling...' : 'Settle outcome now'}
        </button>
      </div>
    );
  }

  return null;
}

export default function AdminPactCard({
  pact,
  protocolSymbol,
  resolutionRef,
  setResolutionRefForPact,
  settleMutation,
  mismatchDisputeMutation,
  resolveWinnerMutation,
  resolveSplitMutation,
  getDisputeTiming
}) {
  const proofState = getDisputeProofState(pact);

  return (
    <div className="rounded-[28px] border border-white/80 bg-white/90 p-5 shadow-glow">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-lg text-ink">{pact.eventType || pact.title}</p>
          <p className="mt-1 text-sm text-slate/70">
            Pact #{pact.id} · {getPartyLabel(pact.creator, pact.creatorUsername)} vs {getPartyLabel(pact.counterparty, pact.counterpartyUsername)}
          </p>
        </div>
        <StatusBadge status={pact.stage} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-[22px] bg-sand p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-slate/55">Stake</p>
          <p className="mt-2 font-display text-xl text-ink">{formatToken(pact.stakeFormatted, protocolSymbol)}</p>
        </div>
        <div className="rounded-[22px] bg-sand p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-slate/55">Raw status</p>
          <p className="mt-2 text-sm font-semibold text-ink">{pact.rawStatus}</p>
          {pact.rawStatus === 'Disputed' || pact.canOpenMismatchDispute ? (
            <span className={`mt-2 inline-flex rounded-full px-3 py-1 text-xs font-semibold ${proofState.shell}`}>
              {proofState.label}
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-4 rounded-[22px] border border-slate/10 bg-sand/65 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-slate/55">Declaration summary</p>
        <p className="mt-2 text-sm leading-6 text-slate/75">{getDeclarationSummary(pact)}</p>
      </div>

      {pact.rawStatus === 'Disputed' || pact.canOpenMismatchDispute ? (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-[22px] border border-slate/10 bg-white px-4 py-3 text-sm text-slate/75">
            <p className="font-semibold text-ink">Creator proof</p>
            <p className="mt-1 break-words">{pact.creatorEvidence || 'No proof submitted yet.'}</p>
          </div>
          <div className="rounded-[22px] border border-slate/10 bg-white px-4 py-3 text-sm text-slate/75">
            <p className="font-semibold text-ink">Counterparty proof</p>
            <p className="mt-1 break-words">{pact.counterpartyEvidence || 'No proof submitted yet.'}</p>
          </div>
        </div>
      ) : null}

      <AdminActionStrip
        pact={pact}
        resolutionRef={resolutionRef}
        setResolutionRefForPact={setResolutionRefForPact}
        settleMutation={settleMutation}
        mismatchDisputeMutation={mismatchDisputeMutation}
        resolveWinnerMutation={resolveWinnerMutation}
        resolveSplitMutation={resolveSplitMutation}
        getDisputeTiming={getDisputeTiming}
      />

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs text-slate/55">
          Acceptance: {formatDateTime(pact.acceptanceDeadline)} · Result window: {formatDateTime(pact.submissionDeadline)}
        </p>
        <Link to={`/pact/${pact.id}`} className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-sand">
          Open pact
        </Link>
      </div>
    </div>
  );
}
