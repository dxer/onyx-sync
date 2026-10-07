import type { CommitChangeItem } from '@onyx/shared';

export const TABLES_SQL = `
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_tokens (
    token_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    vault_id TEXT DEFAULT '',
    device_name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    token_type TEXT DEFAULT 'device',
    expires_at INTEGER,
    revoked_at INTEGER,
    revoked_reason TEXT,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vaults (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    salt TEXT NOT NULL,
    latest_version INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    vault_id TEXT NOT NULL,
    device_name TEXT NOT NULL,
    last_seen INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS deletion_jobs (
    job_id TEXT PRIMARY KEY,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    owner_user_id TEXT,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS commit_receipts (
    vault_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    new_version INTEGER NOT NULL,
    committed_count INTEGER NOT NULL,
    changes_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (vault_id, request_id)
);

CREATE TABLE IF NOT EXISTS file_records (
    id TEXT PRIMARY KEY,
    vault_id TEXT NOT NULL,
    encrypted_path TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    size INTEGER NOT NULL,
    version INTEGER NOT NULL,
    is_deleted INTEGER DEFAULT 0,
    mtime INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
`;

export const INDEXES_SQL = `
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_vault ON auth_tokens(vault_id);
CREATE INDEX IF NOT EXISTS idx_vaults_user ON vaults(user_id);
CREATE INDEX IF NOT EXISTS idx_file_records_vault_ver ON file_records(vault_id, version);
CREATE INDEX IF NOT EXISTS idx_file_records_vault_path ON file_records(vault_id, encrypted_path);
CREATE INDEX IF NOT EXISTS idx_file_records_vault_updated ON file_records(vault_id, updated_at);
`;

export const SCHEMA_SQL = TABLES_SQL + '\n' + INDEXES_SQL;

// ==================== Shared token SQL (used by both SQLite and D1 stores) ====================

/** Columns of auth_tokens as exposed via the UserToken type (never the secret hash). */
export const AUTH_TOKEN_SELECT = `token_id as tokenId, user_id as userId, vault_id as vaultId, device_name as deviceName,
       token_type as tokenType, expires_at as expiresAt, revoked_at as revokedAt, created_at as createdAt, last_used_at as lastUsedAt`;

export const TOKEN_SESSION_SQL = `SELECT u.id as u_id, u.username as u_username, u.role as u_role, u.created_at as u_created_at,
       t.token_id as t_token_id, t.user_id as t_user_id, t.vault_id as t_vault_id, t.device_name as t_device_name,
       t.token_type as t_token_type, t.expires_at as t_expires_at, t.created_at as t_created_at, t.last_used_at as t_last_used_at,
       v.id as v_id, v.user_id as v_user_id, v.name as v_name, v.salt as v_salt, v.latest_version as v_latest_version, v.created_at as v_created_at
FROM auth_tokens t
JOIN users u ON t.user_id = u.id
LEFT JOIN vaults v ON t.vault_id = v.id
WHERE t.token_hash = ? AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > ?)`;

export const MASTER_TOKEN_SQL = `SELECT u.id, u.username, u.role, u.created_at as createdAt
FROM auth_tokens t
JOIN users u ON t.user_id = u.id
WHERE t.token_hash = ? AND t.vault_id = '' AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > ?)`;

// ==================== Shared commit helpers ====================

/** Canonical JSON for commit receipt payload hashing — field order is part of the contract. */
export function canonicalCommitPayload(changes: CommitChangeItem[]): string {
  const payload = changes.map((change) => ({
    id: change.id || null,
    encryptedPath: change.encryptedPath,
    contentHash: change.contentHash,
    size: change.size,
    isDeleted: change.isDeleted,
    mtime: change.mtime
  }));
  return JSON.stringify(payload);
}
