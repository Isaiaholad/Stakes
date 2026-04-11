import { useMemo, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminResolveSplit,
  adminResolveWinner,
  openMismatchDispute,
  readAdminQueue,
  readDisputeOpenedAt,
  readProtocolSnapshot,
  settleAfterDeclarationWindow
} from '../../lib/pacts.js';
import { isProtocolConfigured } from '../../lib/contracts.js';
import { useNow } from '../../hooks/useNow.js';
import { useToastStore } from '../../store/useToastStore.js';
import { useWalletStore } from '../../store/useWalletStore.js';
import { adminPactLimit, disputeTimeoutMs, getEscrowExposure, matchesAdminSearch, partitionPacts } from './adminPageUtils.js';

export function useAdminPage() {
  const address = useWalletStore((state) => state.address);
  const configured = isProtocolConfigured();
  const [searchValue, setSearchValue] = useState('');
  const [resolutionRefs, setResolutionRefs] = useState({});
  const showToast = useToastStore((state) => state.showToast);
  const queryClient = useQueryClient();
  const now = useNow(15_000);

  const protocolQuery = useQuery({
    queryKey: ['admin-role', address],
    queryFn: () => readProtocolSnapshot(address),
    enabled: configured && Boolean(address),
    refetchInterval: 60_000
  });
  const hasAdminAccess = Boolean(protocolQuery.data?.isAdmin || protocolQuery.data?.isArbiter);

  const pactsQuery = useQuery({
    queryKey: ['admin-pacts', address, adminPactLimit],
    queryFn: () =>
      readAdminQueue(address, {
        limit: adminPactLimit,
        preferIndexed: true
      }),
    enabled: configured && Boolean(address) && hasAdminAccess,
    refetchInterval: 30_000
  });

  const protocol = pactsQuery.data?.protocol || protocolQuery.data || { paused: false, isAdmin: false, isArbiter: false };
  const hasPactData = Boolean(pactsQuery.data?.pacts);
  const hasProtocolData = Boolean(protocolQuery.data || pactsQuery.data?.protocol);
  const pacts = pactsQuery.data?.pacts || [];

  const searchedPacts = useMemo(() => pacts.filter((pact) => matchesAdminSearch(pact, searchValue)), [pacts, searchValue]);
  const groups = useMemo(() => partitionPacts(searchedPacts), [searchedPacts]);
  const disputeOpenedAtQueries = useQueries({
    queries: groups.disputes
      .filter((pact) => pact.rawStatus === 'Disputed')
      .map((pact) => ({
        queryKey: ['admin-dispute-opened-at', pact.id],
        queryFn: () => readDisputeOpenedAt(pact.id),
        enabled: configured && hasAdminAccess,
        staleTime: 15_000,
        refetchInterval: 15_000
      }))
  });
  const disputeOpenedAtByPactId = useMemo(() => {
    const entries = groups.disputes
      .filter((pact) => pact.rawStatus === 'Disputed')
      .map((pact, index) => [pact.id, Number(disputeOpenedAtQueries[index]?.data || 0)]);

    return new Map(entries);
  }, [disputeOpenedAtQueries, groups.disputes]);
  const unresolvedPacts = useMemo(
    () => searchedPacts.filter((pact) => !['Resolved', 'Cancelled'].includes(pact.rawStatus)),
    [searchedPacts]
  );
  const protocolExposure = useMemo(() => searchedPacts.reduce((total, pact) => total + getEscrowExposure(pact), 0), [searchedPacts]);
  const disputedPacts = groups.disputes.filter((pact) => pact.rawStatus === 'Disputed');
  const creatorProofCount = disputedPacts.filter((pact) => Boolean(pact.creatorEvidence?.trim())).length;
  const counterpartyProofCount = disputedPacts.filter((pact) => Boolean(pact.counterpartyEvidence?.trim())).length;
  const stageCounts = useMemo(() => {
    const counts = new Map();

    for (const pact of searchedPacts) {
      counts.set(pact.stage, Number(counts.get(pact.stage) || 0) + 1);
    }

    return Array.from(counts.entries()).sort((left, right) => right[1] - left[1]);
  }, [searchedPacts]);

  const refreshAdminData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin-pacts'] }),
      queryClient.invalidateQueries({ queryKey: ['pact'] }),
      queryClient.invalidateQueries({ queryKey: ['pacts'] }),
      queryClient.invalidateQueries({ queryKey: ['explore-pacts'] })
    ]);
  };

  const createMutationHandlers = (successTitle, errorTitle) => ({
    onSuccess: async () => {
      await refreshAdminData();
      showToast({
        variant: 'success',
        title: successTitle,
        message: 'The on-chain action was confirmed.'
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

  const settleMutation = useMutation({
    mutationFn: ({ pactId }) => settleAfterDeclarationWindow(address, pactId),
    ...createMutationHandlers('Outcome settled', 'Settlement failed')
  });

  const mismatchDisputeMutation = useMutation({
    mutationFn: ({ pactId }) => openMismatchDispute(address, pactId),
    ...createMutationHandlers('Dispute opened', 'Dispute failed')
  });

  const resolveWinnerMutation = useMutation({
    mutationFn: ({ pactId, winner }) => adminResolveWinner(address, pactId, winner, resolutionRefs[pactId] || 'admin-dashboard'),
    ...createMutationHandlers('Winner resolved', 'Resolution failed')
  });

  const resolveSplitMutation = useMutation({
    mutationFn: ({ pactId }) => adminResolveSplit(address, pactId, 5000, resolutionRefs[pactId] || 'admin-dashboard'),
    ...createMutationHandlers('Split resolved', 'Resolution failed')
  });

  const setResolutionRefForPact = (pactId, value) => {
    setResolutionRefs((current) => ({
      ...current,
      [pactId]: value
    }));
  };

  const getDisputeTiming = (pactId, pact) => {
    const creatorHasEvidence = Boolean(pact.creatorEvidence?.trim());
    const counterpartyHasEvidence = Boolean(pact.counterpartyEvidence?.trim());
    const disputeOpenedAt = disputeOpenedAtByPactId.get(pactId) || 0;
    const disputeTimeoutAt = disputeOpenedAt > 0 ? new Date(disputeOpenedAt * 1000 + disputeTimeoutMs).toISOString() : null;
    const adminReviewReady =
      pact.rawStatus === 'Disputed' && (creatorHasEvidence || counterpartyHasEvidence);

    return {
      creatorHasEvidence,
      counterpartyHasEvidence,
      disputeTimeoutAt,
      adminReviewReady
    };
  };

  return {
    address,
    configured,
    searchValue,
    setSearchValue,
    protocolQuery,
    pactsQuery,
    protocol,
    hasAdminAccess,
    hasPactData,
    hasProtocolData,
    searchedPacts,
    groups,
    unresolvedPacts,
    protocolExposure,
    disputedPacts,
    creatorProofCount,
    counterpartyProofCount,
    stageCounts,
    settleMutation,
    mismatchDisputeMutation,
    resolveWinnerMutation,
    resolveSplitMutation,
    resolutionRefs,
    setResolutionRefForPact,
    getDisputeTiming
  };
}
