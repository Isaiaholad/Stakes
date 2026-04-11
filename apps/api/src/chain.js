import {
  createPublicClient,
  decodeEventLog,
  formatUnits,
  http,
  keccak256,
  stringToHex,
  zeroAddress
} from 'viem';
import {
  ARBITER_ROLE,
  pactManagerAbi,
  pactResolutionManagerAbi,
  pactVaultAbi,
  protocolControlAbi,
  stablecoinAbi,
  submissionManagerAbi,
  usernameRegistryAbi
} from '../../web/src/lib/abis.js';
import { apiConfig, hasCoreContractsConfigured, hasUsernameRegistryConfigured } from './config.js';

export const ADMIN_ROLE = keccak256(stringToHex('ADMIN_ROLE'));

export const pactManagerEventAbi = [
  {
    type: 'event',
    anonymous: false,
    name: 'PactCreated',
    inputs: [
      { indexed: true, name: 'pactId', type: 'uint256' },
      { indexed: true, name: 'creator', type: 'address' },
      { indexed: true, name: 'counterparty', type: 'address' },
      { indexed: false, name: 'stakeAmount', type: 'uint256' },
      { indexed: false, name: 'acceptanceDeadline', type: 'uint64' },
      { indexed: false, name: 'eventDuration', type: 'uint64' },
      { indexed: false, name: 'declarationWindow', type: 'uint64' },
      { indexed: false, name: 'description', type: 'string' },
      { indexed: false, name: 'eventType', type: 'string' }
    ]
  },
  {
    type: 'event',
    anonymous: false,
    name: 'PactJoined',
    inputs: [
      { indexed: true, name: 'pactId', type: 'uint256' },
      { indexed: true, name: 'counterparty', type: 'address' },
      { indexed: false, name: 'eventStartedAt', type: 'uint64' },
      { indexed: false, name: 'eventEnd', type: 'uint64' },
      { indexed: false, name: 'submissionDeadline', type: 'uint64' },
      { indexed: false, name: 'declarationWindow', type: 'uint64' }
    ]
  },
  {
    type: 'event',
    anonymous: false,
    name: 'PactCancelled',
    inputs: [{ indexed: true, name: 'pactId', type: 'uint256' }]
  },
  {
    type: 'event',
    anonymous: false,
    name: 'PactExpired',
    inputs: [{ indexed: true, name: 'pactId', type: 'uint256' }]
  },
  {
    type: 'event',
    anonymous: false,
    name: 'PactDisputed',
    inputs: [{ indexed: true, name: 'pactId', type: 'uint256' }]
  },
  {
    type: 'event',
    anonymous: false,
    name: 'PactResolved',
    inputs: [
      { indexed: true, name: 'pactId', type: 'uint256' },
      { indexed: true, name: 'winner', type: 'address' },
      { indexed: true, name: 'agreedResultHash', type: 'bytes32' },
      { indexed: false, name: 'resolvedBy', type: 'address' }
    ]
  },
  {
    type: 'event',
    anonymous: false,
    name: 'MinimumStakeAmountUpdated',
    inputs: [
      { indexed: false, name: 'previousMinimumStakeAmount', type: 'uint256' },
      { indexed: false, name: 'newMinimumStakeAmount', type: 'uint256' },
      { indexed: true, name: 'updatedBy', type: 'address' }
    ]
  }
];

export const submissionManagerEventAbi = [
  {
    type: 'event',
    anonymous: false,
    name: 'WinnerDeclared',
    inputs: [
      { indexed: true, name: 'pactId', type: 'uint256' },
      { indexed: true, name: 'user', type: 'address' },
      { indexed: true, name: 'declaredWinner', type: 'address' }
    ]
  }
];

export const pactResolutionManagerEventAbi = [
  {
    type: 'event',
    anonymous: false,
    name: 'PactDisputed',
    inputs: [
      { indexed: true, name: 'pactId', type: 'uint256' },
      { indexed: true, name: 'openedBy', type: 'address' }
    ]
  },
  {
    type: 'event',
    anonymous: false,
    name: 'DisputeEvidenceSubmitted',
    inputs: [
      { indexed: true, name: 'pactId', type: 'uint256' },
      { indexed: true, name: 'user', type: 'address' },
      { indexed: false, name: 'evidenceUri', type: 'string' }
    ]
  }
];

