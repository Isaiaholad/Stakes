import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePrivy } from '@privy-io/react-auth';
import { zeroAddress } from 'viem';
import { analyzePactEvidence, readPactEvidenceHistory, uploadManagedEvidence, validateManagedEvidenceFile } from '../../lib/evidence.js';
import { readWalletSession } from '../../lib/authSession.js';
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
import { buildPactPath, parsePactPublicId } from '../../lib/pactIds.js';
import { buildTransactionToast } from '../../lib/transactions.js';
import { useNow } from '../../hooks/useNow.js';
import { useProtocolReadiness } from '../../hooks/useProtocolReadiness.js';
import { useToastStore } from '../../store/useToastStore.js';
import {
  formatParticipantLabel,
  getFinalResultStatus,
  getParticipantBadge
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

  if (/sign in with privy before (posting to pact chat|uploading or posting a comment)|sign a wallet message before posting to pact chat/i.test(rawMessage)) {
    return 'Verify this wallet once, then post again. Chat uses the same wallet identity as your pact.';
  }

  if (/wallet session could not be saved on this device/i.test(rawMessage)) {
    return 'This browser did not keep the chat session. Verify this wallet again, then post once more.';
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

function isImageEvidence(item) {
  const uri = String(item?.url || item?.evidence_uri || item?.evidenceUri || '').trim();
  const mimeType = String(item?.mimeType || item?.mime_type || '').toLowerCase();
  return (
    mimeType.startsWith('image/') ||
    /^data:image\/[a-z0-9.+-]+;base64,/i.test(uri) ||
    /\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(uri)
  );
}

export function usePactDetailPage(id, address) {
  const showToast = useToastStore((state) => state.showToast);
  const queryClient = useQueryClient();
  const { ready: privyReady, authenticated: privyAuthenticated, login: loginWithPrivy } = usePrivy();
  const pactId = parsePactPublicId(id);
  const invalidPactId = !pactId;
  const [resolutionRef, setResolutionRef] = useState('manual-review');
  const [disputeEvidenceDraft, setDisputeEvidenceDraft] = useState('');
  const [pendingEvidenceFile, setPendingEvidenceFile] = useState(null);
  const [evidenceUploads, setEvidenceUploads] = useState([]);
  const [commentDraft, setCommentDraft] = useState('');
  const configured = isProtocolConfigured();
  const readiness = useProtocolReadiness();
  const readsEnabled = configured && !invalidPactId;
  const usernameRegistryConfigured = hasUsernameRegistryConfigured();
  const catboxUploadConfigured = true;
  const maxCommentLength = getMaxPactCommentLength();
  const now = useNow(15_000);
  const shouldAvoidChainFallback = readiness.data?.contractsConfigured === false;

  const pactQuery = useQuery({
    queryKey: ['pact', pactId, address],
    queryFn: () =>
      readPactById(pactId, address, {
        preferIndexed: readiness.canRead || shouldAvoidChainFallback,
        skipChainFallback: shouldAvoidChainFallback
      }),
    enabled: readsEnabled,
    refetchInterval: 15_000,
    retry: false
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
    queryKey: ['pact-messages', pactId, address],
    queryFn: () => readPactCommentThread(pactId, address),
    enabled: readsEnabled,
    refetchInterval: 15_000
  });

  const walletSessionQuery = useQuery({
    queryKey: ['wallet-session', address, privyAuthenticated],
    queryFn: readWalletSession,
    enabled: Boolean(address),
    staleTime: 15_000,
    refetchInterval: 60_000,
    retry: false
  });

  const evidenceHistoryQuery = useQuery({
    queryKey: ['pact-evidence', pactId, address],
    queryFn: () => readPactEvidenceHistory(pactId, address),
    enabled: readsEnabled,
    refetchInterval: 15_000
  });

  const disputeOpenedAtQuery = useQuery({
    queryKey: ['pact-dispute-opened-at', pactId],
    queryFn: () => readDisputeOpenedAt(pactId),
    enabled: readsEnabled && Boolean(address) && pactQuery.data?.rawStatus === 'Disputed',
    staleTime: 15_000,
    refetchInterval: 15_000
  });

  const refreshAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['pacts'] }),
      queryClient.invalidateQueries({ queryKey: ['explore-pacts'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-pacts'] }),
      queryClient.invalidateQueries({ queryKey: ['pact', pactId, address] }),
      queryClient.invalidateQueries({ queryKey: ['vault', address] }),
      queryClient.invalidateQueries({ queryKey: ['pact-messages', pactId, address] }),
      queryClient.invalidateQueries({ queryKey: ['pact-evidence', pactId, address] })
    ]);
  };

  const createMutationHandlers = (successTitle, errorTitle) => ({
    onSuccess: async (receipt) => {
      await refreshAll();
      showToast({
        variant: 'success',
        title: successTitle,
        ...buildTransactionToast(receipt)
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
    mutationFn: async (username) => {
      if (!address) {
        throw new Error('Connect your wallet to join this pact.');
      }

      if (!vaultQuery.data) {
        throw new Error('Vault balance is still loading. Try joining again in a moment.');
      }

      if (joinBalanceError) {
        throw new Error(joinBalanceError);
      }

      const res = await joinPact(address, pactId);

      if (username && typeof username === 'string' && username.trim()) {
        try {
          await appendPactComment({
            pactId,
            address,
            message: `Counterparty's in-game username: ${username.trim()}`
          });
        } catch(e) {
          console.error('Failed to post username comment', e);
        }
      }

      return res;
    },
    ...createMutationHandlers('Pact joined', 'Join failed')
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelPact(address, pactId),
    ...createMutationHandlers('Pact cancelled', 'Cancel failed')
  });

  const cancelExpiredMutation = useMutation({
    mutationFn: () => cancelExpiredPact(address, pactId),
    ...createMutationHandlers('Expired pact cancelled', 'Cancel expired failed')
  });

  const declareMutation = useMutation({
    mutationFn: (winner) => submitWinner(address, pactId, winner),
    ...createMutationHandlers('Declaration submitted', 'Declaration failed')
  });

  const singleDeclarationDisputeMutation = useMutation({
    mutationFn: () => openUnansweredDeclarationDispute(address, pactId),
    ...createMutationHandlers('Dispute opened', 'Dispute failed')
  });

  const mismatchDisputeMutation = useMutation({
    mutationFn: () => openMismatchDispute(address, pactId),
    ...createMutationHandlers('Dispute opened', 'Dispute failed')
  });

  const settleMutation = useMutation({
    mutationFn: () => settleAfterDeclarationWindow(address, pactId),
    ...createMutationHandlers('Declaration window settled', 'Settlement failed')
  });

  const disputeEvidenceMutation = useMutation({
    mutationFn: () => {
      const linksSection = evidenceUploads
        .filter((item) => item.status === 'uploaded' && item.url)
        .map((item) => item.url)
        .concat(currentUserStoredEvidenceLinks)
        .filter((value, index, values) => value && values.indexOf(value) === index)
        .join('\n');
      const payload = [disputeEvidenceDraft.trim(), linksSection ? `File links:\n${linksSection}` : '']
        .filter(Boolean)
        .join('\n\n');
      return submitDisputeEvidence(address, pactId, payload);
    },
    onSuccess: async (receipt) => {
      setDisputeEvidenceDraft('');
      setPendingEvidenceFile(null);
      setEvidenceUploads([]);
      await refreshAll();
      showToast({
        variant: 'success',
        title: 'Dispute proof submitted',
        ...buildTransactionToast(receipt, {
          message: 'Your proof has been attached to this dispute on-chain.'
        })
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
        pactId,
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
        message: `${result.name} was added to this pact.`
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
        message: error?.message || 'Could not upload this file.'
      });
    }
  });

  const handlePendingEvidenceFileChange = (file) => {
    if (!file) {
      setPendingEvidenceFile(null);
      return;
    }

    try {
      validateManagedEvidenceFile(file);
      setPendingEvidenceFile(file);
    } catch (error) {
      setPendingEvidenceFile(null);
      showToast({
        variant: 'error',
        title: 'File not allowed',
        message: error?.message || 'Choose a smaller image or video.'
      });
    }
  };

  const resolveWinnerMutation = useMutation({
    mutationFn: (winner) => adminResolveWinner(address, pactId, winner, resolutionRef),
    ...createMutationHandlers('Winner resolved', 'Resolution failed')
  });

  const analyzeEfootballResultMutation = useMutation({
    mutationFn: async () => {
      const result = await analyzePactEvidence({
        pactId,
        address
      });
      const winner = String(result?.winnerAddress || result?.winner || '').trim();
      if (
        !winner ||
        winner === zeroAddress ||
        ![pactQuery.data?.creator?.toLowerCase(), pactQuery.data?.counterparty?.toLowerCase()].includes(
          winner.toLowerCase()
        )
      ) {
        throw new Error('AI could not confidently match the screenshot winner to either pact participant.');
      }

      const receipt = await submitWinner(address, pactId, winner);
      return {
        result,
        receipt
      };
    },
    onSuccess: async ({ result, receipt }) => {
      await refreshAll();
      const analysis = result?.analysis || {};
      showToast({
        variant: 'success',
        title: 'AI result submitted',
        ...buildTransactionToast(receipt, {
          message: analysis.winnerUsername || analysis.explanation
            ? `${analysis.winnerUsername || 'Winner'} detected as the winner.`
            : 'AI submitted the detected winner on-chain.'
        })
      });
    },
    onError: (error) => {
      showToast({
        variant: 'error',
        title: 'AI result failed',
        message: error?.message || 'Could not analyze the screenshot and submit the result.'
      });
    }
  });

  const resolveSplitMutation = useMutation({
    mutationFn: () => adminResolveSplit(address, pactId, 5000, resolutionRef),
    ...createMutationHandlers('Split resolved', 'Resolution failed')
  });

  const forceDisputeSplitMutation = useMutation({
    mutationFn: () => forceSplitAfterDisputeTimeout(address, pactId),
    ...createMutationHandlers('Dispute split forced', 'Split fallback failed')
  });

  const postCommentMutation = useMutation({
    mutationFn: async () => {
      if (!address) {
        throw new Error('Connect your wallet to post in pact chat.');
      }

      return appendPactComment({
        pactId: pactQuery.data?.id || pactId,
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
  }, [pactQuery.data?.currentUserOnChainEvidence, pactQuery.data?.id]);

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
        Boolean(rawPact.hasOnChainDisputeEvidence),
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
  const shareUrl = typeof window !== 'undefined' && pact ? `${window.location.origin}${buildPactPath(pact.id)}` : '';
  const comments = commentsQuery.data?.messages || [];
  const requiresParticipantAccess = Boolean(commentsQuery.data?.requiresParticipantAccess);
  const evidenceHistory = evidenceHistoryQuery.data || [];
  const currentUserStoredEvidenceLinks = evidenceHistory
    .filter((item) => {
      const evidenceUri = String(item?.evidence_uri || item?.evidenceUri || '').trim();
      const participantAddress = String(item?.participant_address || item?.participantAddress || '').toLowerCase();
      const txHash = String(item?.tx_hash || item?.txHash || '').trim();
      return (
        Boolean(evidenceUri) &&
        Boolean(address) &&
        participantAddress === address.toLowerCase() &&
        !txHash
      );
    })
    .map((item) => String(item.evidence_uri || item.evidenceUri || '').trim())
    .filter((value, index, values) => value && values.indexOf(value) === index);
  const efootballEvidenceReady = Boolean(
    pact?.eventType === 'eFootball' &&
      (evidenceUploads.some((item) => item.status === 'uploaded' && isImageEvidence(item)) ||
        evidenceHistory.some(
          (item) =>
            isImageEvidence(item) &&
            (!address || String(item.participant_address || item.participantAddress || '').toLowerCase() === address.toLowerCase())
        ))
  );
  const canCurrentWalletChat =
    Boolean(address) && Boolean(pact?.participantRole !== 'viewer' || protocol?.isArbiter || protocol?.isAdmin);
  const hasVerifiedWalletSession =
    Boolean(walletSessionQuery.data?.authenticated) &&
    Boolean(address) &&
    String(walletSessionQuery.data?.address || '').toLowerCase() === address.toLowerCase();
  const chatAuthenticated = Boolean(privyAuthenticated || hasVerifiedWalletSession);
  const chatAccessMessage = !address
    ? 'Connect a wallet to join the shared pact chat.'
    : canCurrentWalletChat && !chatAuthenticated
      ? 'Post with your connected wallet. If this browser needs verification, you will sign one gas-free message.'
    : pact?.isOpen && pact?.participantRole === 'creator'
        ? 'Only the creator can comment until a counterparty joins and reserves stake.'
        : !canCurrentWalletChat
          ? 'Only the creator, joined counterparty, or an arbiter can post in this thread.'
        : hasVerifiedWalletSession
          ? 'Chat is ready. This browser already has a verified session for your connected wallet.'
          : 'Chat is ready for the joined pact participants.';

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
        label: 'Settle no-result split',
        helper: 'No result screenshot was uploaded before the deadline, so either joined participant can close this pact into a split payout.'
      };
    }

    if (creatorSubmitted !== counterpartySubmitted) {
      return {
        label: 'Settle uncontested result',
        helper: 'The timeout and grace period are over, so the only submitted result can now settle.'
      };
    }

    if (pact.bothSubmitted && !pact.declarationsMatch) {
      return {
        label: 'Retry automatic dispute opening',
        helper: 'Both sides submitted different results, so the pact now moves into the on-chain dispute flow.'
      };
    }

    return {
      label: 'Settle ready result',
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
    if (!disputeEvidenceDraft.trim() && !uploadedLinks.length && !currentUserStoredEvidenceLinks.length) {
      return;
    }

    disputeEvidenceMutation.mutate();
  };

  return {
    configured,
    readiness,
    readsEnabled,
    invalidPactId,
    pactId,
    usernameRegistryConfigured,
    catboxUploadConfigured,
    maxCommentLength,
    now,
    pactQuery,
    vaultQuery,
    creatorUsernameQuery,
    counterpartyUsernameQuery,
    commentsQuery,
    walletSessionQuery,
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
    privyReady,
    privyAuthenticated,
    chatAuthenticated,
    loginWithPrivy,
    evidenceHistory,
    currentUserStoredEvidenceLinks,
    resolutionRef,
    setResolutionRef,
    disputeEvidenceDraft,
    setDisputeEvidenceDraft,
    pendingEvidenceFile,
    setPendingEvidenceFile: handlePendingEvidenceFileChange,
    evidenceUploads,
    efootballEvidenceReady,
    setEvidenceUploads,
    commentDraft,
    setCommentDraft,
    joinBalanceError,
    joinMutation,
    cancelMutation,
    cancelExpiredMutation,
    declareMutation,
    analyzeEfootballResultMutation,
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
