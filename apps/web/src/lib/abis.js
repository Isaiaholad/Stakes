import { erc20Abi, keccak256, stringToHex } from 'viem';

export const stablecoinAbi = erc20Abi;

export const usernameRegistryAbi = [
  {
    type: 'function',
    stateMutability: 'view',
    name: 'usernameOf',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: 'username', type: 'string' }]
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'resolveUsername',
    inputs: [{ name: 'username', type: 'string' }],
    outputs: [{ name: 'user', type: 'address' }]
  },
  {
    type: 'function',
    stateMutability: 'nonpayable',
    name: 'setUsername',
    inputs: [{ name: 'username', type: 'string' }],
    outputs: []
  },
  {
    type: 'function',
    stateMutability: 'nonpayable',
    name: 'clearUsername',
    inputs: [],
    outputs: []
  }
];

export const protocolControlAbi = [
  {
    type: 'function',
    stateMutability: 'view',
    name: 'paused',
    inputs: [],
    outputs: [{ type: 'bool' }]
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'hasRole',
    inputs: [
      { name: 'role', type: 'bytes32' },
      { name: 'account', type: 'address' }
    ],
    outputs: [{ type: 'bool' }]
  }
];

export const pactVaultAbi = [
  {
    type: 'function',
    stateMutability: 'view',
    name: 'pactFeeSnapshotOf',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'feeRecipient', type: 'address' },
      { name: 'feeBps', type: 'uint16' },
      { name: 'initialized', type: 'bool' }
    ]
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'availableBalance',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ type: 'uint256' }]
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'reservedBalance',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ type: 'uint256' }]
  },
  {
    type: 'function',
    stateMutability: 'nonpayable',
    name: 'deposit',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: []
  },
  {
    type: 'function',
    stateMutability: 'nonpayable',
    name: 'withdraw',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: []
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'pactStakeOf',
    inputs: [
      { name: '', type: 'uint256' },
      { name: '', type: 'address' }
    ],
    outputs: [{ type: 'uint256' }]
  }
];

export const pactManagerAbi = [
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
    type: 'function',
    stateMutability: 'view',
    name: 'minimumStakeAmount',
    inputs: [],
    outputs: [{ type: 'uint256' }]
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'DEFAULT_DECLARATION_WINDOW',
    inputs: [],
    outputs: [{ type: 'uint64' }]
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'MIN_DECLARATION_WINDOW',
    inputs: [],
    outputs: [{ type: 'uint64' }]
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'MAX_DECLARATION_WINDOW',
    inputs: [],
    outputs: [{ type: 'uint64' }]
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'nextPactId',
    inputs: [],
    outputs: [{ type: 'uint256' }]
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'descriptions',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [{ type: 'string' }]
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'eventTypes',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [{ type: 'string' }]
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'getPactCore',
    inputs: [{ name: 'pactId', type: 'uint256' }],
    outputs: [
      { name: 'creator', type: 'address' },
      { name: 'counterparty', type: 'address' },
      { name: 'stakeAmount', type: 'uint256' },
      { name: 'acceptanceDeadline', type: 'uint64' },
      { name: 'eventDuration', type: 'uint64' },
      { name: 'eventStartedAt', type: 'uint64' },
      { name: 'eventEnd', type: 'uint64' },
      { name: 'submissionDeadline', type: 'uint64' },
      { name: 'status', type: 'uint8' },
      { name: 'winner', type: 'address' },
      { name: 'agreedResultHash', type: 'bytes32' },
      { name: 'declarationWindow', type: 'uint64' }
    ]
  },
  {
    type: 'function',
    stateMutability: 'nonpayable',
    name: 'createPact',
    inputs: [
      { name: 'counterparty', type: 'address' },
      { name: 'description', type: 'string' },
      { name: 'eventType', type: 'string' },
      { name: 'eventDuration', type: 'uint64' },
      { name: 'stakeAmount', type: 'uint256' }
    ],
    outputs: [{ type: 'uint256' }]
  },
  {
    type: 'function',
    stateMutability: 'nonpayable',
    name: 'createPact',
    inputs: [
      { name: 'counterparty', type: 'address' },
      { name: 'description', type: 'string' },
      { name: 'eventType', type: 'string' },
      { name: 'eventDuration', type: 'uint64' },
      { name: 'declarationWindow', type: 'uint64' },
      { name: 'stakeAmount', type: 'uint256' }
    ],
    outputs: [{ type: 'uint256' }]
  },
  {
    type: 'function',
    stateMutability: 'nonpayable',
    name: 'joinPact',
    inputs: [{ name: 'pactId', type: 'uint256' }],
    outputs: []
  },
  {
    type: 'function',
    stateMutability: 'nonpayable',
    name: 'cancelUnjoinedPact',
    inputs: [{ name: 'pactId', type: 'uint256' }],
    outputs: []
  },
  {
    type: 'function',
    stateMutability: 'nonpayable',
    name: 'cancelExpiredPact',
    inputs: [{ name: 'pactId', type: 'uint256' }],
    outputs: []
  }
];

