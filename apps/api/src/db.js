import pg from 'pg';
import { apiConfig } from './config.js';

let postgresPool = null;
let databaseReadyPromise = null;

export const postgresSchemaSql = `
  CREATE TABLE IF NOT EXISTS pacts (
    pact_id INTEGER PRIMARY KEY,
    creator_address TEXT NOT NULL,
    counterparty_address TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    event_type TEXT NOT NULL DEFAULT '',
    stake_amount TEXT NOT NULL DEFAULT '0',
    acceptance_deadline INTEGER NOT NULL DEFAULT 0,
    event_duration_seconds INTEGER NOT NULL DEFAULT 0,
    declaration_window_seconds INTEGER NOT NULL DEFAULT 0,
    event_started_at INTEGER NOT NULL DEFAULT 0,
    event_end INTEGER NOT NULL DEFAULT 0,
    submission_deadline INTEGER NOT NULL DEFAULT 0,
    raw_status TEXT NOT NULL DEFAULT 'Unknown',
    is_public INTEGER NOT NULL DEFAULT 0,
    winner_address TEXT NOT NULL DEFAULT '',
    agreed_result_hash TEXT NOT NULL DEFAULT '',
    fee_recipient TEXT NOT NULL DEFAULT '',
    fee_bps INTEGER NOT NULL DEFAULT 0,
    creation_tx_hash TEXT NOT NULL DEFAULT '',
    creation_block_number INTEGER NOT NULL DEFAULT 0,
    last_event_block_number INTEGER NOT NULL DEFAULT 0,
    last_event_name TEXT NOT NULL DEFAULT '',
    last_resolution_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pact_participants (
    pact_id INTEGER NOT NULL,
    participant_address TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (pact_id, participant_address)
  );

  CREATE TABLE IF NOT EXISTS pact_declarations (
    pact_id INTEGER NOT NULL,
    participant_address TEXT NOT NULL,
    submitted INTEGER NOT NULL DEFAULT 0,
    submitted_at INTEGER NOT NULL DEFAULT 0,
    declared_winner_address TEXT NOT NULL DEFAULT '',
    declaration_source TEXT NOT NULL DEFAULT 'indexer',
    tx_hash TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (pact_id, participant_address)
  );

  CREATE TABLE IF NOT EXISTS pact_evidence (
    id BIGSERIAL PRIMARY KEY,
    pact_id INTEGER NOT NULL,
    participant_address TEXT NOT NULL,
    evidence_uri TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'onchain',
    content_hash_sha256 TEXT NOT NULL DEFAULT '',
    mime_type TEXT NOT NULL DEFAULT '',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    original_name TEXT NOT NULL DEFAULT '',
    tx_hash TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (pact_id, participant_address, evidence_uri)
  );

  CREATE TABLE IF NOT EXISTS usernames (
    address TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    username_hash TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sync_state (
    sync_key TEXT PRIMARY KEY,
    deployment_key TEXT NOT NULL DEFAULT '',
    start_block INTEGER NOT NULL DEFAULT 0,
    last_block_number INTEGER NOT NULL DEFAULT 0,
    last_block_hash TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'idle',
    last_error TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL DEFAULT '',
    last_synced_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS admin_queue (
    pact_id INTEGER PRIMARY KEY,
    queue_status TEXT NOT NULL DEFAULT 'idle',
    evidence_count INTEGER NOT NULL DEFAULT 0,
    has_creator_evidence INTEGER NOT NULL DEFAULT 0,
    has_counterparty_evidence INTEGER NOT NULL DEFAULT 0,
    last_evidence_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS auth_nonces (
    address TEXT PRIMARY KEY,
    nonce TEXT NOT NULL,
    issued_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    address TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    user_agent TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS pact_messages (
    id TEXT PRIMARY KEY,
    pact_id INTEGER NOT NULL,
    author_address TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT '',
    deleted_at TEXT NOT NULL DEFAULT ''
  );

  CREATE INDEX IF NOT EXISTS idx_pacts_creator ON pacts (creator_address);
  CREATE INDEX IF NOT EXISTS idx_pacts_counterparty ON pacts (counterparty_address);
  CREATE INDEX IF NOT EXISTS idx_pacts_status ON pacts (raw_status, pact_id DESC);
  CREATE INDEX IF NOT EXISTS idx_participants_address ON pact_participants (participant_address, pact_id DESC);
  CREATE INDEX IF NOT EXISTS idx_declarations_pact ON pact_declarations (pact_id);
  CREATE INDEX IF NOT EXISTS idx_evidence_pact ON pact_evidence (pact_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_messages_pact ON pact_messages (pact_id, created_at ASC);
  CREATE INDEX IF NOT EXISTS idx_sessions_address ON sessions (address, expires_at);

  ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS deployment_key TEXT NOT NULL DEFAULT '';

  ALTER TABLE pacts ENABLE ROW LEVEL SECURITY;
  ALTER TABLE pact_participants ENABLE ROW LEVEL SECURITY;
  ALTER TABLE pact_declarations ENABLE ROW LEVEL SECURITY;
  ALTER TABLE pact_evidence ENABLE ROW LEVEL SECURITY;
  ALTER TABLE usernames ENABLE ROW LEVEL SECURITY;
  ALTER TABLE sync_state ENABLE ROW LEVEL SECURITY;
  ALTER TABLE admin_queue ENABLE ROW LEVEL SECURITY;
  ALTER TABLE auth_nonces ENABLE ROW LEVEL SECURITY;
  ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
  ALTER TABLE pact_messages ENABLE ROW LEVEL SECURITY;
`;

