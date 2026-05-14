import { createWalletClient, custom } from 'viem';
import { supportedChain, supportedChainParams, walletRpcUrl } from './chains.js';

const walletConnectProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || '';

let activeProvider = null;
let activeConnector = null;
let walletConnectProviderPromise = null;

export function getInjectedProvider() {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.ethereum || null;
}

export function hasWalletConnectConfigured() {
  return Boolean(walletConnectProjectId);
}

export function getActiveConnector() {
  return activeConnector;
}

export function setActiveProvider(provider, connector) {
  activeProvider = provider || null;
  activeConnector = connector || null;
}

export function clearActiveProvider() {
  activeProvider = null;
  activeConnector = null;
}

export function getActiveProvider() {
  return activeProvider || getInjectedProvider() || null;
}

export async function getWalletConnectProvider() {
  if (!hasWalletConnectConfigured()) {
    throw new Error('WalletConnect needs `VITE_WALLETCONNECT_PROJECT_ID` before it can open a QR session.');
  }

  if (!walletConnectProviderPromise) {
    walletConnectProviderPromise = (async () => {
      const module = await import('@walletconnect/ethereum-provider');
      const EthereumProvider = module.default;
      const provider = await EthereumProvider.init({
        projectId: walletConnectProjectId,
        chains: [supportedChain.id],
        optionalChains: [supportedChain.id],
        rpcMap: {
          [supportedChain.id]: walletRpcUrl
        },
        showQrModal: true,
        methods: [
          'eth_sendTransaction',
          'personal_sign',
          'eth_signTypedData',
          'eth_signTypedData_v4',
          'wallet_switchEthereumChain',
          'wallet_addEthereumChain'
        ],
        events: ['chainChanged', 'accountsChanged', 'disconnect'],
        metadata: {
          name: 'StakeWithFriends',
          description: 'Head-to-head escrow pacts on Arc Testnet.',
          url: typeof window !== 'undefined' ? window.location.origin : 'https://stakewithfriends.local',
          icons:
            typeof window !== 'undefined'
              ? [`${window.location.origin}/icons/icon.svg`]
              : []
        }
      });

      provider.on?.('disconnect', () => {
        if (activeConnector === 'walletconnect') {
          clearActiveProvider();
        }
      });

      return provider;
    })();
  }

  return walletConnectProviderPromise;
}

export async function disconnectWalletConnectProvider() {
  if (!walletConnectProviderPromise) {
    clearActiveProvider();
    return;
  }

  const provider = await walletConnectProviderPromise.catch(() => null);
  await provider?.disconnect?.().catch(() => {});
  clearActiveProvider();
}

export function normalizeChainId(chainId) {
  if (!chainId) {
    return null;
  }

  return typeof chainId === 'string' ? Number.parseInt(chainId, 16) : Number(chainId);
}

function collectWalletErrorDetails(error, details = { codes: [], messages: [] }, visited = new Set()) {
  if (!error || typeof error !== 'object' || visited.has(error)) {
    return details;
  }

  visited.add(error);

  if ('code' in error) {
    details.codes.push(error.code);
  }

  if (typeof error.message === 'string') {
    details.messages.push(error.message);
  }

  collectWalletErrorDetails(error.data, details, visited);
  collectWalletErrorDetails(error.error, details, visited);
  collectWalletErrorDetails(error.originalError, details, visited);

  return details;
}

function isUnrecognizedChainError(error) {
  const details = collectWalletErrorDetails(error);
  const message = details.messages.join(' ').toLowerCase();
  return (
    details.codes.some((code) => Number(code) === 4902) ||
    /unrecognized chain|unknown chain|chain .*not( been)? added|add ethereum chain|wallet_addethereumchain/i.test(message)
  );
}

async function addSupportedChain(provider) {
  await provider.request({
    method: 'wallet_addEthereumChain',
    params: [supportedChainParams]
  });
}

async function requestSupportedChainSwitch(provider) {
  await provider.request({
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: supportedChainParams.chainId }]
  });
}

export async function switchToSupportedChain(provider = getActiveProvider()) {
  if (!provider) {
    throw new Error('No wallet provider is ready.');
  }

  const currentChainId = normalizeChainId(await provider.request({ method: 'eth_chainId' }));

  if (currentChainId === supportedChain.id) {
    return currentChainId;
  }

  try {
    await requestSupportedChainSwitch(provider);
  } catch (error) {
    if (isUnrecognizedChainError(error)) {
      await addSupportedChain(provider);
      const addedChainId = normalizeChainId(await provider.request({ method: 'eth_chainId' }).catch(() => null));
      if (addedChainId !== supportedChain.id) {
        await requestSupportedChainSwitch(provider);
      }
    } else {
      throw error;
    }
  }

  return supportedChain.id;
}

export async function requestWalletConnection(provider = getActiveProvider()) {
  if (!provider) {
    throw new Error('No wallet provider is ready.');
  }

  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  const chainId = normalizeChainId(await provider.request({ method: 'eth_chainId' }));

  return {
    address: accounts?.[0] || null,
    chainId
  };
}

export async function signWalletMessage(account, message, provider = getActiveProvider()) {
  if (!provider) {
    throw new Error('No wallet provider is ready.');
  }

  if (!account) {
    throw new Error('A connected wallet is required.');
  }

  return provider.request({
    method: 'personal_sign',
    params: [message, account]
  });
}

export function getWalletClient(account, provider = getActiveProvider()) {

  if (!provider) {
    throw new Error('No wallet provider is ready.');
  }

  return createWalletClient({
    account,
    chain: supportedChain,
    transport: custom(provider)
  });
}
