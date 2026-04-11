import { defineChain } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { protocolConfig } from './contracts.js';

const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: {
    name: 'MON',
    symbol: 'MON',
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
  testnet: true
});

const chainMap = {
  10143: monadTestnet,
  8453: base,
  84532: baseSepolia
};

export const supportedChain = chainMap[protocolConfig.chainId] || monadTestnet;

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
