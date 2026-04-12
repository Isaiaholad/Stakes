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

export const supportedChainParams = {
  chainId: `0x${supportedChain.id.toString(16)}`,
  chainName: supportedChain.name,
  nativeCurrency: supportedChain.nativeCurrency,
  rpcUrls: {
    default: {
      http: [protocolConfig.rpcUrl]
    }
  },
  blockExplorerUrls: supportedChain.blockExplorers?.default?.url
    ? [supportedChain.blockExplorers.default.url]
    : []
};
