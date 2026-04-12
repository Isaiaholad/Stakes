const env = import.meta.env;

const coreAddresses = {
  stablecoin: env.VITE_STABLECOIN_ADDRESS || '',
  protocolControl: env.VITE_PROTOCOL_CONTROL_ADDRESS || '',
  pactVault: env.VITE_PACT_VAULT_ADDRESS || '',
  pactManager: env.VITE_PACT_MANAGER_ADDRESS || '',
  submissionManager: env.VITE_SUBMISSION_MANAGER_ADDRESS || '',
  pactResolutionManager: env.VITE_PACT_RESOLUTION_MANAGER_ADDRESS || ''
};

export const protocolConfig = {
  chainId: Number(env.VITE_CHAIN_ID || 5042002),
  rpcUrl: env.VITE_RPC_URL || env.VITE_BASE_RPC_URL || 'https://rpc.testnet.arc.network',
  addresses: {
    ...coreAddresses,
    usernameRegistry: env.VITE_USERNAME_REGISTRY_ADDRESS || ''
  }
};

export const requiredContracts = Object.entries(coreAddresses);

export function getMissingContractConfig() {
  return requiredContracts.filter(([, value]) => !value).map(([key]) => key);
}

export function isProtocolConfigured() {
  return getMissingContractConfig().length === 0;
}

export function hasUsernameRegistryConfigured() {
  return Boolean(protocolConfig.addresses.usernameRegistry);
}