export const pactVaultEventAbi = [
  {
    type: 'event',
    anonymous: false,
    name: 'PactFeeSnapshotCaptured',
    inputs: [
      { indexed: true, name: 'pactId', type: 'uint256' },
      { indexed: true, name: 'feeRecipient', type: 'address' },
      { indexed: false, name: 'feeBps', type: 'uint16' }
    ]
  }
];

export const usernameRegistryEventAbi = [
  {
    type: 'event',
    anonymous: false,
    name: 'UsernameSet',
    inputs: [
      { indexed: true, name: 'user', type: 'address' },
      { indexed: false, name: 'username', type: 'string' }
    ]
  },
  {
    type: 'event',
    anonymous: false,
    name: 'UsernameCleared',
    inputs: [
      { indexed: true, name: 'user', type: 'address' },
      { indexed: false, name: 'username', type: 'string' }
    ]
  }
];

export const publicClient = createPublicClient({
  transport: http(apiConfig.rpcUrl, {
    retryCount: 6,
    retryDelay: 400
  })
});

const rawStatusMap = {
  0: 'None',
  1: 'Proposed',
  2: 'Active',
  3: 'Disputed',
  4: 'Resolved',
  5: 'Cancelled'
};

const protocolSnapshotTtlMs = 60_000;
let cachedProtocolBase = null;
let cachedProtocolBaseAt = 0;

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRateLimitError(error) {
  const values = [
    error?.message,
    error?.shortMessage,
    error?.details,
    error?.cause?.message,
    error?.cause?.shortMessage,
    error?.cause?.details
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());

  return values.some((value) => value.includes('429') || value.includes('requests limited to 15/sec') || value.includes('-32011'));
}

export async function readContractWithRetry(config, attempt = 0) {
  try {
    return await publicClient.readContract(config);
  } catch (error) {
    if (attempt >= 3 || !isRateLimitError(error)) {
      throw error;
    }

    await wait(450 * (attempt + 1));
    return readContractWithRetry(config, attempt + 1);
  }
}

export async function readProtocolSnapshot(address) {
  if (!hasCoreContractsConfigured()) {
    return {
      decimals: 6,
      symbol: 'USDC',
      paused: false,
      isArbiter: false,
      isAdmin: false
    };
  }

  if (!cachedProtocolBase || Date.now() - cachedProtocolBaseAt > protocolSnapshotTtlMs) {
    const [decimals, symbol, paused] = await Promise.all([
      readContractWithRetry({
        address: apiConfig.addresses.stablecoin,
        abi: stablecoinAbi,
        functionName: 'decimals'
      }),
      readContractWithRetry({
        address: apiConfig.addresses.stablecoin,
        abi: stablecoinAbi,
        functionName: 'symbol'
      }),
      readContractWithRetry({
        address: apiConfig.addresses.protocolControl,
        abi: protocolControlAbi,
        functionName: 'paused'
      })
    ]);

    cachedProtocolBase = { decimals, symbol, paused };
    cachedProtocolBaseAt = Date.now();
  }

  if (!address) {
    return {
      ...cachedProtocolBase,
      isArbiter: false,
      isAdmin: false
    };
  }

  const [isArbiter, isAdmin] = await Promise.all([
    readContractWithRetry({
      address: apiConfig.addresses.protocolControl,
      abi: protocolControlAbi,
      functionName: 'hasRole',
      args: [ARBITER_ROLE, address]
    }),
    readContractWithRetry({
      address: apiConfig.addresses.protocolControl,
      abi: protocolControlAbi,
      functionName: 'hasRole',
      args: [ADMIN_ROLE, address]
    })
  ]);

  return {
    ...cachedProtocolBase,
    isArbiter: Boolean(isArbiter),
    isAdmin: Boolean(isAdmin)
  };
}

