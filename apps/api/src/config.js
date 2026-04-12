import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, '../../..');
const apiRoot = path.resolve(__dirname, '..');
const webRoot = path.resolve(workspaceRoot, 'apps/web');
const zeroAddress = '0x0000000000000000000000000000000000000000';

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  return fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .reduce((accumulator, line) => {
      const trimmedLine = line.trim();
      if (!trimmedLine || trimmedLine.startsWith('#')) {
        return accumulator;
      }

      const separatorIndex = trimmedLine.indexOf('=');
      if (separatorIndex === -1) {
        return accumulator;
      }

      const key = trimmedLine.slice(0, separatorIndex).trim();
      const rawValue = trimmedLine.slice(separatorIndex + 1).trim();
      accumulator[key] = rawValue.replace(/^['"]|['"]$/g, '');
      return accumulator;
    }, {});
}

const fileEnv = [
  path.join(workspaceRoot, '.env'),
  path.join(webRoot, '.env'),
  path.join(apiRoot, '.env')
].reduce((accumulator, filePath) => ({ ...accumulator, ...parseEnvFile(filePath) }), {});

function getEnv(name, fallback = '') {
  return process.env[name] ?? fileEnv[name] ?? fallback;
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function defaultSessionCookieSecure(host) {
  const normalizedHost = String(host || '').trim().toLowerCase();
  return !['localhost', '127.0.0.1', '::1'].includes(normalizedHost);
}

function normalizeRpcUrl(value) {
  if (!value || String(value).startsWith('/')) {
    return getEnv('ARC_RPC_UPSTREAM_URL', getEnv('MONAD_RPC_UPSTREAM_URL', 'https://rpc.testnet.arc.network'));
  }

  return value;
}

function resolveContractAddress(primaryKey, fallbackKey) {
  return getEnv(primaryKey, getEnv(fallbackKey, ''));
}

export function isAddressConfigured(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || ''));
}

