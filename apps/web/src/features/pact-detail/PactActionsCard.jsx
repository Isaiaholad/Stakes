import { useState } from 'react';
import { Flag, Gavel, Wallet } from 'lucide-react';
import { formatParticipantLabel, getDeclarationButtonShell } from './pactDetailUtils.js';

const chessColors = ['White', 'Black'];

function getCreatorChessColor(pact) {
  const match = String(pact?.description || '').match(/creator(?:'s)?\s+chess\s+color\s*:\s*(white|black)/i);
  return match?.[1] ? match[1].slice(0, 1).toUpperCase() + match[1].slice(1).toLowerCase() : '';
}

function getOppositeChessColor(color) {
  const normalized = String(color || '').toLowerCase();
  if (normalized === 'white') {
    return 'Black';
  }
  if (normalized === 'black') {
    return 'White';
  }
  return '';
}

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
  analyzeEfootballResultMutation,
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
  settlementAction,
  catboxUploadConfigured,
  pendingEvidenceFile,
  setPendingEvidenceFile,
  uploadDisputeFileMutation,
  evidenceUploads,
  efootballEvidenceReady
}) {
  const [joinUsernameDraft, setJoinUsernameDraft] = useState('');
  const [joinChessColorDraft, setJoinChessColorDraft] = useState('');

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
  const isEfootball = String(pact.eventType || '').toLowerCase() === 'efootball';
  const isChess = String(pact.eventType || '').toLowerCase() === 'chess';
  const creatorChessColor = getCreatorChessColor(pact);
  const suggestedChessColor = getOppositeChessColor(creatorChessColor);
  const joinChessColor = joinChessColorDraft || suggestedChessColor;
  const uploadedScreenshots = evidenceUploads?.filter((item) => item.status === 'uploaded').length || 0;
  const aiDetectionFailed = Boolean(analyzeEfootballResultMutation.isError);
  const canUseManualScreenshotFallback = Boolean(isEfootball && efootballEvidenceReady && aiDetectionFailed);
  const sameAddress = (left, right) => String(left || '').toLowerCase() === String(right || '').toLowerCase();
  const loneSubmittedDeclaration =
    pact.creatorDeclaration.submitted !== pact.counterpartyDeclaration.submitted
      ? pact.creatorDeclaration.submitted
        ? {
            submitter: pact.creator,
            submitterUsername: creatorMeta?.username,
            winner: pact.creatorDeclaration.declaredWinner
          }
        : {
            submitter: pact.counterparty,
            submitterUsername: counterpartyMeta?.username,
            winner: pact.counterpartyDeclaration.declaredWinner
          }
      : null;
  const loneSubmittedWinnerUsername =
    sameAddress(loneSubmittedDeclaration?.winner, pact.creator)
      ? creatorMeta?.username
      : sameAddress(loneSubmittedDeclaration?.winner, pact.counterparty)
        ? counterpartyMeta?.username
        : '';
  const loneSubmittedWinnerLabel = loneSubmittedDeclaration
    ? formatParticipantLabel(loneSubmittedDeclaration.winner, loneSubmittedWinnerUsername)
    : '';

  return (
    <section className="rounded-[32px] bg-white/85 p-5 shadow-glow">
      <p className="font-display text-2xl text-ink">Actions</p>
      <div className="mt-4 space-y-3">
        {pact.canJoin ? (
          <div className="space-y-3 rounded-[24px] bg-sand/55 p-4">
            {isEfootball ? (
              <div className="rounded-[24px] border border-emerald-200 bg-white p-4">
                <p className="font-display text-xl text-ink">Enter your eFootball username</p>
                <p className="mt-1 text-sm text-slate/70">
                  Use the exact name shown on your result screen so the AI can match the screenshot to the right player.
                </p>
                <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
                  In-game username
                </label>
                <input
                  value={joinUsernameDraft}
                  onChange={(event) => setJoinUsernameDraft(event.target.value)}
                  placeholder="@your_efootball_name"
                  className="mt-2 w-full rounded-[22px] border border-emerald-200 bg-emerald-50/60 px-4 py-4 text-base font-semibold text-ink outline-none transition focus:border-emerald-500 focus:bg-white"
                />
                <button
                  type="button"
                  onClick={() => joinMutation.mutate(joinUsernameDraft.trim())}
                  disabled={joinMutation.isPending || Boolean(joinBalanceError) || !joinUsernameDraft.trim()}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-ink px-5 py-4 text-base font-semibold text-sand disabled:cursor-not-allowed disabled:opacity-55"
                >
                  <Wallet className="h-5 w-5" />
                  {joinMutation.isPending ? 'Joining pact...' : 'Join and save username'}
                </button>
              </div>
            ) : isChess ? (
              <div className="rounded-[24px] border border-amber-200 bg-white p-4">
                <p className="font-display text-xl text-ink">Choose your chess color</p>
                <p className="mt-1 text-sm text-slate/70">
                  {creatorChessColor
                    ? `The creator selected ${creatorChessColor}. Confirm the color you will play before joining.`
                    : 'Confirm the color you will play before joining this chess pact.'}
                </p>
                <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
                  Your color
                </label>
                <select
                  value={joinChessColor}
                  onChange={(event) => setJoinChessColorDraft(event.target.value)}
                  className="mt-2 w-full rounded-[22px] border border-amber-200 bg-amber-50/60 px-4 py-4 text-base font-semibold text-ink outline-none transition focus:border-amber-500 focus:bg-white"
                >
                  <option value="">Choose color</option>
                  {chessColors.map((color) => (
                    <option key={color} value={color}>
                      {color}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => joinMutation.mutate(joinChessColor)}
                  disabled={joinMutation.isPending || Boolean(joinBalanceError) || !joinChessColor}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-ink px-5 py-4 text-base font-semibold text-sand disabled:cursor-not-allowed disabled:opacity-55"
                >
                  <Wallet className="h-5 w-5" />
                  {joinMutation.isPending ? 'Joining pact...' : 'Join and save color'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => joinMutation.mutate('')}
                disabled={joinMutation.isPending || Boolean(joinBalanceError)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-ink px-5 py-4 text-base font-semibold text-sand disabled:cursor-not-allowed disabled:opacity-55"
              >
                <Wallet className="h-5 w-5" />
                {joinMutation.isPending ? 'Joining pact...' : 'Join and reserve stake'}
              </button>
            )}
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
              <p className="font-display text-xl text-ink">
                {isEfootball ? 'Upload result screenshot' : 'Submit winner declaration'}
              </p>
            </div>

            {isEfootball && catboxUploadConfigured ? (
              <div className="mt-4 rounded-[16px] bg-white p-3 border border-emerald-200">
                {currentWalletMissedDeclaration && loneSubmittedDeclaration ? (
                  <div className="mb-4 rounded-[18px] border border-amber-200 bg-amber-50 p-4 text-amber-950">
                    <p className="text-sm font-semibold">The other player already submitted a result</p>
                    <p className="mt-2 text-sm">
                      {formatParticipantLabel(loneSubmittedDeclaration.submitter, loneSubmittedDeclaration.submitterUsername)} submitted{' '}
                      <span className="font-semibold">{loneSubmittedWinnerLabel}</span> as winner.
                    </p>
                    <p className="mt-2 text-xs text-amber-900">
                      If this matches your final score, agree with it now. If not, upload your own screenshot below and the mismatch can move to dispute.
                    </p>
                    <button
                      type="button"
                      onClick={() => declareMutation.mutate(loneSubmittedDeclaration.winner)}
                      disabled={declareMutation.isPending || analyzeEfootballResultMutation.isPending}
                      className="mt-3 w-full rounded-full bg-amber-500 px-5 py-3 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      {declareMutation.isPending ? 'Agreeing on-chain...' : `Agree with ${loneSubmittedWinnerLabel}`}
                    </button>
                  </div>
                ) : null}
                <p className="text-sm font-semibold text-emerald-900 mb-1">AI verifies the winner from your screenshot</p>
                <p className="text-xs text-emerald-800 mb-3">
                  {currentWalletMissedDeclaration
                    ? 'Disagree by uploading your final result screenshot. Images are capped at 1 MB.'
                    : 'Upload a final result screenshot. Images are capped at 1 MB.'}
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(event) => setPendingEvidenceFile(event.target.files?.[0] || null)}
                    className="block w-full text-xs text-emerald-800 file:mr-2 file:rounded-full file:border-0 file:bg-emerald-100 file:px-3 file:py-1.5 file:font-semibold file:text-emerald-700"
                  />
                  <button
                    type="button"
                    onClick={() => uploadDisputeFileMutation.mutate()}
                    disabled={uploadDisputeFileMutation.isPending || !pendingEvidenceFile}
                    className="shrink-0 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {uploadDisputeFileMutation.isPending ? 'Uploading...' : 'Upload'}
                  </button>
                </div>
                {uploadedScreenshots > 0 ? (
                  <div className="mt-2 text-xs text-emerald-700">
                    {uploadedScreenshots} screenshot(s) uploaded and saved.
                  </div>
                ) : null}
                {evidenceUploads?.some((item) => item.status === 'failed') ? (
                  <div className="mt-2 text-xs text-rose-700">
                    {evidenceUploads.find((item) => item.status === 'failed')?.error || 'Upload failed. Try a smaller screenshot.'}
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => analyzeEfootballResultMutation.mutate()}
                  disabled={
                    !efootballEvidenceReady ||
                    uploadDisputeFileMutation.isPending ||
                    analyzeEfootballResultMutation.isPending ||
                    declareMutation.isPending
                  }
                  className="mt-3 w-full rounded-full bg-ink px-5 py-4 text-sm font-semibold text-sand disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {analyzeEfootballResultMutation.isPending
                    ? 'Analyzing screenshot...'
                    : currentWalletMissedDeclaration
                      ? 'Detect winner and submit my result'
                      : 'Detect winner and submit result'}
                </button>
                {!efootballEvidenceReady ? (
                  <p className="mt-2 text-xs text-slate/70">
                    Upload is required for eFootball pacts before any result can be submitted.
                  </p>
                ) : null}
                {canUseManualScreenshotFallback ? (
                  <div className="mt-4 rounded-[18px] border border-amber-200 bg-amber-50 p-4 text-amber-950">
                    <p className="text-sm font-semibold">AI could not read this screenshot</p>
                    <p className="mt-2 text-xs leading-5 text-amber-900">
                      You can retry detection, or submit the winner manually from the uploaded screenshot. If the other player disagrees, the pact can move to dispute for admin review.
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => analyzeEfootballResultMutation.mutate()}
                        disabled={analyzeEfootballResultMutation.isPending || declareMutation.isPending}
                        className="rounded-full bg-white px-4 py-3 text-xs font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-55"
                      >
                        Try AI again
                      </button>
                      {currentWalletMissedDeclaration && loneSubmittedDeclaration ? (
                        <button
                          type="button"
                          onClick={() => singleDeclarationDisputeMutation.mutate()}
                          disabled={!pact.canOpenUnansweredDeclarationDispute || singleDeclarationDisputeMutation.isPending}
                          className="rounded-full bg-rose-600 px-4 py-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-55"
                        >
                          {singleDeclarationDisputeMutation.isPending ? 'Opening dispute...' : 'Request dispute review'}
                        </button>
                      ) : null}
                    </div>
                    <div className="mt-3 space-y-2">
                      {declarationOptions.map((option) => (
                        <button
                          key={`manual-${option.label}`}
                          type="button"
                          onClick={() => declareMutation.mutate(option.value)}
                          disabled={declareMutation.isPending || analyzeEfootballResultMutation.isPending}
                          className="w-full rounded-full bg-ink px-4 py-3 text-sm font-semibold text-sand disabled:cursor-not-allowed disabled:opacity-55"
                        >
                          Submit manually: {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {!isEfootball ? (
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
            ) : null}
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
              Either joined participant or an arbiter can now settle this from here.
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
              {pact.hasOnChainDisputeEvidence
                ? 'At least one participant has submitted proof on-chain. An arbiter can now resolve the outcome from here.'
                : pact.creatorEvidence || pact.counterpartyEvidence
                  ? 'A file has been uploaded, but a participant still needs to submit that proof on-chain before an arbiter can resolve this pact.'
                  : 'At least one participant must submit dispute proof on-chain before an arbiter can resolve this pact.'}
            </p>
            {!pact.adminReviewReady ? (
              <div className="mt-3 rounded-[18px] border border-amber-200 bg-white px-4 py-3 text-sm text-amber-950">
                Admin settlement is locked by the contract until the creator or counterparty commits at least one proof link on-chain from this pact page.
              </div>
            ) : null}
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
                className="w-full rounded-full bg-ink px-5 py-4 text-base font-semibold text-sand disabled:cursor-not-allowed disabled:opacity-50"
              >
                Award {formatParticipantLabel(pact.creator, creatorMeta?.username)}
              </button>
              <button
                type="button"
                onClick={() => resolveWinnerMutation.mutate(pact.counterparty)}
                disabled={!pact.adminReviewReady || resolveWinnerMutation.isPending || resolveSplitMutation.isPending}
                className="w-full rounded-full bg-ink px-5 py-4 text-base font-semibold text-sand disabled:cursor-not-allowed disabled:opacity-50"
              >
                Award {formatParticipantLabel(pact.counterparty, counterpartyMeta?.username)}
              </button>
              <button
                type="button"
                onClick={() => resolveSplitMutation.mutate()}
                disabled={!pact.adminReviewReady || resolveWinnerMutation.isPending || resolveSplitMutation.isPending}
                className="w-full rounded-full bg-sand px-5 py-4 text-base font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50"
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
