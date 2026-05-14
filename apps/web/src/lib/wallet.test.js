import { describe, expect, it, vi } from 'vitest';
import { supportedChainParams } from './chains.js';
import { switchToSupportedChain } from './wallet.js';

function createProvider({ chainId = '0x1', switchError } = {}) {
  const request = vi.fn(async ({ method }) => {
    if (method === 'eth_chainId') {
      return chainId;
    }

    if (method === 'wallet_switchEthereumChain' && switchError) {
      const error = switchError;
      switchError = null;
      throw error;
    }

    return null;
  });

  return { request };
}

describe('switchToSupportedChain', () => {
  it('adds Arc when the connected wallet does not recognize the chain id', async () => {
    const provider = createProvider({
      switchError: Object.assign(new Error('Unrecognized chain ID "0x4cef52"'), { code: -32603 })
    });

    await expect(switchToSupportedChain(provider)).resolves.toBe(Number.parseInt(supportedChainParams.chainId, 16));

    expect(provider.request).toHaveBeenCalledWith({
      method: 'wallet_addEthereumChain',
      params: [supportedChainParams]
    });
    expect(supportedChainParams.rpcUrls).toEqual(expect.arrayContaining([expect.stringMatching(/^https?:\/\//)]));
  });

  it('keeps MetaMask 4902 behavior for wallets that use the standard unknown-chain code', async () => {
    const provider = createProvider({
      switchError: Object.assign(new Error('Chain has not been added'), { code: 4902 })
    });

    await switchToSupportedChain(provider);

    expect(provider.request).toHaveBeenCalledWith({
      method: 'wallet_addEthereumChain',
      params: [supportedChainParams]
    });
  });

  it('recovers when MetaMask nests the unrecognized-chain error inside data.originalError', async () => {
    const provider = createProvider({
      switchError: {
        code: -32603,
        message: 'Internal JSON-RPC error.',
        data: {
          originalError: {
            code: 4902,
            message: 'Unrecognized chain ID "0x4cef52". Try adding the chain using wallet_addEthereumChain first.'
          }
        }
      }
    });

    await switchToSupportedChain(provider);

    expect(provider.request).toHaveBeenCalledWith({
      method: 'wallet_addEthereumChain',
      params: [supportedChainParams]
    });
  });
});
