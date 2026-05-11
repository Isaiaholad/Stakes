import { supportedChain } from './chains.js';

export function getTransactionHash(receiptOrHash) {
  if (!receiptOrHash) {
    return '';
  }

  if (typeof receiptOrHash === 'string') {
    return receiptOrHash;
  }

  return receiptOrHash.transactionHash || receiptOrHash.hash || '';
}

export function getTransactionExplorerUrl(receiptOrHash) {
  const hash = getTransactionHash(receiptOrHash);
  const explorerUrl = supportedChain.blockExplorers?.default?.url || '';
  if (!hash || !explorerUrl) {
    return '';
  }

  return `${explorerUrl.replace(/\/$/, '')}/tx/${hash}`;
}

export function formatTransactionHash(receiptOrHash) {
  const hash = getTransactionHash(receiptOrHash);
  if (!hash) {
    return '';
  }

  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

export function getReceiptStatusMessage(receipt) {
  if (!receipt) {
    return '';
  }

  const chainName = supportedChain.name || 'chain';
  const shortHash = formatTransactionHash(receipt);
  const status = receipt.status === 'success' ? `Confirmed on ${chainName}.` : `Transaction status: ${receipt.status || 'submitted'}.`;
  return shortHash ? `${status} ${shortHash}` : status;
}

export function buildTransactionToast(receipt, overrides = {}) {
  const actionHref = getTransactionExplorerUrl(receipt);

  return {
    message: overrides.message || getReceiptStatusMessage(receipt),
    actionHref,
    actionLabel: overrides.actionLabel || 'View transaction',
    duration: overrides.duration || 10_000
  };
}
