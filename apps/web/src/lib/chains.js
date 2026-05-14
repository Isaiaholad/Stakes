import { defineChain } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { protocolConfig } from './contracts.js';

const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: {
    name: 'USDC',
    symbol: 'USDC',
    decimals: 18
  },
  rpcUrls: {
    default: {
      http: [protocolConfig.rpcUrl]
    },
    public: {
      http: [protocolConfig.rpcUrl]
    }
  },
  blockExplorers: {
    default: {
      name: 'ArcScan',
      url: 'https://testnet.arcscan.app'
    }
  },
  testnet: true
});

const chainMap = {
  5042002: arcTestnet,
  8453: base,
  84532: baseSepolia
};

export const supportedChain = chainMap[protocolConfig.chainId] || arcTestnet;

function normalizeWalletRpcUrl(value) {
  if (!value) {
    return '';
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return /^https:\/\//i.test(trimmed) ? trimmed : '';
  }

  if (typeof value === 'object' && typeof value.url === 'string') {
    return normalizeWalletRpcUrl(value.url);
  }

  return '';
}

function resolveWalletRpcUrl(chain) {
  const candidates = [
    import.meta.env.VITE_WALLET_RPC_URL,
    import.meta.env.ARC_RPC_UPSTREAM_URL,
    import.meta.env.VITE_BASE_RPC_URL,
    protocolConfig.rpcUrl,
    ...(chain.rpcUrls?.default?.http || []),
    ...(chain.rpcUrls?.public?.http || []),
    'https://rpc.testnet.arc.network'
  ];

  return candidates.map(normalizeWalletRpcUrl).find(Boolean) || 'https://rpc.testnet.arc.network';
}

export const walletRpcUrl = resolveWalletRpcUrl(supportedChain);

export const walletSupportedChain = {
  ...supportedChain,
  rpcUrls: {
    ...supportedChain.rpcUrls,
    default: {
      ...supportedChain.rpcUrls?.default,
      http: [walletRpcUrl]
    },
    public: {
      ...supportedChain.rpcUrls?.public,
      http: [walletRpcUrl]
    }
  }
};

export const supportedChainParams = {
  chainId: `0x${walletSupportedChain.id.toString(16)}`,
  chainName: walletSupportedChain.name,
  nativeCurrency: walletSupportedChain.nativeCurrency,
  rpcUrls: [walletRpcUrl],
  blockExplorerUrls: walletSupportedChain.blockExplorers?.default?.url
    ? [walletSupportedChain.blockExplorers.default.url]
    : []
};
