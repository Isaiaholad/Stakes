import { useState } from 'react';
import { Flag, Gavel, Wallet } from 'lucide-react';
import EvidenceExamples from '../../components/EvidenceExamples.jsx';
import { formatParticipantLabel, getDeclarationButtonShell } from './pactDetailUtils.js';

function getCreatorChessColor(pact) {
  const match = String(pact?.description || '').match(/creator(?:'s)?\s+chess\s+color\s*:\s*(white|black)/i);
  return match?.[1] ? match[1].slice(0, 1).toUpperCase() + match[1].slice(1).toLowerCase() : '';
}

function getCreatorChessPlatform(pact) {
  const match = String(pact?.description || '').match(/creator(?:'s)?\s+chess\s+platform\s*:\s*(chess\.com|lichess)/i);
  const normalized = String(match?.[1] || '').toLowerCase();
  return normalized === 'lichess' ? 'lichess' : 'chess.com';
}

function normalizeChessPlatform(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'lichess' || normalized === 'lichess.org' ? 'lichess' : 'chess.com';
}

function getChessPlatformLabel(platform) {
  return normalizeChessPlatform(platform) === 'lichess' ? 'Lichess' : 'Chess.com';
}

function getChessUrlPlaceholder(platform) {
  return normalizeChessPlatform(platform) === 'lichess'
    ? 'https://lichess.org/3Rx1HG6H'
    : 'https://www.chess.com/game/168982835114';
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
  analyzeChessResultMutation,
  gameMetadata,
  singleDeclarationDisputeMutation,
  mismatchDisputeMutation,
  settleMutation,
  finalizeMatchedMutation,
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
  managedUploadConfigured,
  pendingEvidenceFile,
  setPendingEvidenceFile,
  uploadDisputeFileMutation,
  evidenceUploads,
  efootballEvidenceReady
}) {
  const [joinUsernameDraft, setJoinUsernameDraft] = useState('');
  const [joinChessUsernameDraft, setJoinChessUsernameDraft] = useState('');
  const [chessGameUrlDraft, setChessGameUrlDraft] = useState('');

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
  const showDisputeFallbackActions = true;
  const chessPlatform = normalizeChessPlatform(gameMetadata?.platform || getCreatorChessPlatform(pact));
  const chessPlatformLabel = getChessPlatformLabel(chessPlatform);
  const creatorChessColor = gameMetadata?.creatorColor || getCreatorChessColor(pact);
  const suggestedChessColor = getOppositeChessColor(creatorChessColor);
  const creatorChessUsername = String(gameMetadata?.creatorPlatformUsername || '').trim();
  const joinChessColor = suggestedChessColor;
  const joinChessUsername = joinChessUsernameDraft.trim();
  const joinChessUsernameMatchesCreator =
    creatorChessUsername &&
    joinChessUsername &&
    creatorChessUsername.toLowerCase() === joinChessUsername.toLowerCase().replace(/^@+/, '');
  const chessGameUrl = chessGameUrlDraft.trim() || gameMetadata?.gameUrl || '';
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
                <p className="font-display text-xl text-ink">Join with {chessPlatformLabel}</p>
                <p className="mt-1 text-sm text-slate/70">
                  {creatorChessColor
                    ? `The creator is locked to ${creatorChessColor}. You will play ${joinChessColor}.`
                    : `The creator must lock a color before ${chessPlatformLabel} URL verification can work.`}
                </p>
                <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
                  Your {chessPlatformLabel} username
                </label>
                <input
                  value={joinChessUsernameDraft}
                  onChange={(event) => setJoinChessUsernameDraft(event.target.value)}
                  placeholder={chessPlatform === 'lichess' ? 'isaiaholad' : 'isco-olad'}
                  className="mt-2 w-full rounded-[22px] border border-amber-200 bg-amber-50/60 px-4 py-4 text-base font-semibold text-ink outline-none transition focus:border-amber-500 focus:bg-white"
                />
                <div className="mt-3 rounded-[18px] bg-amber-50 px-4 py-3 text-sm text-amber-950">
                  <span className="font-semibold">Locked color:</span> {joinChessColor || 'Waiting for creator color'}
                </div>
                {joinChessUsernameMatchesCreator ? (
                  <p className="mt-2 text-xs text-rose-700">
                    Use your own {chessPlatformLabel} username. It cannot match the creator's username.
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={() => joinMutation.mutate({ chessUsername: joinChessUsername, chessColor: joinChessColor, platform: chessPlatform })}
                  disabled={
                    joinMutation.isPending ||
                    Boolean(joinBalanceError) ||
                    !joinChessUsername ||
                    !joinChessColor ||
                    joinChessUsernameMatchesCreator
                  }
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-ink px-5 py-4 text-base font-semibold text-sand disabled:cursor-not-allowed disabled:opacity-55"
                >
                  <Wallet className="h-5 w-5" />
                  {joinMutation.isPending ? 'Joining pact...' : `Join and save ${chessPlatformLabel} details`}
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
                {isEfootball ? 'Upload result screenshot' : isChess ? `Verify ${chessPlatformLabel} result` : 'Submit winner declaration'}
              </p>
            </div>

            {isEfootball && managedUploadConfigured ? (
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
                <EvidenceExamples
                  compact
                  title="Good screenshot examples"
                  description="Use a final-result screen where the full-time score or winner text is visible."
                  className="mb-3 border-emerald-200"
                />
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

            {isChess ? (
              <div className="mt-4 rounded-[16px] border border-amber-200 bg-white p-3">
                <p className="text-sm font-semibold text-amber-950">Paste the {chessPlatformLabel} game URL</p>
                <p className="mt-1 text-xs leading-5 text-amber-900">
                  We verify the public result against the locked usernames and colors before submitting it on-chain.
                </p>
                <input
                  value={chessGameUrlDraft}
                  onChange={(event) => setChessGameUrlDraft(event.target.value)}
                  placeholder={gameMetadata?.gameUrl || getChessUrlPlaceholder(chessPlatform)}
                  className="mt-3 w-full rounded-[22px] border border-amber-200 bg-amber-50/60 px-4 py-4 text-sm font-semibold text-ink outline-none transition focus:border-amber-500 focus:bg-white"
                />
                <div className="mt-3 grid gap-2 rounded-[18px] bg-amber-50 px-4 py-3 text-xs text-amber-950 sm:grid-cols-2">
                  <p><span className="font-semibold">Creator:</span> {creatorChessUsername || 'Missing'} as {creatorChessColor || 'Missing'}</p>
                  <p><span className="font-semibold">Counterparty:</span> {gameMetadata?.counterpartyPlatformUsername || 'Missing'} as {gameMetadata?.counterpartyColor || 'Missing'}</p>
                </div>
                <button
                  type="button"
                  onClick={() => analyzeChessResultMutation.mutate({ gameUrl: chessGameUrl })}
                  disabled={
                    !chessGameUrl ||
                    analyzeChessResultMutation.isPending ||
                    declareMutation.isPending ||
                    !gameMetadata?.creatorPlatformUsername ||
                    !gameMetadata?.counterpartyPlatformUsername ||
                    !gameMetadata?.creatorColor ||
                    !gameMetadata?.counterpartyColor
                  }
                  className="mt-3 w-full rounded-full bg-ink px-5 py-4 text-sm font-semibold text-sand disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {analyzeChessResultMutation.isPending ? `Checking ${chessPlatformLabel}...` : 'Verify URL and submit result'}
                </button>
                {analyzeChessResultMutation.isError ? (
                  <div className="mt-4 rounded-[18px] border border-amber-200 bg-amber-50 p-4 text-amber-950">
                    <p className="text-sm font-semibold">URL verification could not auto-settle</p>
                    <p className="mt-2 text-xs leading-5 text-amber-900">
                      Check that the URL, {chessPlatformLabel} usernames, locked colors, and pact timing all match, then try again. If both players submit verified URLs that point to different winners, the pact moves into dispute/admin review.
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}

            {!isEfootball && !isChess ? (
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
            <button
              type="button"
              onClick={() => finalizeMatchedMutation.mutate()}
              disabled={finalizeMatchedMutation.isPending}
              className="mt-3 w-full rounded-full bg-emerald-600 px-5 py-4 text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-55"
            >
              {finalizeMatchedMutation.isPending ? 'Finalizing result...' : 'Finalize matched result'}
            </button>
          </div>
        ) : null}

        {showDisputeFallbackActions && conflictingResultWillAutoDispute ? (
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
              {isChess
                ? currentWalletMissedDeclaration
                  ? 'The other player submitted a verified chess URL before the deadline. If that result is wrong, raise a dispute during this review period so an admin can review the submitted URL evidence.'
                  : 'One verified chess URL was submitted before the deadline. The other player can raise a dispute during the review period if they missed the result window or disagree.'
                : currentWalletMissedDeclaration
                  ? 'This wallet missed the declaration window. You can still raise a dispute during the 30-minute review period before the lone declaration settles on-chain.'
                  : 'One side declared before the deadline. The pact now waits through its 30-minute review period before that declaration can settle on-chain.'}
            </p>
            {showDisputeFallbackActions && pact.canOpenUnansweredDeclarationDispute ? (
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

        {showDisputeFallbackActions && pact.canAdminResolve ? (
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

        {showDisputeFallbackActions && pact.canForceDisputeSplit ? (
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
        !(showDisputeFallbackActions && conflictingResultWillAutoDispute) &&
        !singleDeclarationReviewPending &&
        !(showDisputeFallbackActions && pact.canOpenUnansweredDeclarationDispute) &&
        !deadlineOutcomeWillAutoSettle &&
        !(showDisputeFallbackActions && pact.canAdminResolve) &&
        !(showDisputeFallbackActions && pact.canForceDisputeSplit) ? (
          <p className="text-sm text-slate/70">There is no action to take from this wallet right now.</p>
        ) : null}
      </div>
    </section>
  );
}
