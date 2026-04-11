import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zeroAddress } from 'viem';
import { isCatboxUploadConfigured } from '../../lib/catbox.js';
import { readPactEvidenceHistory, uploadManagedEvidence } from '../../lib/evidence.js';
import { appendPactComment, getMaxPactCommentLength, readPactCommentThread } from '../../lib/pactComments.js';
import {
  adminResolveSplit,
  adminResolveWinner,
  cancelExpiredPact,
  cancelPact,
  forceSplitAfterDisputeTimeout,
  joinPact,
  openMismatchDispute,
  openUnansweredDeclarationDispute,
  readDisputeOpenedAt,
  readPactById,
  readUsernameByAddress,
  settleAfterDeclarationWindow,
  readVaultSnapshot,
  submitDisputeEvidence,
  submitWinner
} from '../../lib/pacts.js';
import { hasUsernameRegistryConfigured, isProtocolConfigured } from '../../lib/contracts.js';
import { shortenAddress } from '../../lib/formatters.js';
import { useNow } from '../../hooks/useNow.js';
import { useProtocolReadiness } from '../../hooks/useProtocolReadiness.js';
import { useToastStore } from '../../store/useToastStore.js';
import {
  formatParticipantLabel,
  getFinalResultStatus,
  getParticipantBadge,
  getReceiptStatusMessage
} from './pactDetailUtils.js';

function buildUploadId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `${Date.now()}`;
}

const disputeTimeoutMs = 7 * 24 * 60 * 60 * 1000;

function buildDeclarationOptionLabel({ isSelf, username, address }) {
  const identityLabel = username ? ` @${username}` : address ? ` ${shortenAddress(address)}` : '';

  return isSelf
    ? `Choose this if you${identityLabel} won`
    : `Choose this if your opponent${identityLabel} won`;
}

function getCommentFailureMessage(error, { isOpenPact = false } = {}) {
  const rawMessage = String(error?.message || '').trim();

  if (/sign a wallet message before posting to pact chat/i.test(rawMessage)) {
    return 'Pact chat now uses your wallet session. Approve the one-time signature for this device, then try posting again.';
  }

  if (/wallet session could not be saved on this device/i.test(rawMessage)) {
    return 'This browser did not keep the chat sign-in session. Try the one-time wallet signature again, then post once more.';
  }

  if (/pact not found/i.test(rawMessage)) {
    return 'This pact thread is still catching up. Refresh in a moment and try posting again.';
  }

  if (/only pact participants or arbiters can post in this chat/i.test(rawMessage)) {
    return isOpenPact
      ? 'Only the creator can post until a counterparty joins and reserves stake. After that, both joined participants and arbiters can comment.'
      : 'Only the creator, joined counterparty, or an arbiter can post in this pact thread.';
  }

  return rawMessage || 'Could not save this comment.';
}

