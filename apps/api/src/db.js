import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { apiConfig } from './config.js';

let database = null;

const schemaSql = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

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
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
`;

export function nowIso() {
  return new Date().toISOString();
}

export function getDatabase() {
  if (database) {
    return database;
  }

  fs.mkdirSync(path.dirname(apiConfig.databasePath), { recursive: true });
  database = new DatabaseSync(apiConfig.databasePath);
  database.exec(schemaSql);
  return database;
}

export function all(sql, params = []) {
  return getDatabase().prepare(sql).all(...params);
}

export function get(sql, params = []) {
  return getDatabase().prepare(sql).get(...params);
}

export function run(sql, params = []) {
  return getDatabase().prepare(sql).run(...params);
}

export function ensureSyncState(syncKey, startBlock) {
  const now = nowIso();
  run(
    `
      INSERT INTO sync_state (
        sync_key,
        start_block,
        last_block_number,
        status,
        last_error,
        started_at,
        last_synced_at
      )
      VALUES (?, ?, ?, 'idle', '', '', ?)
      ON CONFLICT(sync_key) DO NOTHING
    `,
    [syncKey, Number(startBlock), Math.max(Number(startBlock) - 1, 0), now]
  );
}

export function cleanupExpiredAuthRecords() {
  const now = nowIso();
  run(`DELETE FROM auth_nonces WHERE expires_at <= ?`, [now]);
  run(`DELETE FROM sessions WHERE expires_at <= ?`, [now]);
}
