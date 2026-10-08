import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  User,
  UserToken,
  Vault,
  VaultSummary,
  AdminStats,
  AdminUserInfo,
  FileChange,
  CommitChangeItem,
  CommitResult,
  VaultActivityDay
} from '@onyx/shared';
import type {
  CreateTokenOptions,
  DeletionJob,
  DeletionJobStatus,
  IMetadataStore,
  UserWithSecret,
  TokenValidationResult
} from './types';
import { StorageConflictError, StorageNotFoundError } from './errors';
import { newTokenSecret, tokenExpiry } from './token-utils';
import {
  AUTH_TOKEN_SELECT,
  INDEXES_SQL,
  MASTER_TOKEN_SQL,
  TABLES_SQL,
  TOKEN_SESSION_SQL,
  canonicalCommitPayload
} from './sqlite-common';

export function hashTokenSecret(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class SqliteMetadataStore implements IMetadataStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    mkdirSync(dir, { recursive: true });
    this.db = new Database(dbPath);
  }

  async init(): Promise<void> {
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(TABLES_SQL);

    // Auto-migration for legacy tables
    try {
      const userCols = this.db.prepare('PRAGMA table_info(users)').all().map((c: any) => c.name);
      if (!userCols.includes('role')) {
        this.db.exec('ALTER TABLE users ADD COLUMN role TEXT DEFAULT "user"');
      }
      const vaultCols = this.db.prepare('PRAGMA table_info(vaults)').all().map((c: any) => c.name);
      if (!vaultCols.includes('user_id')) {
        this.db.exec('ALTER TABLE vaults ADD COLUMN user_id TEXT DEFAULT ""');
      }
    } catch {
      // ignore
    }

    this.migrateLegacyUserTokens();

    // Safely create indexes after columns exist
    try {
      this.db.exec(INDEXES_SQL);
    } catch {
      // ignore
    }
  }

  /** Upgrades the legacy plaintext user_tokens table into hash-only auth_tokens, then drops it. */
  private migrateLegacyUserTokens(): void {
    const exists = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_tokens'")
      .get();
    if (!exists) return;

    // Legacy databases may predate the lifecycle columns; select only what exists.
    const columns = new Set(
      (this.db.prepare('PRAGMA table_info(user_tokens)').all() as Array<{ name: string }>).map((c) => c.name)
    );
    if (!columns.has('token')) return;
    const wanted = [
      'token',
      'user_id',
      'vault_id',
      'device_name',
      'token_type',
      'expires_at',
      'revoked_at',
      'revoked_reason',
      'created_at',
      'last_used_at'
    ];
    const selectList = wanted.filter((column) => columns.has(column)).join(', ');

    const rows = this.db
      .prepare(`SELECT ${selectList} FROM user_tokens`)
      .all() as Array<{
      token: string | null;
      user_id: string;
      vault_id?: string | null;
      device_name: string;
      token_type?: string | null;
      expires_at?: number | null;
      revoked_at?: number | null;
      revoked_reason?: string | null;
      created_at?: number | null;
      last_used_at?: number | null;
    }>;

    const migrate = this.db.transaction(() => {
      const insert = this.db.prepare(
        'INSERT OR IGNORE INTO auth_tokens (token_id, user_id, vault_id, device_name, token_hash, token_type, expires_at, revoked_at, revoked_reason, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );
      for (const row of rows) {
        if (!row.token) continue;
        const tokenType = row.token_type === 'master' || row.token_type === 'device'
          ? row.token_type
          : row.vault_id
            ? 'device'
            : 'master';
        // Legacy rows either had no expiry column or a placeholder value; only a
        // genuinely future expiry is kept, otherwise the token gets a fresh window.
        const legacyExpiry = row.expires_at ?? null;
        const expiresAt = legacyExpiry !== null && legacyExpiry > Date.now()
          ? legacyExpiry
          : tokenExpiry(tokenType);
        insert.run(
          randomUUID(),
          row.user_id,
          row.vault_id || '',
          row.device_name || 'Device',
          hashTokenSecret(row.token),
          tokenType,
          expiresAt,
          row.revoked_at ?? null,
          row.revoked_reason ?? null,
          row.created_at ?? Date.now(),
          row.last_used_at ?? Date.now()
        );
      }
      this.db.exec('DROP TABLE user_tokens');
    });
    migrate();
  }

  close(): void {
    this.db.close();
  }

  private getCommitPayloadHash(changes: CommitChangeItem[]): string {
    return createHash('sha256').update(canonicalCommitPayload(changes)).digest('hex');
  }

  // User management
  async createUser(
    username: string,
    passwordHash: string,
    salt: string,
    role: 'admin' | 'user' = 'user'
  ): Promise<User> {
    const id = randomUUID();
    const createdAt = Date.now();
    this.db
      .prepare(
        'INSERT INTO users (id, username, password_hash, salt, role, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(id, username, passwordHash, salt, role, createdAt);

    return { id, username, role, createdAt };
  }

  async getUserByUsername(username: string): Promise<UserWithSecret | null> {
    const row = this.db
      .prepare(
        'SELECT id, username, password_hash as passwordHash, salt, role, created_at as createdAt FROM users WHERE username = ?'
      )
      .get(username) as (UserWithSecret & { role: 'admin' | 'user' }) | undefined;

    return row || null;
  }

  async getUserById(id: string): Promise<User | null> {
    const row = this.db
      .prepare('SELECT id, username, role, created_at as createdAt FROM users WHERE id = ?')
      .get(id) as User | undefined;

    return row || null;
  }

  async updateUserPassword(
    id: string,
    passwordHash: string,
    salt: string,
    role?: 'admin' | 'user'
  ): Promise<void> {
    if (role) {
      this.db
        .prepare('UPDATE users SET password_hash = ?, salt = ?, role = ? WHERE id = ?')
        .run(passwordHash, salt, role, id);
    } else {
      this.db
        .prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?')
        .run(passwordHash, salt, id);
    }
  }

  // Token management (hash-only storage)
  async createToken(
    userId: string,
    vaultId: string,
    deviceName: string,
    options?: CreateTokenOptions
  ): Promise<string> {
    const token = newTokenSecret();
    const tokenType = options?.tokenType || (vaultId ? 'device' : 'master');
    const now = Date.now();
    this.db
      .prepare(
        'INSERT INTO auth_tokens (token_id, user_id, vault_id, device_name, token_hash, token_type, expires_at, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(randomUUID(), userId, vaultId, deviceName, hashTokenSecret(token), tokenType, tokenExpiry(tokenType, options), now, now);

    return token;
  }

  async verifyToken(token: string): Promise<TokenValidationResult | null> {
    const row = this.db.prepare(TOKEN_SESSION_SQL).get(hashTokenSecret(token), Date.now()) as any;

    if (row && row.v_id) {
      this.db
        .prepare('UPDATE auth_tokens SET last_used_at = ? WHERE token_id = ?')
        .run(Date.now(), row.t_token_id);

      return {
        user: {
          id: row.u_id,
          username: row.u_username,
          role: row.u_role,
          createdAt: row.u_created_at
        },
        tokenInfo: {
          tokenId: row.t_token_id,
          userId: row.t_user_id,
          vaultId: row.t_vault_id,
          deviceName: row.t_device_name,
          tokenType: row.t_token_type,
          expiresAt: row.t_expires_at,
          createdAt: row.t_created_at,
          lastUsedAt: Date.now()
        },
        vault: {
          id: row.v_id,
          userId: row.v_user_id,
          name: row.v_name,
          salt: row.v_salt,
          latestVersion: row.v_latest_version,
          createdAt: row.v_created_at
        }
      };
    }

    return null;
  }

  async verifyUserMasterToken(token: string): Promise<User | null> {
    const row = this.db
      .prepare(MASTER_TOKEN_SQL)
      .get(hashTokenSecret(token), Date.now()) as User | undefined;

    if (row) {
      this.db
        .prepare('UPDATE auth_tokens SET last_used_at = ? WHERE token_hash = ?')
        .run(Date.now(), hashTokenSecret(token));
      return row;
    }

    return null;
  }

  async getTokenById(tokenId: string): Promise<UserToken | null> {
    const row = this.db
      .prepare(`SELECT ${AUTH_TOKEN_SELECT} FROM auth_tokens WHERE token_id = ?`)
      .get(tokenId) as UserToken | undefined;
    return row || null;
  }

  async isTokenActive(tokenId: string): Promise<boolean> {
    const row = this.db
      .prepare(
        'SELECT 1 as active FROM auth_tokens WHERE token_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)'
      )
      .get(tokenId, Date.now()) as { active: number } | undefined;
    return Boolean(row);
  }

  async updateToken(tokenId: string, deviceName: string): Promise<void> {
    this.db.prepare('UPDATE auth_tokens SET device_name = ? WHERE token_id = ?').run(deviceName, tokenId);
  }

  async rotateToken(tokenId: string): Promise<string | null> {
    const existing = await this.getTokenById(tokenId);
    if (!existing) return null;

    const tokenType = existing.tokenType === 'master' ? 'master' : 'device';
    const newToken = newTokenSecret();
    const now = Date.now();
    this.db
      .prepare(
        'UPDATE auth_tokens SET token_hash = ?, expires_at = ?, revoked_at = NULL, revoked_reason = NULL, created_at = ?, last_used_at = ? WHERE token_id = ?'
      )
      .run(hashTokenSecret(newToken), tokenExpiry(tokenType), now, now, tokenId);
    return newToken;
  }

  async deleteToken(tokenId: string): Promise<void> {
    this.db
      .prepare('UPDATE auth_tokens SET revoked_at = ?, revoked_reason = ? WHERE token_id = ?')
      .run(Date.now(), 'user_requested', tokenId);
  }

  async listUserTokens(userId: string): Promise<UserToken[]> {
    const rows = this.db
      .prepare(
        `SELECT ${AUTH_TOKEN_SELECT} FROM auth_tokens WHERE user_id = ? ORDER BY last_used_at DESC`
      )
      .all(userId) as UserToken[];

    return rows;
  }

  async listVaultTokens(vaultId: string): Promise<UserToken[]> {
    const rows = this.db
      .prepare(
        `SELECT ${AUTH_TOKEN_SELECT} FROM auth_tokens WHERE vault_id = ? ORDER BY last_used_at DESC`
      )
      .all(vaultId) as UserToken[];

    return rows;
  }

  // Vault management
  async getVault(vaultId: string): Promise<Vault | null> {
    const row = this.db
      .prepare(
        'SELECT id, user_id as userId, name, salt, latest_version as latestVersion, created_at as createdAt FROM vaults WHERE id = ?'
      )
      .get(vaultId) as Vault | undefined;

    return row || null;
  }

  async createVault(vault: { id: string; userId: string; name: string; salt: string }): Promise<Vault> {
    const createdAt = Date.now();
    this.db
      .prepare(
        'INSERT INTO vaults (id, user_id, name, salt, latest_version, created_at) VALUES (?, ?, ?, ?, 0, ?)'
      )
      .run(vault.id, vault.userId, vault.name, vault.salt, createdAt);

    return {
      id: vault.id,
      userId: vault.userId,
      name: vault.name,
      salt: vault.salt,
      latestVersion: 0,
      createdAt
    };
  }

  async listUserVaults(userId: string): Promise<VaultSummary[]> {
    const rows = this.db
      .prepare(
        `SELECT v.id, v.user_id as userId, v.name, v.salt, v.latest_version as latestVersion, v.created_at as createdAt,
                COUNT(f.id) as fileCount,
                COALESCE(SUM(f.size), 0) as totalSize
         FROM vaults v
         LEFT JOIN file_records f ON v.id = f.vault_id AND f.is_deleted = 0
         WHERE v.user_id = ?
         GROUP BY v.id
         ORDER BY v.created_at DESC`
      )
      .all(userId) as VaultSummary[];

    for (const v of rows) {
      v.tokens = await this.listVaultTokens(v.id);
    }

    return rows;
  }

  async deleteVault(vaultId: string): Promise<void> {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM file_records WHERE vault_id = ?').run(vaultId);
      this.db.prepare('DELETE FROM devices WHERE vault_id = ?').run(vaultId);
      this.db.prepare('DELETE FROM auth_tokens WHERE vault_id = ?').run(vaultId);
      this.db.prepare('DELETE FROM commit_receipts WHERE vault_id = ?').run(vaultId);
      this.db.prepare('DELETE FROM initial_sync_locks WHERE vault_id = ?').run(vaultId);
      this.db.prepare('DELETE FROM vaults WHERE id = ?').run(vaultId);
    });
    tx();
  }

  async getChanges(vaultId: string, sinceVersion: number): Promise<FileChange[]> {
    const rows = this.db
      .prepare(
        `SELECT id, encrypted_path as encryptedPath, content_hash as contentHash, size, version, is_deleted as isDeleted, mtime
         FROM file_records
         WHERE vault_id = ? AND version > ?
         ORDER BY version ASC`
      )
      .all(vaultId, sinceVersion) as Array<{
      id: string;
      encryptedPath: string;
      contentHash: string;
      size: number;
      version: number;
      isDeleted: number;
      mtime: number;
    }>;

    return rows.map((r) => ({
      id: r.id,
      encryptedPath: r.encryptedPath,
      contentHash: r.contentHash,
      size: r.size,
      version: r.version,
      isDeleted: r.isDeleted === 1,
      mtime: r.mtime
    }));
  }

  async commitChanges(
    vaultId: string,
    deviceId: string,
    changes: CommitChangeItem[],
    requestId?: string
  ): Promise<CommitResult> {
    const transaction = this.db.transaction(() => {
      if (requestId) {
        const receipt = this.db.prepare(
          'SELECT payload_hash as payloadHash, new_version as newVersion, committed_count as committedCount, changes_json as changesJson FROM commit_receipts WHERE vault_id = ? AND request_id = ?'
        ).get(vaultId, requestId) as
          | { payloadHash: string; newVersion: number; committedCount: number; changesJson: string }
          | undefined;
        if (receipt) {
          const payloadHash = this.getCommitPayloadHash(changes);
          if (receipt.payloadHash !== payloadHash) {
            throw new StorageConflictError('request-id-reuse', 'request-id-reuse');
          }
          return {
            success: true,
            newVersion: receipt.newVersion,
            committedCount: receipt.committedCount,
            requestId,
            replayed: true,
            changes: JSON.parse(receipt.changesJson)
          };
        }
      }

      const vault = this.db
        .prepare('SELECT latest_version FROM vaults WHERE id = ?')
        .get(vaultId) as { latest_version: number } | undefined;

      if (!vault) {
        throw new StorageNotFoundError(`Vault ${vaultId} not found`);
      }

      const newVersion = vault.latest_version + 1;
      this.db
        .prepare('UPDATE vaults SET latest_version = ? WHERE id = ?')
        .run(newVersion, vaultId);

      const now = Date.now();
      const committedChanges: Array<{ id: string; encryptedPath: string }> = [];
      const findByIdStmt = this.db.prepare(
        'SELECT id FROM file_records WHERE vault_id = ? AND id = ?'
      );
      const findByPathStmt = this.db.prepare(
        'SELECT id FROM file_records WHERE vault_id = ? AND encrypted_path = ?'
      );
      const updateStmt = this.db.prepare(
        `UPDATE file_records
         SET encrypted_path = ?, content_hash = ?, size = ?, version = ?, is_deleted = ?, mtime = ?, updated_at = ?
         WHERE id = ?`
      );
      const insertStmt = this.db.prepare(
        `INSERT INTO file_records (id, vault_id, encrypted_path, content_hash, size, version, is_deleted, mtime, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const item of changes) {
        const existingById = item.id
          ? (findByIdStmt.get(vaultId, item.id) as { id: string } | undefined)
          : undefined;
        const existingByPath = findByPathStmt.get(vaultId, item.encryptedPath) as
          | { id: string }
          | undefined;
        const existing = existingById || existingByPath;
        const isDel = item.isDeleted ? 1 : 0;

        if (existingById && existingByPath && existingById.id !== existingByPath.id) {
          throw new StorageConflictError(
            'identity-conflict',
            'File identity conflicts with encrypted path'
          );
        }

        const fileId = existing?.id || item.id || randomUUID();
        committedChanges.push({ id: fileId, encryptedPath: item.encryptedPath });

        if (existing) {
          updateStmt.run(
            item.encryptedPath,
            item.contentHash,
            item.size,
            newVersion,
            isDel,
            item.mtime,
            now,
            existing.id
          );
        } else {
          insertStmt.run(
            fileId,
            vaultId,
            item.encryptedPath,
            item.contentHash,
            item.size,
            newVersion,
            isDel,
            item.mtime,
            now
          );
        }
      }

      const result = {
        success: true,
        newVersion,
        committedCount: changes.length,
        requestId,
        changes: committedChanges
      };
      if (requestId) {
        this.db.prepare(
          'INSERT INTO commit_receipts (vault_id, request_id, payload_hash, new_version, committed_count, changes_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(vaultId, requestId, this.getCommitPayloadHash(changes), newVersion, changes.length, JSON.stringify(committedChanges), now);
      }

      this.db
        .prepare(
          `INSERT INTO devices (id, vault_id, device_name, last_seen)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen`
        )
        .run(deviceId, vaultId, deviceId, now);

      return result;
    });

    return transaction();
  }

  async getVaultActivity(vaultId: string, sinceMs: number): Promise<VaultActivityDay[]> {
    const rows = this.db
      .prepare(
        `SELECT strftime('%Y-%m-%d', updated_at / 1000, 'unixepoch') as day, COUNT(*) as count
         FROM file_records
         WHERE vault_id = ? AND updated_at >= ?
         GROUP BY day
         ORDER BY day ASC`
      )
      .all(vaultId, sinceMs) as Array<{ day: string; count: number }>;
    return rows;
  }

  async acquireInitialSync(vaultId: string, tokenId: string, leaseMs: number): Promise<'acquired' | 'already_initialized' | 'busy'> {
    const now = Date.now();
    return this.db.transaction(() => {
      const vault = this.db.prepare('SELECT latest_version as latestVersion FROM vaults WHERE id = ?').get(vaultId) as { latestVersion: number } | undefined;
      if (!vault) throw new StorageNotFoundError(`Vault ${vaultId} not found`);
      const existing = this.db.prepare('SELECT token_id as tokenId, expires_at as expiresAt FROM initial_sync_locks WHERE vault_id = ?').get(vaultId) as { tokenId: string; expiresAt: number } | undefined;
      if (existing && existing.expiresAt > now && existing.tokenId !== tokenId) return 'busy' as const;
      if (vault.latestVersion > 0 && (!existing || existing.expiresAt <= now)) return 'already_initialized' as const;
      this.db.prepare('INSERT INTO initial_sync_locks (vault_id, token_id, expires_at) VALUES (?, ?, ?) ON CONFLICT(vault_id) DO UPDATE SET token_id = excluded.token_id, expires_at = excluded.expires_at').run(vaultId, tokenId, now + leaseMs);
      return 'acquired' as const;
    })();
  }

  async renewInitialSync(vaultId: string, tokenId: string, leaseMs: number): Promise<boolean> {
    const result = this.db.prepare('UPDATE initial_sync_locks SET expires_at = ? WHERE vault_id = ? AND token_id = ? AND expires_at > ?').run(Date.now() + leaseMs, vaultId, tokenId, Date.now());
    return result.changes === 1;
  }

  async completeInitialSync(vaultId: string, tokenId: string): Promise<void> {
    this.db.prepare('DELETE FROM initial_sync_locks WHERE vault_id = ? AND token_id = ?').run(vaultId, tokenId);
  }

  async canCommitInitialSync(vaultId: string, tokenId: string): Promise<boolean> {
    const vault = this.db.prepare('SELECT latest_version as latestVersion FROM vaults WHERE id = ?').get(vaultId) as { latestVersion: number } | undefined;
    if (!vault) return false;
    const lock = this.db.prepare('SELECT token_id as tokenId, expires_at as expiresAt FROM initial_sync_locks WHERE vault_id = ?').get(vaultId) as { tokenId: string; expiresAt: number } | undefined;
    if (lock && lock.expiresAt > Date.now()) return lock.tokenId === tokenId;
    return vault.latestVersion > 0;
  }

  async listActiveBlobHashes(vaultId: string): Promise<string[]> {
    const rows = this.db
      .prepare(
        'SELECT DISTINCT content_hash as hash FROM file_records WHERE vault_id = ? AND is_deleted = 0'
      )
      .all(vaultId) as Array<{ hash: string }>;
    return rows.map((r) => r.hash);
  }

  // Admin analytics
  async getAdminStats(): Promise<AdminStats> {
    const userCount = (this.db.prepare('SELECT count(*) as c FROM users').get() as { c: number }).c;
    const vaultCount = (this.db.prepare('SELECT count(*) as c FROM vaults').get() as { c: number }).c;
    const fileCount = (
      this.db.prepare('SELECT count(*) as c FROM file_records WHERE is_deleted = 0').get() as { c: number }
    ).c;
    const storageBytes = (
      this.db
        .prepare('SELECT COALESCE(SUM(size), 0) as s FROM file_records WHERE is_deleted = 0')
        .get() as { s: number }
    ).s;

    return {
      totalUsers: userCount,
      totalVaults: vaultCount,
      totalFiles: fileCount,
      totalStorageBytes: storageBytes
    };
  }

  async listAllUsers(): Promise<AdminUserInfo[]> {
    const rows = this.db
      .prepare(
        `SELECT u.id, u.username, COALESCE(u.role, 'user') as role, u.created_at as createdAt,
                COUNT(DISTINCT v.id) as vaultCount,
                COALESCE(SUM(f.size), 0) as totalStorageBytes
         FROM users u
         LEFT JOIN vaults v ON u.id = v.user_id
         LEFT JOIN file_records f ON v.id = f.vault_id AND f.is_deleted = 0
         GROUP BY u.id
         ORDER BY u.created_at DESC`
      )
      .all() as AdminUserInfo[];

    return rows;
  }

  async createDeletionJob(
    resourceType: 'vault' | 'user',
    resourceId: string,
    ownerUserId?: string
  ): Promise<DeletionJob> {
    const jobId = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        'INSERT INTO deletion_jobs (job_id, resource_type, resource_id, owner_user_id, status, attempts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)'
      )
      .run(jobId, resourceType, resourceId, ownerUserId ?? null, 'pending', now, now);
    return {
      jobId,
      resourceType,
      resourceId,
      ownerUserId: ownerUserId ?? null,
      status: 'pending',
      attempts: 0,
      lastError: null,
      createdAt: now,
      updatedAt: now
    };
  }

  async getDeletionJob(jobId: string): Promise<DeletionJob | null> {
    const row = this.db
      .prepare(
        'SELECT job_id as jobId, resource_type as resourceType, resource_id as resourceId, owner_user_id as ownerUserId, status, attempts, last_error as lastError, created_at as createdAt, updated_at as updatedAt FROM deletion_jobs WHERE job_id = ?'
      )
      .get(jobId) as DeletionJob | undefined;
    return row || null;
  }

  async updateDeletionJob(
    jobId: string,
    status: DeletionJobStatus,
    lastError?: string | null
  ): Promise<DeletionJob | null> {
    this.db
      .prepare(
        'UPDATE deletion_jobs SET status = ?, attempts = attempts + 1, last_error = ?, updated_at = ? WHERE job_id = ?'
      )
      .run(status, lastError ?? null, Date.now(), jobId);
    return this.getDeletionJob(jobId);
  }

  async deleteUser(userId: string): Promise<void> {
    const tx = this.db.transaction(() => {
      const vaults = this.db.prepare('SELECT id FROM vaults WHERE user_id = ?').all(userId) as Array<{
        id: string;
      }>;
      for (const v of vaults) {
        this.db.prepare('DELETE FROM file_records WHERE vault_id = ?').run(v.id);
        this.db.prepare('DELETE FROM devices WHERE vault_id = ?').run(v.id);
        this.db.prepare('DELETE FROM commit_receipts WHERE vault_id = ?').run(v.id);
      }
      this.db.prepare('DELETE FROM vaults WHERE user_id = ?').run(userId);
      this.db.prepare('DELETE FROM auth_tokens WHERE user_id = ?').run(userId);
      this.db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    });
    tx();
  }
}
