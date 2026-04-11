import { create } from 'zustand';
import {
  clearActiveProvider,
  disconnectWalletConnectProvider,
  getActiveConnector,
  getActiveProvider,
  getInjectedProvider,
  getWalletConnectProvider,
  hasWalletConnectConfigured,
  normalizeChainId,
  requestWalletConnection,
  setActiveProvider,
  switchToSupportedChain
} from '../lib/wallet.js';

const disconnectStorageKey = 'stakewithfriends.wallet_disconnected';

function readManualDisconnectPreference() {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.localStorage.getItem(disconnectStorageKey) === 'true';
}

function writeManualDisconnectPreference(value) {
  if (typeof window === 'undefined') {
    return;
  }

  if (value) {
    window.localStorage.setItem(disconnectStorageKey, 'true');
  } else {
    window.localStorage.removeItem(disconnectStorageKey);
  }
}

export const useWalletStore = create((set, get) => ({
  address: null,
  chainId: null,
  providerReady: false,
  injectedReady: false,
  walletConnectReady: false,
  connector: null,
  status: 'idle',
  error: '',
  setWalletState: (payload) => set(payload),
  clearWallet: () =>
    set({
      address: null,
      chainId: null,
      connector: null,
      status: 'idle',
      error: ''
    }),
  disconnect: async () => {
    writeManualDisconnectPreference(true);
    if (get().connector === 'walletconnect') {
      await disconnectWalletConnectProvider();
    } else {
      clearActiveProvider();
    }
    set({
      address: null,
      chainId: null,
      connector: null,
      status: 'idle',
      error: ''
    });
  },
  bootstrap: async () => {
    const provider = getInjectedProvider();
    const walletConnectReady = hasWalletConnectConfigured();
    set({
      providerReady: Boolean(provider || walletConnectReady),
      injectedReady: Boolean(provider),
      walletConnectReady
    });

    if (readManualDisconnectPreference()) {
      clearActiveProvider();
      set({
        address: null,
        chainId: null,
        connector: null,
        providerReady: Boolean(provider || walletConnectReady),
        injectedReady: Boolean(provider),
        walletConnectReady,
        status: 'idle',
        error: ''
      });
      return;
    }

    let activeProvider = null;
    let connector = getActiveConnector();

    if (connector) {
      activeProvider = getActiveProvider();
    }

    if (!activeProvider && provider) {
      const accounts = await provider.request({ method: 'eth_accounts' }).catch(() => []);
      if (accounts?.[0]) {
        activeProvider = provider;
        connector = 'injected';
        setActiveProvider(provider, connector);
      }
    }

    if (!activeProvider && walletConnectReady) {
      const walletConnectProvider = await getWalletConnectProvider().catch(() => null);
      const accounts = walletConnectProvider
        ? await walletConnectProvider.request({ method: 'eth_accounts' }).catch(() => [])
        : [];

      if (accounts?.[0]) {
        activeProvider = walletConnectProvider;
        connector = 'walletconnect';
        setActiveProvider(walletConnectProvider, connector);
      }
    }

    if (!activeProvider) {
      set({
        address: null,
        chainId: null,
        connector: null,
        providerReady: Boolean(provider || walletConnectReady),
        injectedReady: Boolean(provider),
        walletConnectReady,
        status: 'idle',
        error: ''
      });
      return;
    }

    const [accounts, chainId] = await Promise.all([
      activeProvider.request({ method: 'eth_accounts' }).catch(() => []),
      activeProvider.request({ method: 'eth_chainId' }).catch(() => null)
    ]);

    set({
      address: accounts?.[0] || null,
      chainId: normalizeChainId(chainId),
      connector: accounts?.[0] ? connector : null,
      providerReady: Boolean(provider || walletConnectReady),
      injectedReady: Boolean(provider),
      walletConnectReady,
      status: accounts?.[0] ? 'connected' : 'idle',
      error: ''
    });
  },
  connectInjected: async () => {
    try {
      set({ status: 'connecting', error: '', connector: 'injected' });
      const provider = getInjectedProvider();

      if (!provider) {
        throw new Error('No browser wallet found. Install MetaMask, Coinbase Wallet, or use WalletConnect.');
      }

      await switchToSupportedChain(provider);
      const connection = await requestWalletConnection(provider);
      writeManualDisconnectPreference(false);
      setActiveProvider(provider, 'injected');

      set({
        address: connection.address,
        chainId: connection.chainId,
        providerReady: true,
        injectedReady: true,
        walletConnectReady: hasWalletConnectConfigured(),
        connector: 'injected',
        status: 'connected'
      });
    } catch (error) {
      set({
        connector: null,
        status: 'idle',
        error: error.message || 'Wallet connection failed.'
      });
    }
  },
  connectWalletConnect: async () => {
    try {
      set({ status: 'connecting', error: '', connector: 'walletconnect' });
      const provider = await getWalletConnectProvider();
      const connection = await requestWalletConnection(provider);
      await switchToSupportedChain(provider);
      writeManualDisconnectPreference(false);
      setActiveProvider(provider, 'walletconnect');

      set({
        address: connection.address,
        chainId: supportedChainIdFallback(connection.chainId),
        providerReady: true,
        injectedReady: Boolean(getInjectedProvider()),
        walletConnectReady: true,
        connector: 'walletconnect',
        status: 'connected',
        error: ''
      });
    } catch (error) {
      set({
        connector: null,
        status: 'idle',
        error: error.message || 'WalletConnect failed.'
      });
    }
  },
  connect: async () => {
    if (getInjectedProvider()) {
      return get().connectInjected();
    }

    if (hasWalletConnectConfigured()) {
      return get().connectWalletConnect();
    }

    set({
      status: 'idle',
      error: 'No wallet connection method is configured. Add an injected wallet or set `VITE_WALLETCONNECT_PROJECT_ID`.'
    });
  },
  refreshWallet: async () => {
    const provider = getActiveProvider() || getInjectedProvider();
    if (!provider) {
      return get().clearWallet();
    }

    if (readManualDisconnectPreference()) {
      clearActiveProvider();
      return set({
        address: null,
        chainId: null,
        connector: null,
        providerReady: Boolean(getInjectedProvider() || hasWalletConnectConfigured()),
        injectedReady: Boolean(getInjectedProvider()),
        walletConnectReady: hasWalletConnectConfigured(),
        status: 'idle',
        error: ''
      });
    }

    const [accounts, chainId] = await Promise.all([
      provider.request({ method: 'eth_accounts' }).catch(() => []),
      provider.request({ method: 'eth_chainId' }).catch(() => null)
    ]);

    set({
      address: accounts?.[0] || null,
      chainId: normalizeChainId(chainId),
      connector: accounts?.[0] ? getActiveConnector() || (provider === getInjectedProvider() ? 'injected' : 'walletconnect') : null,
      providerReady: Boolean(getInjectedProvider() || hasWalletConnectConfigured()),
      injectedReady: Boolean(getInjectedProvider()),
      walletConnectReady: hasWalletConnectConfigured(),
      status: accounts?.[0] ? 'connected' : 'idle',
      error: ''
    });
  }
}));

function supportedChainIdFallback(chainId) {
  const normalized = normalizeChainId(chainId);
  return normalized ?? null;
}
