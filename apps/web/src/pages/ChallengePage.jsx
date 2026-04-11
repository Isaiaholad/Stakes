import { Link, useParams } from 'react-router-dom';
import ConnectionStatusCard from '../components/ConnectionStatusCard.jsx';
import ConfigBanner from '../components/ConfigBanner.jsx';
import ConnectCard from '../components/ConnectCard.jsx';
import ReadStatusNote from '../components/ReadStatusNote.jsx';
import PactActionsCard from '../features/pact-detail/PactActionsCard.jsx';
import PactChatCard from '../features/pact-detail/PactChatCard.jsx';
import PactDeclarationsCard from '../features/pact-detail/PactDeclarationsCard.jsx';
import PactEvidenceCard from '../features/pact-detail/PactEvidenceCard.jsx';
import PactOverviewCard from '../features/pact-detail/PactOverviewCard.jsx';
import { usePactDetailPage } from '../features/pact-detail/usePactDetailPage.js';
import { useWalletStore } from '../store/useWalletStore.js';

export default function ChallengePage() {
  const { id } = useParams();
  const address = useWalletStore((state) => state.address);
  const vm = usePactDetailPage(id, address);

  if (!vm.configured) {
    return (
      <div className="space-y-5">
        <ConfigBanner />
      </div>
    );
  }

  if (vm.pactQuery.isLoading && !vm.pact) {
    return <div className="py-12 text-sm text-slate/70">Loading pact...</div>;
  }

  if (vm.pactQuery.error && !vm.pact) {
    return (
      <div className="space-y-5">
        <ConfigBanner />
        <ConnectionStatusCard
          error={vm.pactQuery.error}
          fallbackTitle="Could not load pact"
          onRetry={() => vm.pactQuery.refetch()}
        />
      </div>
    );
  }

  const pact = vm.pact;
  const protocol = vm.protocol;
  const privateViewerAccessCheckPending =
    Boolean(address) && pact.participantRole === 'viewer' && !pact.isOpen && vm.vaultQuery.isLoading;

  if (privateViewerAccessCheckPending) {
    return <div className="py-12 text-sm text-slate/70">Checking pact access...</div>;
  }

  if (pact.participantRole === 'viewer' && !pact.isOpen && !protocol?.isArbiter) {
    return (
      <div className="space-y-5">
        <ConfigBanner />
        <section className="rounded-[32px] bg-white/85 p-5 shadow-glow">
          <p className="text-xs uppercase tracking-[0.24em] text-slate/50">Private pact</p>
          <h1 className="mt-2 font-display text-3xl text-ink">This pact is private</h1>
          <p className="mt-2 text-sm text-slate/70">
            Only the involved wallets can view or act on this pact in the app.
          </p>
          <div className="mt-4">
            <Link to="/explore" className="rounded-full bg-ink px-4 py-3 text-sm font-semibold text-sand">
              Back to explore
            </Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ConfigBanner />
      <ReadStatusNote query={vm.pactQuery} label="Pact detail" />
      {address && vm.commentsQuery.data ? <ReadStatusNote query={vm.commentsQuery} label="Shared pact chat" /> : null}

      <PactOverviewCard
        pact={pact}
        protocolSymbol={protocol?.symbol || 'USDC'}
        creatorLabel={vm.creatorMeta?.label}
        creatorSublabel={vm.creatorMeta?.sublabel}
        counterpartyLabel={vm.counterpartyMeta?.label}
        counterpartySublabel={vm.counterpartyMeta?.sublabel}
        finalResultStatus={vm.finalResultStatus}
        now={vm.now}
        onCopyShareLink={vm.handleCopyShareLink}
      />

      {!address ? (
        <ConnectCard compact />
      ) : (
        <PactActionsCard
          pact={pact}
          address={address}
          creatorMeta={vm.creatorMeta}
          counterpartyMeta={vm.counterpartyMeta}
          declarationOptions={vm.declarationOptions}
          joinBalanceError={vm.joinBalanceError}
          joinMutation={vm.joinMutation}
          cancelMutation={vm.cancelMutation}
          cancelExpiredMutation={vm.cancelExpiredMutation}
          declareMutation={vm.declareMutation}
          singleDeclarationDisputeMutation={vm.singleDeclarationDisputeMutation}
          mismatchDisputeMutation={vm.mismatchDisputeMutation}
          settleMutation={vm.settleMutation}
          resolveWinnerMutation={vm.resolveWinnerMutation}
          resolveSplitMutation={vm.resolveSplitMutation}
          forceDisputeSplitMutation={vm.forceDisputeSplitMutation}
          resolutionRef={vm.resolutionRef}
          setResolutionRef={vm.setResolutionRef}
          matchedResultWillAutoFinalize={vm.matchedResultWillAutoFinalize}
          conflictingResultWillAutoDispute={vm.conflictingResultWillAutoDispute}
          deadlineOutcomeWillAutoSettle={vm.deadlineOutcomeWillAutoSettle}
          singleDeclarationReviewPending={vm.singleDeclarationReviewPending}
          settlementAction={vm.settlementAction}
        />
      )}

      <PactEvidenceCard
        pact={pact}
        catboxUploadConfigured={vm.catboxUploadConfigured}
        disputeEvidenceDraft={vm.disputeEvidenceDraft}
        setDisputeEvidenceDraft={vm.setDisputeEvidenceDraft}
        pendingEvidenceFile={vm.pendingEvidenceFile}
        setPendingEvidenceFile={vm.setPendingEvidenceFile}
        evidenceUploads={vm.evidenceUploads}
        evidenceHistory={vm.evidenceHistory}
        evidenceHistoryQuery={vm.evidenceHistoryQuery}
        uploadDisputeFileMutation={vm.uploadDisputeFileMutation}
        disputeEvidenceMutation={vm.disputeEvidenceMutation}
        handleEvidenceSubmit={vm.handleEvidenceSubmit}
        now={vm.now}
      />

      <PactDeclarationsCard
        pact={pact}
        creatorLabel={vm.creatorMeta?.label}
        counterpartyLabel={vm.counterpartyMeta?.label}
        formatParticipant={vm.formatParticipant}
      />

      <PactChatCard
        address={address}
        comments={vm.comments}
        commentsQuery={vm.commentsQuery}
        chatAccessMessage={vm.chatAccessMessage}
        canCurrentWalletChat={vm.canCurrentWalletChat}
        requiresParticipantAccess={vm.requiresParticipantAccess}
        commentDraft={vm.commentDraft}
        setCommentDraft={vm.setCommentDraft}
        maxCommentLength={vm.maxCommentLength}
        canPostComment={vm.canPostComment}
        handleCommentSubmit={vm.handleCommentSubmit}
        postCommentMutation={vm.postCommentMutation}
        formatParticipant={vm.formatParticipant}
        now={vm.now}
      />
    </div>
  );
}
