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

function resolveWalletRpcUrl(chain) {
  return (
    import.meta.env.ARC_RPC_UPSTREAM_URL ||
    import.meta.env.VITE_BASE_RPC_URL ||
    (String(protocolConfig.rpcUrl || '').startsWith('http') ? protocolConfig.rpcUrl : '') ||
    chain.rpcUrls?.default?.http?.find((rpcUrl) => String(rpcUrl).startsWith('http')) ||
    'https://rpc.testnet.arc.network'
  );
}

export const supportedChainParams = {
  chainId: `0x${supportedChain.id.toString(16)}`,
  chainName: supportedChain.name,
  nativeCurrency: supportedChain.nativeCurrency,
  rpcUrls: [resolveWalletRpcUrl(supportedChain)],
  blockExplorerUrls: supportedChain.blockExplorers?.default?.url
    ? [supportedChain.blockExplorers.default.url]
    : []
};
