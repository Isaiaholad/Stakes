import { useEffect } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { normalizeChainId, setActiveProvider, clearActiveProvider } from '../lib/wallet.js';
import { useWalletStore } from '../store/useWalletStore.js';

function parsePrivyChainId(chainId) {
  const rawValue = String(chainId || '');
  if (rawValue.includes(':')) {
    return Number(rawValue.split(':').pop());
  }
  return normalizeChainId(rawValue);
}

export default function PrivyWalletBridge() {
  const { ready, authenticated } = usePrivy();
  const { wallets } = useWallets();

  useEffect(() => {
    let cancelled = false;

    async function syncPrivyWallet() {
      if (!ready || !authenticated) {
        if (useWalletStore.getState().connector === 'privy') {
          clearActiveProvider();
          useWalletStore.getState().clearWallet();
        }
        return;
      }

      const wallet = wallets.find((item) => item.address) || wallets[0];
      if (!wallet?.address || !wallet.getEthereumProvider) {
        return;
      }

      const provider = await wallet.getEthereumProvider();
      if (cancelled) {
        return;
      }

      setActiveProvider(provider, 'privy');
      useWalletStore.getState().setWalletState({
        address: wallet.address,
        chainId: parsePrivyChainId(wallet.chainId),
        providerReady: true,
        connector: 'privy',
        status: 'connected',
        error: ''
      });
    }

    syncPrivyWallet().catch((error) => {
      useWalletStore.getState().setWalletState({
        error: error?.message || 'Privy wallet connection failed.'
      });
    });

    return () => {
      cancelled = true;
    };
  }, [authenticated, ready, wallets]);

  return null;
}
