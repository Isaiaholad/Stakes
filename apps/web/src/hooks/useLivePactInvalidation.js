import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { pactManagerAbi, pactResolutionManagerAbi, submissionManagerAbi, usernameRegistryAbi } from '../lib/abis.js';
import { hasUsernameRegistryConfigured, isProtocolConfigured, protocolConfig } from '../lib/contracts.js';
import { getPublicClient } from '../lib/pacts.js';

const liveRefreshDebounceMs = 750;

export function useLivePactInvalidation() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isProtocolConfigured()) {
      return undefined;
    }

    const client = getPublicClient();
    let refreshTimer = null;

    const schedulePactRefresh = () => {
      if (refreshTimer) {
        return;
      }

      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: ['pacts'] }),
          queryClient.invalidateQueries({ queryKey: ['explore-pacts'] }),
          queryClient.invalidateQueries({ queryKey: ['admin-pacts'] }),
          queryClient.invalidateQueries({ queryKey: ['pact'] }),
          queryClient.invalidateQueries({ queryKey: ['vault'] }),
          queryClient.invalidateQueries({ queryKey: ['startup-health'] }),
          queryClient.invalidateQueries({ queryKey: ['pact-evidence'] })
        ]);
      }, liveRefreshDebounceMs);
    };

    const scheduleUsernameRefresh = () => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['username'] }),
        queryClient.invalidateQueries({ queryKey: ['username-lookup'] }),
        queryClient.invalidateQueries({ queryKey: ['pacts'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-pacts'] }),
        queryClient.invalidateQueries({ queryKey: ['pact'] })
      ]);
    };

    const unwatchers = [
      client.watchContractEvent({
        address: protocolConfig.addresses.pactManager,
        abi: pactManagerAbi,
        onLogs: (logs) => {
          if (logs.length) {
            schedulePactRefresh();
          }
        }
      }),
      client.watchContractEvent({
        address: protocolConfig.addresses.submissionManager,
        abi: submissionManagerAbi,
        onLogs: (logs) => {
          if (logs.length) {
            schedulePactRefresh();
          }
        }
      }),
      client.watchContractEvent({
        address: protocolConfig.addresses.pactResolutionManager,
        abi: pactResolutionManagerAbi,
        onLogs: (logs) => {
          if (logs.length) {
            schedulePactRefresh();
          }
        }
      })
    ];

    if (hasUsernameRegistryConfigured()) {
      unwatchers.push(
        client.watchContractEvent({
          address: protocolConfig.addresses.usernameRegistry,
          abi: usernameRegistryAbi,
          onLogs: (logs) => {
            if (logs.length) {
              scheduleUsernameRefresh();
            }
          }
        })
      );
    }

    return () => {
      if (refreshTimer) {
        window.clearTimeout(refreshTimer);
      }

      for (const unwatch of unwatchers) {
        try {
          unwatch?.();
        } catch {
          // Ignore cleanup failures while the app unmounts or swaps chains.
        }
      }
    };
  }, [queryClient]);
}