function convertPlaceholders(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

async function createPostgresPool() {
  const { Pool } = pg;
  const pool = new Pool({
    connectionString: apiConfig.databaseUrl,
    max: apiConfig.databasePoolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: /supabase\.(co|com)|pooler\.supabase\.com/i.test(apiConfig.databaseUrl)
      ? { rejectUnauthorized: false }
      : undefined
  });

  pool.on('error', (error) => {
    console.error('Postgres pool idle client error', {
      code: error?.code || '',
      message: error?.message || String(error || '')
    });
  });

  await pool.query(postgresSchemaSql);
  return pool;
}

function isTransientPostgresError(error) {
  const message = String(error?.message || '');
  return (
    ['EADDRNOTAVAIL', 'ECONNRESET', 'ETIMEDOUT'].includes(String(error?.code || '')) ||
    /connection terminated|connection timeout|terminating connection|timeout exceeded/i.test(message)
  );
}

async function queryWithRetry(sql, params = []) {
  let db = await getDatabase();
  try {
    return await db.query(convertPlaceholders(sql), params);
  } catch (error) {
    if (!isTransientPostgresError(error)) {
      throw error;
    }

    postgresPool = null;
    databaseReadyPromise = null;
    db = await getDatabase();
    return db.query(convertPlaceholders(sql), params);
  }
}

export function nowIso() {
  return new Date().toISOString();
}

export async function getDatabase() {
  if (!apiConfig.databaseUrl) {
    throw new Error('DATABASE_URL is required. StakeWithFriends API now uses Supabase Postgres for all database reads and writes.');
  }

  if (postgresPool) {
    return postgresPool;
  }

  if (!databaseReadyPromise) {
    databaseReadyPromise = createPostgresPool().catch((error) => {
      postgresPool = null;
      databaseReadyPromise = null;
      throw error;
    });
  }

  postgresPool = await databaseReadyPromise;
  return postgresPool;
}

export async function all(sql, params = []) {
  const result = await queryWithRetry(sql, params);
  return result.rows;
}

export async function get(sql, params = []) {
  const result = await queryWithRetry(sql, params);
  return result.rows[0];
}

export async function run(sql, params = []) {
  return queryWithRetry(sql, params);
}

export async function ensureSyncState(syncKey, startBlock) {
  const now = nowIso();
  await run(
    `
      INSERT INTO sync_state (
        sync_key,
        deployment_key,
        start_block,
        last_block_number,
        status,
        last_error,
        started_at,
        last_synced_at
      )
      VALUES (?, '', ?, ?, 'idle', '', '', ?)
      ON CONFLICT(sync_key) DO NOTHING
    `,
    [syncKey, Number(startBlock), Math.max(Number(startBlock) - 1, 0), now]
  );
}

export async function cleanupExpiredAuthRecords() {
  const now = nowIso();
  await run(`DELETE FROM auth_nonces WHERE expires_at <= ?`, [now]);
  await run(`DELETE FROM sessions WHERE expires_at <= ?`, [now]);
}
