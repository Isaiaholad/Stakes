import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '../lib/api.js';
import { isProtocolConfigured } from '../lib/contracts.js';

function getCoreSync(data) {
  return data?.sync?.find((entry) => entry.key === 'core' && entry.required);
}

function canServeIndexedReads(query) {
  if (!isProtocolConfigured()) {
    return false;
  }

  if ((query.isLoading || query.error) && !query.data) {
    return false;
  }

  if (!query.data) {
    return false;
  }

  if (!query.data.contractsConfigured || !query.data.databaseOk || !query.data.storageOk) {
    return false;
  }

  if (query.data.readModelAvailable) {
    return true;
  }

  const coreSync = getCoreSync(query.data);
  if (!coreSync || coreSync.status === 'error') {
    return false;
  }

  return Number(coreSync.lastBlockNumber || 0) >= Number(coreSync.startBlock || 0);
}

function getSummary(query) {
  if (!isProtocolConfigured()) {
    return '';
  }

  if (query.isLoading && !query.data) {
    return 'Checking API health, database access, and indexer sync before loading live pact data.';
  }

  if (query.error && !query.data) {
    return 'The app could not reach the indexed API yet. Start the API service and its indexer worker, then try again.';
  }

  if (!query.data?.contractsConfigured) {
    return 'The API is missing one or more deployed contract addresses.';
  }

  if (!query.data?.databaseOk) {
    return 'The API database is unavailable right now.';
  }

  if (!query.data?.indexerOk) {
    const lag = Number(query.data?.syncLagBlocks || 0);
    const canRead = canServeIndexedReads(query);
    if (canRead) {
      return lag
        ? `The indexed API is serving delayed reads while the core sync catches up with Monad testnet and is ${lag} blocks behind.`
        : 'The indexed API is serving delayed reads while the core sync finishes warming up.';
    }

    return lag ? `The API indexer is still catching up with Monad testnet and is ${lag} blocks behind.` : 'The API indexer is still warming up.';
  }

  if (!query.data?.storageOk) {
    return 'Evidence metadata storage is not configured yet.';
  }

  const lag = Number(query.data?.syncLagBlocks || 0);
  if (lag > 0 && canServeIndexedReads(query)) {
    return `Live indexed reads are available while the core sync trails Monad testnet by ${lag} blocks. Fresh feed updates can take a moment to appear on a fast chain.`;
  }

  return '';
}

export function useProtocolReadiness() {
  const configured = isProtocolConfigured();
  const query = useQuery({
    queryKey: ['startup-health'],
    queryFn: () => fetchJson('/health/startup'),
    enabled: configured,
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 1
  });

  return {
    ...query,
    canRead: Boolean(configured && canServeIndexedReads(query)),
    isLagging: Boolean(Number(query.data?.syncLagBlocks || 0) > 0),
    isReady: Boolean(configured && query.data?.ready),
    summary: getSummary(query)
  };
}
