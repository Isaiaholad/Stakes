import { useEffect } from 'react';
import { getActiveProvider } from '../lib/wallet.js';
import { useWalletStore } from '../store/useWalletStore.js';

export function useWalletBootstrap() {
  const bootstrap = useWalletStore((state) => state.bootstrap);
  const refreshWallet = useWalletStore((state) => state.refreshWallet);
  const connector = useWalletStore((state) => state.connector);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const provider = getActiveProvider();

    if (!provider?.on) {
      return undefined;
    }

    const handleAccountsChanged = () => refreshWallet();
    const handleChainChanged = () => refreshWallet();
    const handleDisconnect = () => refreshWallet();

    provider.on('accountsChanged', handleAccountsChanged);
    provider.on('chainChanged', handleChainChanged);
    provider.on?.('disconnect', handleDisconnect);

    return () => {
      provider.removeListener?.('accountsChanged', handleAccountsChanged);
      provider.removeListener?.('chainChanged', handleChainChanged);
      provider.removeListener?.('disconnect', handleDisconnect);
    };
  }, [connector, refreshWallet]);
}
