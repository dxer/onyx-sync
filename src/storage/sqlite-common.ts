export const TABLES_SQL = `
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_tokens (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    vault_id TEXT DEFAULT '',
    device_name TEXT NOT NULL,
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
CREATE INDEX IF NOT EXISTS idx_user_tokens_user ON user_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_user_tokens_vault ON user_tokens(vault_id);
CREATE INDEX IF NOT EXISTS idx_vaults_user ON vaults(user_id);
CREATE INDEX IF NOT EXISTS idx_file_records_vault_ver ON file_records(vault_id, version);
CREATE INDEX IF NOT EXISTS idx_file_records_vault_path ON file_records(vault_id, encrypted_path);
CREATE INDEX IF NOT EXISTS idx_file_records_vault_updated ON file_records(vault_id, updated_at);
`;

export const SCHEMA_SQL = TABLES_SQL + '\n' + INDEXES_SQL;