export const apiConfig = {
  workspaceRoot,
  apiRoot,
  webRoot,
  zeroAddress,
  host: getEnv('API_HOST', '127.0.0.1'),
  port: parseInteger(getEnv('API_PORT', 8787), 8787),
  allowedOrigin: getEnv('ALLOWED_ORIGIN', '*'),
  databasePath: path.resolve(apiRoot, getEnv('DATABASE_PATH', 'data/stakewithfriends.sqlite')),
  rpcUrl: normalizeRpcUrl(
    getEnv('ARC_RPC_URL', getEnv('MONAD_RPC_URL', getEnv('VITE_RPC_URL', 'https://rpc.testnet.arc.network')))
  ),
  chainId: parseInteger(getEnv('CHAIN_ID', getEnv('VITE_CHAIN_ID', 5042002)), 5042002),
  embedIndexer: parseBoolean(getEnv('EMBED_INDEXER', 'true'), true),
  coreSyncMode: getEnv('CORE_SYNC_MODE', 'state-snapshot'),
  usernameSyncMode: getEnv('USERNAME_SYNC_MODE', 'state-snapshot'),
  syncBatchSize: parseInteger(getEnv('SYNC_BATCH_SIZE', 100), 100),
  syncMaxBatchesPerRun: parseInteger(getEnv('SYNC_MAX_BATCHES_PER_RUN', 25), 25),
  syncPollIntervalMs: parseInteger(getEnv('SYNC_POLL_INTERVAL_MS', 15_000), 15_000),
  healthSyncLagBlocks: parseInteger(getEnv('HEALTH_SYNC_LAG_BLOCKS', 5000), 5000),
  autonomousKeeperEnabled: parseBoolean(getEnv('AUTONOMOUS_KEEPER_ENABLED', 'false'), false),
  autonomousKeeperPrivateKey: getEnv('AUTONOMOUS_KEEPER_PRIVATE_KEY', ''),
  autonomousKeeperPollIntervalMs: parseInteger(getEnv('AUTONOMOUS_KEEPER_POLL_INTERVAL_MS', 15_000), 15_000),
  autonomousKeeperBatchSize: parseInteger(getEnv('AUTONOMOUS_KEEPER_BATCH_SIZE', 25), 25),
  sessionTtlHours: parseInteger(getEnv('SESSION_TTL_HOURS', 168), 168),
  nonceTtlMinutes: parseInteger(getEnv('NONCE_TTL_MINUTES', 10), 10),
  sessionCookieSecure: parseBoolean(
    getEnv('SESSION_COOKIE_SECURE', ''),
    defaultSessionCookieSecure(getEnv('API_HOST', '127.0.0.1'))
  ),
  authNonceRateLimitMax: parseInteger(getEnv('AUTH_NONCE_RATE_LIMIT_MAX', 10), 10),
  authNonceRateLimitWindowMs: parseInteger(getEnv('AUTH_NONCE_RATE_LIMIT_WINDOW_MS', 10 * 60_000), 10 * 60_000),
  authVerifyRateLimitMax: parseInteger(getEnv('AUTH_VERIFY_RATE_LIMIT_MAX', 10), 10),
  authVerifyRateLimitWindowMs: parseInteger(
    getEnv('AUTH_VERIFY_RATE_LIMIT_WINDOW_MS', 10 * 60_000),
    10 * 60_000
  ),
  messagePostRateLimitMax: parseInteger(getEnv('MESSAGE_POST_RATE_LIMIT_MAX', 12), 12),
  messagePostRateLimitWindowMs: parseInteger(getEnv('MESSAGE_POST_RATE_LIMIT_WINDOW_MS', 60_000), 60_000),
  evidenceMetadataRateLimitMax: parseInteger(getEnv('EVIDENCE_METADATA_RATE_LIMIT_MAX', 20), 20),
  evidenceMetadataRateLimitWindowMs: parseInteger(
    getEnv('EVIDENCE_METADATA_RATE_LIMIT_WINDOW_MS', 10 * 60_000),
    10 * 60_000
  ),
  storageMode: getEnv('STORAGE_MODE', 'catbox-public'),
  catboxPublicBaseUrl: getEnv('CATBOX_PUBLIC_BASE_URL', 'https://files.catbox.moe'),
  maxCommentLength: parseInteger(getEnv('MAX_PACT_COMMENT_LENGTH', 280), 280),
  maxMessagesPerPact: parseInteger(getEnv('MAX_PACT_MESSAGES_PER_PACT', 200), 200),
  stateReconcileConcurrency: parseInteger(getEnv('STATE_RECONCILE_CONCURRENCY', 4), 4),
  contractStartBlocks: {
    core: BigInt(parseInteger(getEnv('PACT_INDEX_START_BLOCK', 0), 0)),
    usernames: BigInt(parseInteger(getEnv('USERNAME_INDEX_START_BLOCK', 0), 0))
  },
  addresses: {
    stablecoin: resolveContractAddress('STABLECOIN_ADDRESS', 'VITE_STABLECOIN_ADDRESS'),
    protocolControl: resolveContractAddress('PROTOCOL_CONTROL_ADDRESS', 'VITE_PROTOCOL_CONTROL_ADDRESS'),
    pactVault: resolveContractAddress('PACT_VAULT_ADDRESS', 'VITE_PACT_VAULT_ADDRESS'),
    pactManager: resolveContractAddress('PACT_MANAGER_ADDRESS', 'VITE_PACT_MANAGER_ADDRESS'),
    submissionManager: resolveContractAddress('SUBMISSION_MANAGER_ADDRESS', 'VITE_SUBMISSION_MANAGER_ADDRESS'),
    pactResolutionManager: resolveContractAddress('PACT_RESOLUTION_MANAGER_ADDRESS', 'VITE_PACT_RESOLUTION_MANAGER_ADDRESS'),
    usernameRegistry: resolveContractAddress('USERNAME_REGISTRY_ADDRESS', 'VITE_USERNAME_REGISTRY_ADDRESS')
  }
};

export function hasCoreContractsConfigured() {
  return [
    apiConfig.addresses.stablecoin,
    apiConfig.addresses.protocolControl,
    apiConfig.addresses.pactVault,
    apiConfig.addresses.pactManager,
    apiConfig.addresses.submissionManager,
    apiConfig.addresses.pactResolutionManager
  ].every(isAddressConfigured);
}

export function hasUsernameRegistryConfigured() {
  return isAddressConfigured(apiConfig.addresses.usernameRegistry);
}

export function hasAutonomousKeeperConfigured() {
  return Boolean(
    apiConfig.autonomousKeeperEnabled &&
      hasCoreContractsConfigured() &&
      /^0x[a-fA-F0-9]{64}$/.test(String(apiConfig.autonomousKeeperPrivateKey || ''))
  );
}