export const submissionManagerAbi = [
  {
    type: 'event',
    anonymous: false,
    name: 'WinnerDeclared',
    inputs: [
      { indexed: true, name: 'pactId', type: 'uint256' },
      { indexed: true, name: 'user', type: 'address' },
      { indexed: true, name: 'declaredWinner', type: 'address' }
    ]
  },
  {
    type: 'function',
    stateMutability: 'nonpayable',
    name: 'submitWinner',
    inputs: [
      { name: 'pactId', type: 'uint256' },
      { name: 'declaredWinner', type: 'address' }
    ],
    outputs: []
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'bothSubmitted',
    inputs: [{ name: 'pactId', type: 'uint256' }],
    outputs: [{ type: 'bool' }]
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'declarationsMatch',
    inputs: [{ name: 'pactId', type: 'uint256' }],
    outputs: [
      { name: 'matched', type: 'bool' },
      { name: 'declaredWinner', type: 'address' }
    ]
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'getDeclaration',
    inputs: [
      { name: 'pactId', type: 'uint256' },
      { name: 'user', type: 'address' }
    ],
    outputs: [
      { name: 'submitted', type: 'bool' },
      { name: 'submittedAt', type: 'uint64' },
      { name: 'declaredWinner', type: 'address' }
    ]
  }
];

export const pactResolutionManagerAbi = [
  {
    type: 'event',
    anonymous: false,
    name: 'PactAutoResolved',
    inputs: [
      { indexed: true, name: 'pactId', type: 'uint256' },
      { indexed: true, name: 'winner', type: 'address' },
      { indexed: true, name: 'agreedResultHash', type: 'bytes32' },
      { indexed: false, name: 'settledBy', type: 'address' }
    ]
  },
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
    name: 'PactArbiterResolved',
    inputs: [
      { indexed: true, name: 'pactId', type: 'uint256' },
      { indexed: true, name: 'winner', type: 'address' },
      { indexed: true, name: 'resolver', type: 'address' },
      { indexed: false, name: 'resolutionRef', type: 'bytes32' }
    ]
  },
  {
    type: 'event',
    anonymous: false,
    name: 'PactArbiterSplit',
    inputs: [
      { indexed: true, name: 'pactId', type: 'uint256' },
      { indexed: true, name: 'resolver', type: 'address' },
      { indexed: false, name: 'creatorShareBps', type: 'uint16' },
      { indexed: false, name: 'resolutionRef', type: 'bytes32' }
    ]
  },
  {
    type: 'event',
    anonymous: false,
    name: 'PactDisputeTimedOut',
    inputs: [
      { indexed: true, name: 'pactId', type: 'uint256' },
      { indexed: true, name: 'triggeredBy', type: 'address' }
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
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'SINGLE_SUBMITTER_GRACE_PERIOD',
    inputs: [],
    outputs: [{ type: 'uint64' }]
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'DISPUTE_REVIEW_WINDOW',
    inputs: [],
    outputs: [{ type: 'uint64' }]
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'DISPUTE_TIMEOUT',
    inputs: [],
    outputs: [{ type: 'uint64' }]
  },
  {
    type: 'function',
    stateMutability: 'nonpayable',
    name: 'finalizeMatchedResult',
    inputs: [{ name: 'pactId', type: 'uint256' }],
    outputs: []
  },
  {
    type: 'function',
    stateMutability: 'nonpayable',
    name: 'openDisputeFromMismatch',
    inputs: [{ name: 'pactId', type: 'uint256' }],
    outputs: []
  },
  {
    type: 'function',
    stateMutability: 'nonpayable',
    name: 'openDisputeFromUnansweredDeclaration',
    inputs: [{ name: 'pactId', type: 'uint256' }],
    outputs: []
  },
  {
    type: 'function',
    stateMutability: 'nonpayable',
    name: 'settleAfterDeclarationWindow',
    inputs: [{ name: 'pactId', type: 'uint256' }],
    outputs: []
  },
  {
    type: 'function',
    stateMutability: 'nonpayable',
    name: 'submitDisputeEvidence',
    inputs: [
      { name: 'pactId', type: 'uint256' },
      { name: 'evidenceUri', type: 'string' }
    ],
    outputs: []
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'getDisputeEvidence',
    inputs: [
      { name: 'pactId', type: 'uint256' },
      { name: 'user', type: 'address' }
    ],
    outputs: [{ name: 'evidenceUri', type: 'string' }]
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'disputeOpenedAt',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [{ type: 'uint64' }]
  },
  {
    type: 'function',
    stateMutability: 'nonpayable',
    name: 'adminResolveWinner',
    inputs: [
      { name: 'pactId', type: 'uint256' },
      { name: 'winner', type: 'address' },
      { name: 'resolutionRef', type: 'bytes32' }
    ],
    outputs: []
  },
  {
    type: 'function',
    stateMutability: 'nonpayable',
    name: 'adminResolveSplit',
    inputs: [
      { name: 'pactId', type: 'uint256' },
      { name: 'creatorShareBps', type: 'uint16' },
      { name: 'resolutionRef', type: 'bytes32' }
    ],
    outputs: []
  },
  {
    type: 'function',
    stateMutability: 'nonpayable',
    name: 'forceSplitAfterDisputeTimeout',
    inputs: [{ name: 'pactId', type: 'uint256' }],
    outputs: []
  }
];

export const ARBITER_ROLE = keccak256(stringToHex('ARBITER_ROLE'));
export const ADMIN_ROLE = keccak256(stringToHex('ADMIN_ROLE'));