export async function readVaultSnapshot(address) {
  const protocol = await readProtocolSnapshot(address);

  if (!address || !hasCoreContractsConfigured()) {
    return {
      ...protocol,
      walletBalance: '0',
      allowance: '0',
      availableBalance: '0',
      reservedBalance: '0'
    };
  }

  const [walletBalance, allowance, availableBalance, reservedBalance] = await Promise.all([
    readContractWithRetry({
      address: apiConfig.addresses.stablecoin,
      abi: stablecoinAbi,
      functionName: 'balanceOf',
      args: [address]
    }),
    readContractWithRetry({
      address: apiConfig.addresses.stablecoin,
      abi: stablecoinAbi,
      functionName: 'allowance',
      args: [address, apiConfig.addresses.pactVault]
    }),
    readContractWithRetry({
      address: apiConfig.addresses.pactVault,
      abi: pactVaultAbi,
      functionName: 'availableBalance',
      args: [address]
    }),
    readContractWithRetry({
      address: apiConfig.addresses.pactVault,
      abi: pactVaultAbi,
      functionName: 'reservedBalance',
      args: [address]
    })
  ]);

  return {
    ...protocol,
    walletBalance: formatUnits(walletBalance, protocol.decimals),
    allowance: allowance.toString(),
    availableBalance: formatUnits(availableBalance, protocol.decimals),
    reservedBalance: formatUnits(reservedBalance, protocol.decimals)
  };
}

export async function readPactAccessFromChain(pactId) {
  if (!hasCoreContractsConfigured() || !Number.isFinite(Number(pactId)) || Number(pactId) < 1) {
    return null;
  }

  const core = await readContractWithRetry({
    address: apiConfig.addresses.pactManager,
    abi: pactManagerAbi,
    functionName: 'getPactCore',
    args: [BigInt(pactId)]
  }).catch(() => null);

  if (!core) {
    return null;
  }

  const creator = String(core[0] || '').toLowerCase();
  if (!creator || creator === zeroAddress) {
    return null;
  }

  return {
    pact_id: Number(pactId),
    creator_address: creator,
    counterparty_address: String(core[1] || zeroAddress).toLowerCase(),
    raw_status: rawStatusMap[Number(core[8])] || 'Unknown'
  };
}

export async function readUsernameByAddressFromChain(address) {
  if (!hasUsernameRegistryConfigured() || !address || address === zeroAddress) {
    return '';
  }

  return readContractWithRetry({
    address: apiConfig.addresses.usernameRegistry,
    abi: usernameRegistryAbi,
    functionName: 'usernameOf',
    args: [address]
  });
}

export async function resolveUsernameFromChain(username) {
  if (!hasUsernameRegistryConfigured() || !username) {
    return zeroAddress;
  }

  return readContractWithRetry({
    address: apiConfig.addresses.usernameRegistry,
    abi: usernameRegistryAbi,
    functionName: 'resolveUsername',
    args: [username]
  });
}

export async function getLatestBlockNumber() {
  return Number(await publicClient.getBlockNumber());
}

export async function getBlockTimestamp(blockNumber) {
  const block = await publicClient.getBlock({
    blockNumber: BigInt(blockNumber)
  });

  return Number(block.timestamp);
}

export async function getChainTimeSnapshot() {
  const block = await publicClient.getBlock();
  const timestamp = Number(block.timestamp);

  return {
    blockNumber: Number(block.number),
    timestamp,
    iso: new Date(timestamp * 1000).toISOString(),
    offsetMs: timestamp * 1000 - Date.now()
  };
}

export function decodeIndexedLog(log, abi) {
  return decodeEventLog({
    abi,
    data: log.data,
    topics: log.topics
  });
}

export {
  pactManagerAbi,
  pactResolutionManagerAbi,
  pactVaultAbi,
  protocolControlAbi,
  rawStatusMap,
  submissionManagerAbi,
  usernameRegistryAbi,
  zeroAddress
};
