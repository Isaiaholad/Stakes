import { Flag, Gavel, Wallet } from 'lucide-react';
import { formatDateTime } from '../../lib/formatters.js';
import { formatParticipantLabel, getDeclarationButtonShell } from './pactDetailUtils.js';

export default function PactActionsCard({
  pact,
  address,
  creatorMeta,
  counterpartyMeta,
  declarationOptions,
  joinBalanceError,
  joinMutation,
  cancelMutation,
  cancelExpiredMutation,
  declareMutation,
  singleDeclarationDisputeMutation,
  mismatchDisputeMutation,
  settleMutation,
  resolveWinnerMutation,
  resolveSplitMutation,
  forceDisputeSplitMutation,
  resolutionRef,
  setResolutionRef,
  matchedResultWillAutoFinalize,
  conflictingResultWillAutoDispute,
  deadlineOutcomeWillAutoSettle,
  singleDeclarationReviewPending,
  settlementAction
}) {
  if (!address) {
    return null;
  }

  const currentWalletMissedDeclaration =
    (pact.participantRole === 'creator' &&
      !pact.creatorDeclaration.submitted &&
      pact.counterpartyDeclaration.submitted) ||
    (pact.participantRole === 'counterparty' &&
      !pact.counterpartyDeclaration.submitted &&
      pact.creatorDeclaration.submitted);

  return (
    <section className="rounded-[32px] bg-white/85 p-5 shadow-glow">
      <p className="font-display text-2xl text-ink">Actions</p>
      <div className="mt-4 space-y-3">
        {pact.canJoin ? (
          <div className="space-y-3 rounded-[24px] bg-sand/55 p-4">
            <button
              type="button"
              onClick={() => joinMutation.mutate()}
              disabled={joinMutation.isPending || Boolean(joinBalanceError)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-ink px-5 py-4 text-base font-semibold text-sand disabled:cursor-not-allowed disabled:opacity-55"
            >
              <Wallet className="h-5 w-5" />
              {joinMutation.isPending ? 'Joining pact...' : 'Join and reserve stake'}
            </button>
            <p className={`text-sm ${joinBalanceError ? 'text-amber-700' : 'text-slate/70'}`}>
              {joinBalanceError || 'Your vault balance already covers the join amount.'}
            </p>
          </div>
        ) : null}

        {pact.canCancel ? (
          <button
            type="button"
            onClick={() => cancelMutation.mutate()}
            disabled={cancelMutation.isPending}
            className="w-full rounded-full bg-sand px-5 py-4 text-base font-semibold text-ink"
          >
            {cancelMutation.isPending ? 'Cancelling...' : 'Cancel unjoined pact'}
          </button>
        ) : null}

        {pact.canCancelExpired ? (
          <button
            type="button"
            onClick={() => cancelExpiredMutation.mutate()}
            disabled={cancelExpiredMutation.isPending}
            className="w-full rounded-full bg-sand px-5 py-4 text-base font-semibold text-ink"
          >
            {cancelExpiredMutation.isPending ? 'Cancelling expired pact...' : 'Cancel expired pact'}
          </button>
        ) : null}

        {pact.canSubmitDeclaration ? (
          <div className="rounded-[24px] bg-mint/16 p-4">
            <div className="flex items-center gap-2">
              <Flag className="h-5 w-5 text-emerald-700" />
              <p className="font-display text-xl text-ink">Submit winner declaration</p>
            </div>
            <div className="mt-4 space-y-3">
              {declarationOptions.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => declareMutation.mutate(option.value)}
                  disabled={declareMutation.isPending}
                  className={getDeclarationButtonShell(option.tone, declareMutation.isPending)}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-xs font-semibold ${
                        option.tone === 'self' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
                      }`}
                    >
                      {option.badge}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold">{option.label}</p>
                      {option.value !== undefined && option.value !== null && option.value !== '' && option.value !== '0x0000000000000000000000000000000000000000' &&
                      (option.value === pact.creator ? creatorMeta?.sublabel : counterpartyMeta?.sublabel) ? (
                        <p className="mt-1 text-xs opacity-65">{option.value === pact.creator ? creatorMeta?.sublabel : counterpartyMeta?.sublabel}</p>
                      ) : null}
                      {option.helper ? <p className="mt-1 text-sm opacity-80">{option.helper}</p> : null}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {matchedResultWillAutoFinalize ? (
          <div className="rounded-[24px] border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
            <p className="font-semibold">Matched result is finalizing automatically</p>
            <p className="mt-2 text-sm text-emerald-900">
              The second matching declaration resolves this pact automatically on-chain. If this status lingers, the live read model is still catching up.
            </p>
          </div>
        ) : null}

        {conflictingResultWillAutoDispute ? (
          <div className="rounded-[24px] border border-rose-200 bg-rose-50 p-4 text-rose-950">
            <p className="font-semibold">Conflicting declarations are ready for dispute</p>
            <p className="mt-2 text-sm text-rose-900">
              These declarations conflict. The pact should move into dispute immediately, and this button is here as a fallback if the current state has not advanced yet.
            </p>
            <button
              type="button"
              onClick={() => mismatchDisputeMutation.mutate()}
              disabled={mismatchDisputeMutation.isPending}
              className="mt-3 w-full rounded-full bg-rose-600 px-5 py-4 text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-55"
            >
              {mismatchDisputeMutation.isPending ? 'Opening dispute...' : 'Open dispute now'}
            </button>
          </div>
        ) : null}

        {singleDeclarationReviewPending ? (
          <div className="rounded-[24px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-semibold">Declaration review period is still open</p>
            <p className="mt-2">
              {currentWalletMissedDeclaration
                ? 'This wallet missed the declaration window. You can still raise a dispute during the 30-minute review period before the lone declaration settles on-chain.'
                : 'One side declared before the deadline. The pact now waits through its 30-minute review period before that declaration can settle on-chain.'}
            </p>
            {pact.canOpenUnansweredDeclarationDispute ? (
              <button
                type="button"
                onClick={() => singleDeclarationDisputeMutation.mutate()}
                disabled={singleDeclarationDisputeMutation.isPending}
                className="mt-3 w-full rounded-full bg-amber-500 px-5 py-4 text-base font-semibold text-ink"
              >
                {singleDeclarationDisputeMutation.isPending ? 'Opening dispute...' : 'Raise dispute during review'}
              </button>
            ) : null}
          </div>
        ) : null}

        {deadlineOutcomeWillAutoSettle ? (
          <div className="rounded-[24px] border border-rose-200 bg-rose-50 p-4 text-rose-950">
            <p className="font-semibold">Timeout and grace period are over</p>
            {settlementAction?.helper ? <p className="mt-2 text-sm text-rose-900">{settlementAction.helper}</p> : null}
            <p className="mt-2 text-sm text-rose-900">
              A joined participant or arbiter can now settle the lone declaration from here.
            </p>
            <button
              type="button"
              onClick={() => settleMutation.mutate()}
              disabled={settleMutation.isPending}
              className="mt-3 w-full rounded-full bg-rose-600 px-5 py-4 text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-55"
            >
              {settleMutation.isPending ? 'Settling outcome...' : settlementAction?.label || 'Settle lone declaration'}
            </button>
          </div>
        ) : null}

        {pact.canAdminResolve ? (
          <div className="rounded-[24px] border border-amber-300 bg-amber-50 p-4">
            <div className="flex items-center gap-2">
              <Gavel className="h-5 w-5 text-amber-700" />
              <p className="font-display text-xl text-ink">Arbiter resolution</p>
            </div>
            <p className="mt-3 text-sm text-amber-950">
              {!pact.creatorEvidence && !pact.counterpartyEvidence
                ? 'At least one side must submit dispute proof before an arbiter can resolve this pact.'
                : 'At least one side has submitted proof. An arbiter can now resolve the outcome from here.'}
            </p>
            <input
              value={resolutionRef}
              onChange={(event) => setResolutionRef(event.target.value)}
              placeholder="resolution note or reference"
              className="mt-4 w-full rounded-[22px] border border-amber-200 bg-white px-4 py-4 outline-none"
            />
            <div className="mt-4 space-y-3">
              <button
                type="button"
                onClick={() => resolveWinnerMutation.mutate(pact.creator)}
                disabled={!pact.adminReviewReady || resolveWinnerMutation.isPending || resolveSplitMutation.isPending}
                className="w-full rounded-full bg-ink px-5 py-4 text-base font-semibold text-sand"
              >
                Award {formatParticipantLabel(pact.creator, creatorMeta?.username)}
              </button>
              <button
                type="button"
                onClick={() => resolveWinnerMutation.mutate(pact.counterparty)}
                disabled={!pact.adminReviewReady || resolveWinnerMutation.isPending || resolveSplitMutation.isPending}
                className="w-full rounded-full bg-ink px-5 py-4 text-base font-semibold text-sand"
              >
                Award {formatParticipantLabel(pact.counterparty, counterpartyMeta?.username)}
              </button>
              <button
                type="button"
                onClick={() => resolveSplitMutation.mutate()}
                disabled={!pact.adminReviewReady || resolveWinnerMutation.isPending || resolveSplitMutation.isPending}
                className="w-full rounded-full bg-sand px-5 py-4 text-base font-semibold text-ink"
              >
                Resolve 50/50 split
              </button>
            </div>
          </div>
        ) : null}

        {pact.canForceDisputeSplit ? (
          <div className="rounded-[24px] border border-rose-200 bg-rose-50 p-4 text-rose-950">
            <p className="font-semibold">Dispute timeout fallback is open</p>
            <p className="mt-2 text-sm text-rose-900">
              This dispute has stayed unresolved past the 7-day dispute timeout. Either participant can now force a split if admin has not acted.
            </p>
            <button
              type="button"
              onClick={() => forceDisputeSplitMutation.mutate()}
              disabled={forceDisputeSplitMutation.isPending}
              className="mt-3 w-full rounded-full bg-rose-600 px-5 py-4 text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-55"
            >
              {forceDisputeSplitMutation.isPending ? 'Forcing split...' : 'Force split after dispute timeout'}
            </button>
          </div>
        ) : null}

        {!pact.canJoin &&
        !pact.canCancel &&
        !pact.canCancelExpired &&
        !pact.canSubmitDeclaration &&
        !matchedResultWillAutoFinalize &&
        !conflictingResultWillAutoDispute &&
        !pact.canOpenUnansweredDeclarationDispute &&
        !deadlineOutcomeWillAutoSettle &&
        !pact.canAdminResolve &&
        !pact.canForceDisputeSplit ? (
          <p className="text-sm text-slate/70">There is no action to take from this wallet right now.</p>
        ) : null}
      </div>
    </section>
  );
}