export function usePactDetailPage(id, address) {
  const showToast = useToastStore((state) => state.showToast);
  const queryClient = useQueryClient();
  const [resolutionRef, setResolutionRef] = useState('manual-review');
  const [disputeEvidenceDraft, setDisputeEvidenceDraft] = useState('');
  const [pendingEvidenceFile, setPendingEvidenceFile] = useState(null);
  const [evidenceUploads, setEvidenceUploads] = useState([]);
  const [commentDraft, setCommentDraft] = useState('');
  const configured = isProtocolConfigured();
  const readiness = useProtocolReadiness();
  const readsEnabled = configured;
  const usernameRegistryConfigured = hasUsernameRegistryConfigured();
  const catboxUploadConfigured = isCatboxUploadConfigured();
  const maxCommentLength = getMaxPactCommentLength();
  const now = useNow(15_000);

  const pactQuery = useQuery({
    queryKey: ['pact', id, address],
    queryFn: () => readPactById(id, address, { preferIndexed: readiness.canRead }),
    enabled: configured,
    refetchInterval: 15_000
  });

  const vaultQuery = useQuery({
    queryKey: ['vault', address],
    queryFn: () => readVaultSnapshot(address),
    enabled: Boolean(address) && configured,
    refetchInterval: 60_000
  });

  const creatorUsernameQuery = useQuery({
    queryKey: ['username', pactQuery.data?.creator],
    queryFn: () => readUsernameByAddress(pactQuery.data.creator),
    enabled:
      configured &&
      usernameRegistryConfigured &&
      Boolean(pactQuery.data?.creator) &&
      pactQuery.data?.creator !== zeroAddress
  });

  const counterpartyUsernameQuery = useQuery({
    queryKey: ['username', pactQuery.data?.counterparty],
    queryFn: () => readUsernameByAddress(pactQuery.data.counterparty),
    enabled:
      configured &&
      usernameRegistryConfigured &&
      Boolean(pactQuery.data?.counterparty) &&
      pactQuery.data?.counterparty !== zeroAddress
  });

  const commentsQuery = useQuery({
    queryKey: ['pact-messages', id, address],
    queryFn: () => readPactCommentThread(id, address),
    enabled: configured,
    refetchInterval: 15_000
  });

  const evidenceHistoryQuery = useQuery({
    queryKey: ['pact-evidence', id, address],
    queryFn: () => readPactEvidenceHistory(id, address),
    enabled: configured,
    refetchInterval: 15_000
  });

  const disputeOpenedAtQuery = useQuery({
    queryKey: ['pact-dispute-opened-at', id],
    queryFn: () => readDisputeOpenedAt(id),
    enabled: configured && Boolean(address) && pactQuery.data?.rawStatus === 'Disputed',
    staleTime: 15_000,
    refetchInterval: 15_000
  });

  const refreshAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['pacts'] }),
      queryClient.invalidateQueries({ queryKey: ['explore-pacts'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-pacts'] }),
      queryClient.invalidateQueries({ queryKey: ['pact', id, address] }),
      queryClient.invalidateQueries({ queryKey: ['vault', address] }),
      queryClient.invalidateQueries({ queryKey: ['pact-messages', id, address] }),
      queryClient.invalidateQueries({ queryKey: ['pact-evidence', id, address] })
    ]);
  };

  const createMutationHandlers = (successTitle, errorTitle) => ({
    onSuccess: async (receipt) => {
      await refreshAll();
      showToast({
        variant: 'success',
        title: successTitle,
        message: getReceiptStatusMessage(receipt)
      });
    },
    onError: (error) => {
      showToast({
        variant: 'error',
        title: errorTitle,
        message: error?.message || `${errorTitle}.`
      });
    }
  });

  const joinStakeAmount = Number(pactQuery.data?.stakeFormatted || 0);
  const availableVaultBalance = Number(vaultQuery.data?.availableBalance || 0);
  const joinSymbol = vaultQuery.data?.symbol || 'USDC';
  const joinBalanceError =
    address &&
    pactQuery.data?.canJoin &&
    vaultQuery.data &&
    availableVaultBalance + 1e-9 < joinStakeAmount
      ? `You need ${joinStakeAmount.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${joinSymbol} available in the vault before you can join.`
      : '';

  const joinMutation = useMutation({
    mutationFn: async () => {
      if (!address) {
        throw new Error('Connect your wallet to join this pact.');
      }

      if (!vaultQuery.data) {
        throw new Error('Vault balance is still loading. Try joining again in a moment.');
      }

      if (joinBalanceError) {
        throw new Error(joinBalanceError);
      }

      return joinPact(address, id);
    },
    ...createMutationHandlers('Pact joined', 'Join failed')
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelPact(address, id),
    ...createMutationHandlers('Pact cancelled', 'Cancel failed')
  });

  const cancelExpiredMutation = useMutation({
    mutationFn: () => cancelExpiredPact(address, id),
    ...createMutationHandlers('Expired pact cancelled', 'Cancel expired failed')
  });

  const declareMutation = useMutation({
    mutationFn: (winner) => submitWinner(address, id, winner),
    ...createMutationHandlers('Declaration submitted', 'Declaration failed')
  });

  const singleDeclarationDisputeMutation = useMutation({
    mutationFn: () => openUnansweredDeclarationDispute(address, id),
    ...createMutationHandlers('Dispute opened', 'Dispute failed')
  });

  const mismatchDisputeMutation = useMutation({
    mutationFn: () => openMismatchDispute(address, id),
    ...createMutationHandlers('Dispute opened', 'Dispute failed')
  });

  const settleMutation = useMutation({
    mutationFn: () => settleAfterDeclarationWindow(address, id),
    ...createMutationHandlers('Declaration window settled', 'Settlement failed')
  });

  const disputeEvidenceMutation = useMutation({
    mutationFn: () => {
      const linksSection = evidenceUploads
        .filter((item) => item.status === 'uploaded' && item.url)
        .map((item) => item.url)
        .join('\n');
      const payload = [disputeEvidenceDraft.trim(), linksSection ? `File links:\n${linksSection}` : '']
        .filter(Boolean)
        .join('\n\n');
      return submitDisputeEvidence(address, id, payload);
    },
    onSuccess: async () => {
      setDisputeEvidenceDraft('');
      setPendingEvidenceFile(null);
      setEvidenceUploads([]);
      await refreshAll();
      showToast({
        variant: 'success',
        title: 'Dispute proof submitted',
        message: 'Your proof has been attached to this dispute on-chain.'
      });
    },
    onError: (error) => {
      showToast({
        variant: 'error',
        title: 'Dispute proof failed',
        message: error?.message || 'Could not submit this dispute proof.'
      });
    }
  });

  const uploadDisputeFileMutation = useMutation({
    mutationFn: async () => {
      if (!pendingEvidenceFile) {
        throw new Error('Choose a file before uploading.');
      }

      return uploadManagedEvidence({
        pactId: Number(id),
        address,
        file: pendingEvidenceFile
      });
    },
    onMutate: async () => {
      const uploadId = buildUploadId();
      const currentFile = pendingEvidenceFile;
      setEvidenceUploads((current) => [
        {
          id: uploadId,
          name: currentFile?.name || 'Evidence file',
          sizeBytes: currentFile?.size || 0,
          status: 'uploading',
          url: '',
          createdAt: new Date().toISOString(),
          error: ''
        },
        ...current
      ]);

      return {
        uploadId
      };
    },
    onSuccess: async (result, _variables, context) => {
      setEvidenceUploads((current) =>
        current.map((item) =>
          item.id === context?.uploadId
            ? {
                ...item,
                status: 'uploaded',
                url: result.url,
                contentHashSha256: result.contentHashSha256
              }
            : item
        )
      );
      setPendingEvidenceFile(null);
      await evidenceHistoryQuery.refetch();
      showToast({
        variant: 'success',
        title: 'File uploaded',
        message: `${result.name} was uploaded to Catbox and recorded in the evidence history.`
      });
    },
    onError: (error, _variables, context) => {
      setEvidenceUploads((current) =>
        current.map((item) =>
          item.id === context?.uploadId
            ? {
                ...item,
                status: 'failed',
                error: error?.message || 'Upload failed.'
              }
            : item
        )
      );
      showToast({
        variant: 'error',
        title: 'Upload failed',
        message: error?.message || 'Could not upload this file to Catbox.'
      });
    }
  });

  const resolveWinnerMutation = useMutation({
    mutationFn: (winner) => adminResolveWinner(address, id, winner, resolutionRef),
    ...createMutationHandlers('Winner resolved', 'Resolution failed')
  });

  const resolveSplitMutation = useMutation({
    mutationFn: () => adminResolveSplit(address, id, 5000, resolutionRef),
    ...createMutationHandlers('Split resolved', 'Resolution failed')
  });

  const forceDisputeSplitMutation = useMutation({
    mutationFn: () => forceSplitAfterDisputeTimeout(address, id),
    ...createMutationHandlers('Dispute split forced', 'Split fallback failed')
  });

  const postCommentMutation = useMutation({
    mutationFn: async () => {
      if (!address) {
        throw new Error('Connect your wallet to post in pact chat.');
      }

      return appendPactComment({
        pactId: pactQuery.data?.id || id,
        address,
        message: commentDraft
      });
    },
    onSuccess: async () => {
      setCommentDraft('');
      await commentsQuery.refetch();
      showToast({
        variant: 'success',
        title: 'Comment posted',
        message: 'Your note was added to this pact thread.'
      });
    },
    onError: (error) => {
      showToast({
        variant: 'error',
        title: 'Comment failed',
        message: getCommentFailureMessage(error, { isOpenPact: Boolean(pactQuery.data?.isOpen) })
      });
    }
  });

  useEffect(() => {
    setDisputeEvidenceDraft('');
    setPendingEvidenceFile(null);
    setEvidenceUploads([]);
  }, [pactQuery.data?.currentUserEvidence, pactQuery.data?.id]);

  const rawPact = pactQuery.data;
  const protocol = vaultQuery.data;
  const pact = useMemo(() => {
    if (!rawPact) {
      return rawPact;
    }

    const disputeOpenedAt = Number(disputeOpenedAtQuery.data || 0);
    const disputeTimeoutAt = disputeOpenedAt > 0 ? new Date(disputeOpenedAt * 1000 + disputeTimeoutMs).toISOString() : null;
    const canForceDisputeSplit =
      Boolean(address) &&
      rawPact.rawStatus === 'Disputed' &&
      rawPact.participantRole !== 'viewer' &&
      disputeOpenedAt > 0 &&
      now > disputeOpenedAt * 1000 + disputeTimeoutMs;

    return {
      ...rawPact,
      adminReviewReady:
        Boolean(rawPact.canAdminResolve) &&
        (Boolean(rawPact.creatorEvidence?.trim()) || Boolean(rawPact.counterpartyEvidence?.trim())),
      disputeTimeoutAt,
      canForceDisputeSplit
    };
  }, [address, disputeOpenedAtQuery.data, now, rawPact]);
  const creatorUsername = creatorUsernameQuery.data || pact?.creatorUsername || '';
  const counterpartyUsername = counterpartyUsernameQuery.data || pact?.counterpartyUsername || '';

  const getParticipantUsername = (walletAddress) => {
    if (!walletAddress || walletAddress === zeroAddress) {
      return '';
    }

    if (walletAddress.toLowerCase() === pact?.creator?.toLowerCase()) {
      return creatorUsername;
    }

    if (pact?.counterparty !== zeroAddress && walletAddress.toLowerCase() === pact?.counterparty?.toLowerCase()) {
      return counterpartyUsername;
    }

    return '';
  };

  const getParticipantMeta = (walletAddress) => {
    const username = getParticipantUsername(walletAddress);
    const isSelf = Boolean(address) && walletAddress?.toLowerCase() === address.toLowerCase();

    return {
      address: walletAddress,
      username,
      isSelf,
      label: isSelf ? 'You' : formatParticipantLabel(walletAddress, username),
      badge: isSelf ? 'ME' : getParticipantBadge(walletAddress, username),
      sublabel:
        walletAddress && walletAddress !== zeroAddress && username ? shortenAddress(walletAddress) : null
    };
  };

  const formatParticipant = (walletAddress) => {
    if (walletAddress === zeroAddress) {
      return 'Split payout';
    }

    return getParticipantMeta(walletAddress).label;
  };

  const creatorMeta = pact ? getParticipantMeta(pact.creator) : null;
  const counterpartyMeta = pact ? getParticipantMeta(pact.counterparty) : null;

  const declarationOptions = useMemo(() => {
    if (!pact || !creatorMeta || !counterpartyMeta) {
      return [];
    }

    return [
      {
        label: buildDeclarationOptionLabel({
          isSelf: creatorMeta.isSelf,
          username: creatorMeta.username,
          address: pact.creator
        }),
        value: pact.creator,
        tone: creatorMeta.isSelf ? 'self' : 'opponent',
        badge: creatorMeta.badge,
        helper: ''
      },
      {
        label: buildDeclarationOptionLabel({
          isSelf: counterpartyMeta.isSelf,
          username: counterpartyMeta.username,
          address: pact.counterparty
        }),
        value: pact.counterparty,
        tone: counterpartyMeta.isSelf ? 'self' : 'opponent',
        badge: counterpartyMeta.badge,
        helper: ''
      }
    ];
  }, [counterpartyMeta, creatorMeta, pact]);

  const finalResultStatus = pact ? getFinalResultStatus(pact, formatParticipant, now) : null;
  const shareUrl = typeof window !== 'undefined' && pact ? `${window.location.origin}/pact/${pact.id}` : '';
  const comments = commentsQuery.data?.messages || [];
  const requiresParticipantAccess = Boolean(commentsQuery.data?.requiresParticipantAccess);
  const evidenceHistory = evidenceHistoryQuery.data || [];
  const canCurrentWalletChat =
    Boolean(address) && Boolean(pact?.participantRole !== 'viewer' || protocol?.isArbiter || protocol?.isAdmin);
  const chatAccessMessage = !address
    ? 'Connect a wallet to join the shared pact chat.'
    : pact?.isOpen && pact?.participantRole === 'creator'
        ? 'Only the creator can comment until a counterparty joins and reserves stake.'
        : !canCurrentWalletChat
          ? 'Only the creator, joined counterparty, or an arbiter can post in this thread.'
        : 'Chat is ready for the joined pact participants. Posting only needs a one-time wallet sign-in if this device does not already have an active session.';

  const singleDeclarationPending =
    Boolean(
      pact &&
        pact.rawStatus === 'Active' &&
        pact.declarationWindowClosed &&
        ((pact.creatorDeclaration.submitted && !pact.counterpartyDeclaration.submitted) ||
          (!pact.creatorDeclaration.submitted && pact.counterpartyDeclaration.submitted))
    );
  const singleDeclarationReviewPending = Boolean(singleDeclarationPending && !pact?.canSettleAfterDeadline);
  const matchedResultWillAutoFinalize = Boolean(pact?.canFinalize);
  const conflictingResultWillAutoDispute = Boolean(pact?.canOpenMismatchDispute);
  const deadlineOutcomeWillAutoSettle = Boolean(pact?.canSettleAfterDeadline && !pact?.canOpenMismatchDispute);

  const settlementAction = useMemo(() => {
    if (!pact?.canSettleAfterDeadline || pact?.canOpenMismatchDispute) {
      return null;
    }

    const creatorSubmitted = Boolean(pact.creatorDeclaration.submitted);
    const counterpartySubmitted = Boolean(pact.counterpartyDeclaration.submitted);

    if (!creatorSubmitted && !counterpartySubmitted) {
      return {
        label: 'Retry automatic split settlement',
        helper: 'No winner was declared before the window closed, so the pact now settles into a split payout.'
      };
    }

    if (creatorSubmitted !== counterpartySubmitted) {
      return {
        label: 'Settle lone declaration',
        helper: 'The timeout and grace period are over, so the lone declaration can now settle to the declared winner.'
      };
    }

    if (pact.bothSubmitted && !pact.declarationsMatch) {
      return {
        label: 'Retry automatic dispute opening',
        helper: 'Both sides submitted different results, so the pact now moves into the on-chain dispute flow.'
      };
    }

    return {
      label: 'Retry automatic settlement',
      helper: 'The outcome is ready for on-chain settlement.'
    };
  }, [pact]);
  const canPostComment = Boolean(address) && Boolean(commentDraft.trim()) && canCurrentWalletChat;

  const handleCopyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast({
        variant: 'success',
        title: 'Link copied',
        message: 'The pact link is ready to share.'
      });
    } catch {
      showToast({
        variant: 'error',
        title: 'Copy failed',
        message: 'Clipboard access is unavailable. Copy the link from the browser address bar.'
      });
    }
  };

  const handleCommentSubmit = (event) => {
    event.preventDefault();
    postCommentMutation.mutate();
  };

  const handleEvidenceSubmit = (event) => {
    event.preventDefault();
    const uploadedLinks = evidenceUploads.filter((item) => item.status === 'uploaded' && item.url);
    if (!disputeEvidenceDraft.trim() && !uploadedLinks.length) {
      return;
    }

    disputeEvidenceMutation.mutate();
  };

  return {
    configured,
    readiness,
    readsEnabled,
    usernameRegistryConfigured,
    catboxUploadConfigured,
    maxCommentLength,
    now,
    pactQuery,
    vaultQuery,
    creatorUsernameQuery,
    counterpartyUsernameQuery,
    commentsQuery,
    evidenceHistoryQuery,
    disputeOpenedAtQuery,
    pact,
    protocol,
    creatorMeta,
    counterpartyMeta,
    creatorUsername,
    counterpartyUsername,
    declarationOptions,
    finalResultStatus,
    shareUrl,
    comments,
    requiresParticipantAccess,
    evidenceHistory,
    resolutionRef,
    setResolutionRef,
    disputeEvidenceDraft,
    setDisputeEvidenceDraft,
    pendingEvidenceFile,
    setPendingEvidenceFile,
    evidenceUploads,
    setEvidenceUploads,
    commentDraft,
    setCommentDraft,
    joinBalanceError,
    joinMutation,
    cancelMutation,
    cancelExpiredMutation,
    declareMutation,
    singleDeclarationDisputeMutation,
    mismatchDisputeMutation,
    settleMutation,
    disputeEvidenceMutation,
    uploadDisputeFileMutation,
    resolveWinnerMutation,
    resolveSplitMutation,
    forceDisputeSplitMutation,
    postCommentMutation,
    chatAccessMessage,
    canCurrentWalletChat,
    canPostComment,
    matchedResultWillAutoFinalize,
    conflictingResultWillAutoDispute,
    deadlineOutcomeWillAutoSettle,
    singleDeclarationReviewPending,
    settlementAction,
    formatParticipant,
    handleCopyShareLink,
    handleCommentSubmit,
    handleEvidenceSubmit,
    refreshAll
  };
}
