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

const textEncoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hashTokenSecret(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(token));
  return toHex(new Uint8Array(digest));
}

const COMMIT_CAS_ATTEMPTS = 6;

interface CommitReceiptRow {
  payloadHash: string;
  newVersion: number;
  committedCount: number;
  changesJson: string;
}

export class D1MetadataStore implements IMetadataStore {
  private d1: D1Database;

  constructor(d1: D1Database) {
    this.d1 = d1;
  }

  private async getCommitPayloadHash(changes: CommitChangeItem[]): Promise<string> {
    const data = textEncoder.encode(canonicalCommitPayload(changes));
    const digest = await crypto.subtle.digest('SHA-256', data);
    return toHex(new Uint8Array(digest));
  }

  async init(): Promise<void> {
    const tableStatements = TABLES_SQL.split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const batch = tableStatements.map((sql) => this.d1.prepare(sql));
    if (batch.length > 0) {
      await this.d1.batch(batch);
    }

    try {
      await this.d1.prepare('ALTER TABLE users ADD COLUMN role TEXT DEFAULT "user"').run();
    } catch {}
    try {
      await this.d1.prepare('ALTER TABLE vaults ADD COLUMN user_id TEXT DEFAULT ""').run();
    } catch {}

    await this.migrateLegacyUserTokens();

    const indexStatements = INDEXES_SQL.split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const indexBatch = indexStatements.map((sql) => this.d1.prepare(sql));
    if (indexBatch.length > 0) {
      try {
        await this.d1.batch(indexBatch);
      } catch {}
    }
  }

  /** Upgrades the legacy plaintext user_tokens table into hash-only auth_tokens, then drops it. */
  private async migrateLegacyUserTokens(): Promise<void> {
    let rows: Array<Record<string, unknown>>;
    try {
      // Legacy databases may predate the lifecycle columns; degrade gracefully.
      const res = await this.d1
        .prepare(
          'SELECT token, user_id, vault_id, device_name, token_type, expires_at, revoked_at, revoked_reason, created_at, last_used_at FROM user_tokens'
        )
        .all();
      rows = (res.results || []) as typeof rows;
    } catch {
      try {
        const res = await this.d1
          .prepare('SELECT token, user_id, vault_id, device_name, created_at, last_used_at FROM user_tokens')
          .all();
        rows = (res.results || []) as typeof rows;
      } catch {
        return; // legacy table absent on fresh installs
      }
    }

    const stmts: D1PreparedStatement[] = [];
    for (const row of rows) {
      const token = row.token as string | null;
      if (!token) continue;
      const vaultId = (row.vault_id as string | null) || '';
      const rawType = row.token_type as string | null;
      const tokenType = rawType === 'master' || rawType === 'device' ? rawType : vaultId ? 'device' : 'master';
      // Legacy rows either had no expiry column or a placeholder value; only a
      // genuinely future expiry is kept, otherwise the token gets a fresh window.
      const legacyExpiry = (row.expires_at as number | null | undefined) ?? null;
      const expiresAt = legacyExpiry !== null && legacyExpiry > Date.now() ? legacyExpiry : tokenExpiry(tokenType);
      stmts.push(
        this.d1
          .prepare(
            'INSERT OR IGNORE INTO auth_tokens (token_id, user_id, vault_id, device_name, token_hash, token_type, expires_at, revoked_at, revoked_reason, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
          )
          .bind(
            crypto.randomUUID(),
            row.user_id as string,
            vaultId,
            (row.device_name as string) || 'Device',
            await hashTokenSecret(token),
            tokenType,
            expiresAt,
            (row.revoked_at as number | null | undefined) ?? null,
            (row.revoked_reason as string | null | undefined) ?? null,
            (row.created_at as number | null | undefined) ?? Date.now(),
            (row.last_used_at as number | null | undefined) ?? Date.now()
          )
      );
    }
    stmts.push(this.d1.prepare('DROP TABLE user_tokens'));
    await this.d1.batch(stmts);
  }

  // User management
  async createUser(
    username: string,
    passwordHash: string,
    salt: string,
    role: 'admin' | 'user' = 'user'
  ): Promise<User> {
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    await this.d1
      .prepare(
        'INSERT INTO users (id, username, password_hash, salt, role, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .bind(id, username, passwordHash, salt, role, createdAt)
      .run();

    return { id, username, role, createdAt };
  }

  async getUserByUsername(username: string): Promise<UserWithSecret | null> {
    const row = await this.d1
      .prepare(
        'SELECT id, username, password_hash as passwordHash, salt, role, created_at as createdAt FROM users WHERE username = ?'
      )
      .bind(username)
      .first<UserWithSecret>();

    return row || null;
  }

  async getUserById(id: string): Promise<User | null> {
    const row = await this.d1
      .prepare('SELECT id, username, role, created_at as createdAt FROM users WHERE id = ?')
      .bind(id)
      .first<User>();

    return row || null;
  }

  async updateUserPassword(
    id: string,
    passwordHash: string,
    salt: string,
    role?: 'admin' | 'user'
  ): Promise<void> {
    if (role) {
      await this.d1
        .prepare('UPDATE users SET password_hash = ?, salt = ?, role = ? WHERE id = ?')
        .bind(passwordHash, salt, role, id)
        .run();
    } else {
      await this.d1
        .prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?')
        .bind(passwordHash, salt, id)
        .run();
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
    await this.d1
      .prepare(
        'INSERT INTO auth_tokens (token_id, user_id, vault_id, device_name, token_hash, token_type, expires_at, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(crypto.randomUUID(), userId, vaultId, deviceName, await hashTokenSecret(token), tokenType, tokenExpiry(tokenType, options), now, now)
      .run();

    return token;
  }

  async verifyToken(token: string): Promise<TokenValidationResult | null> {
    const row = await this.d1
      .prepare(TOKEN_SESSION_SQL)
      .bind(await hashTokenSecret(token), Date.now())
      .first<any>();

    if (row && row.v_id) {
      await this.d1
        .prepare('UPDATE auth_tokens SET last_used_at = ? WHERE token_id = ?')
        .bind(Date.now(), row.t_token_id)
        .run();

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
    const row = await this.d1
      .prepare(MASTER_TOKEN_SQL)
      .bind(await hashTokenSecret(token), Date.now())
      .first<User>();

    if (row) {
      await this.d1
        .prepare('UPDATE auth_tokens SET last_used_at = ? WHERE token_hash = ?')
        .bind(Date.now(), await hashTokenSecret(token))
        .run();
      return row;
    }

    return null;
  }

  async getTokenById(tokenId: string): Promise<UserToken | null> {
    const row = await this.d1
      .prepare(`SELECT ${AUTH_TOKEN_SELECT} FROM auth_tokens WHERE token_id = ?`)
      .bind(tokenId)
      .first<UserToken>();
    return row || null;
  }

  async isTokenActive(tokenId: string): Promise<boolean> {
    const row = await this.d1
      .prepare(
        'SELECT 1 as active FROM auth_tokens WHERE token_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)'
      )
      .bind(tokenId, Date.now())
      .first<{ active: number }>();
    return Boolean(row);
  }

  async updateToken(tokenId: string, deviceName: string): Promise<void> {
    await this.d1
      .prepare('UPDATE auth_tokens SET device_name = ? WHERE token_id = ?')
      .bind(deviceName, tokenId)
      .run();
  }

  async rotateToken(tokenId: string): Promise<string | null> {
    const existing = await this.getTokenById(tokenId);
    if (!existing) return null;

    const tokenType = existing.tokenType === 'master' ? 'master' : 'device';
    const newToken = newTokenSecret();
    const now = Date.now();
    await this.d1
      .prepare(
        'UPDATE auth_tokens SET token_hash = ?, expires_at = ?, revoked_at = NULL, revoked_reason = NULL, created_at = ?, last_used_at = ? WHERE token_id = ?'
      )
      .bind(await hashTokenSecret(newToken), tokenExpiry(tokenType), now, now, tokenId)
      .run();
    return newToken;
  }

  async deleteToken(tokenId: string): Promise<void> {
    await this.d1
      .prepare('UPDATE auth_tokens SET revoked_at = ?, revoked_reason = ? WHERE token_id = ?')
      .bind(Date.now(), 'user_requested', tokenId)
      .run();
  }

  async listUserTokens(userId: string): Promise<UserToken[]> {
    const res = await this.d1
      .prepare(`SELECT ${AUTH_TOKEN_SELECT} FROM auth_tokens WHERE user_id = ? ORDER BY last_used_at DESC`)
      .bind(userId)
      .all<UserToken>();

    return res.results || [];
  }

  async listVaultTokens(vaultId: string): Promise<UserToken[]> {
    const res = await this.d1
      .prepare(`SELECT ${AUTH_TOKEN_SELECT} FROM auth_tokens WHERE vault_id = ? ORDER BY last_used_at DESC`)
      .bind(vaultId)
      .all<UserToken>();

    return res.results || [];
  }

  // Vault management
  async getVault(vaultId: string): Promise<Vault | null> {
    const row = await this.d1
      .prepare(
        'SELECT id, user_id as userId, name, salt, latest_version as latestVersion, created_at as createdAt FROM vaults WHERE id = ?'
      )
      .bind(vaultId)
      .first<Vault>();

    return row || null;
  }

  async createVault(vault: { id: string; userId: string; name: string; salt: string }): Promise<Vault> {
    const createdAt = Date.now();
    await this.d1
      .prepare(
        'INSERT INTO vaults (id, user_id, name, salt, latest_version, created_at) VALUES (?, ?, ?, ?, 0, ?)'
      )
      .bind(vault.id, vault.userId, vault.name, vault.salt, createdAt)
      .run();

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
    const res = await this.d1
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
      .bind(userId)
      .all<VaultSummary>();

    const vaults = res.results || [];
    for (const v of vaults) {
      v.tokens = await this.listVaultTokens(v.id);
    }

    return vaults;
  }

  async deleteVault(vaultId: string): Promise<void> {
    await this.d1.batch([
      this.d1.prepare('DELETE FROM file_records WHERE vault_id = ?').bind(vaultId),
      this.d1.prepare('DELETE FROM devices WHERE vault_id = ?').bind(vaultId),
      this.d1.prepare('DELETE FROM auth_tokens WHERE vault_id = ?').bind(vaultId),
      this.d1.prepare('DELETE FROM commit_receipts WHERE vault_id = ?').bind(vaultId),
      this.d1.prepare('DELETE FROM initial_sync_locks WHERE vault_id = ?').bind(vaultId),
      this.d1.prepare('DELETE FROM vaults WHERE id = ?').bind(vaultId)
    ]);
  }

  async getChanges(vaultId: string, sinceVersion: number): Promise<FileChange[]> {
    const results = await this.d1
      .prepare(
        `SELECT id, encrypted_path as encryptedPath, content_hash as contentHash, size, version, is_deleted as isDeleted, mtime
         FROM file_records
         WHERE vault_id = ? AND version > ?
         ORDER BY version ASC`
      )
      .bind(vaultId, sinceVersion)
      .all<{
        id: string;
        encryptedPath: string;
        contentHash: string;
        size: number;
        version: number;
        isDeleted: number;
        mtime: number;
      }>();

    return (results.results || []).map((r) => ({
      id: r.id,
      encryptedPath: r.encryptedPath,
      contentHash: r.contentHash,
      size: r.size,
      version: r.version,
      isDeleted: r.isDeleted === 1,
      mtime: r.mtime
    }));
  }

  private async readReceipt(vaultId: string, requestId: string): Promise<CommitReceiptRow | null> {
    const receipt = await this.d1
      .prepare(
        'SELECT payload_hash as payloadHash, new_version as newVersion, committed_count as committedCount, changes_json as changesJson FROM commit_receipts WHERE vault_id = ? AND request_id = ?'
      )
      .bind(vaultId, requestId)
      .first<CommitReceiptRow>();
    return receipt || null;
  }

  async commitChanges(
    vaultId: string,
    deviceId: string,
    changes: CommitChangeItem[],
    requestId?: string
  ): Promise<CommitResult> {
    const payloadHash = await this.getCommitPayloadHash(changes);

    if (requestId) {
      const receipt = await this.readReceipt(vaultId, requestId);
      if (receipt) {
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

    // CAS loop: the first batch statement only succeeds when latest_version is still
    // the value we read, so version allocation is atomic under concurrency.
    for (let attempt = 0; attempt < COMMIT_CAS_ATTEMPTS; attempt++) {
      const vault = await this.d1
        .prepare('SELECT latest_version FROM vaults WHERE id = ?')
        .bind(vaultId)
        .first<{ latest_version: number }>();

      if (!vault) {
        throw new StorageNotFoundError(`Vault ${vaultId} not found`);
      }

      const expectedVersion = vault.latest_version;
      const newVersion = expectedVersion + 1;
      const now = Date.now();
      const committedChanges: Array<{ id: string; encryptedPath: string }> = [];

      const stmts: D1PreparedStatement[] = [
        this.d1
          .prepare('UPDATE vaults SET latest_version = ? WHERE id = ? AND latest_version = ?')
          .bind(newVersion, vaultId, expectedVersion)
      ];

      for (const item of changes) {
        const existingById = item.id
          ? await this.d1
              .prepare('SELECT id FROM file_records WHERE vault_id = ? AND id = ?')
              .bind(vaultId, item.id)
              .first<{ id: string }>()
          : null;
        const existingByPath = await this.d1
          .prepare('SELECT id FROM file_records WHERE vault_id = ? AND encrypted_path = ?')
          .bind(vaultId, item.encryptedPath)
          .first<{ id: string }>();

        if (existingById && existingByPath && existingById.id !== existingByPath.id) {
          throw new StorageConflictError(
            'identity-conflict',
            'File identity conflicts with encrypted path'
          );
        }

        const existing = existingById || existingByPath;
        const fileId = existing?.id || item.id || crypto.randomUUID();
        const isDel = item.isDeleted ? 1 : 0;
        committedChanges.push({ id: fileId, encryptedPath: item.encryptedPath });

        if (existing) {
          stmts.push(
            this.d1
              .prepare(
                `UPDATE file_records
                 SET encrypted_path = ?, content_hash = ?, size = ?, version = ?, is_deleted = ?, mtime = ?, updated_at = ?
                 WHERE id = ?`
              )
              .bind(item.encryptedPath, item.contentHash, item.size, newVersion, isDel, item.mtime, now, existing.id)
          );
        } else {
          stmts.push(
            this.d1
              .prepare(
                `INSERT INTO file_records (id, vault_id, encrypted_path, content_hash, size, version, is_deleted, mtime, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
              )
              .bind(fileId, vaultId, item.encryptedPath, item.contentHash, item.size, newVersion, isDel, item.mtime, now)
          );
        }
      }

      if (requestId) {
        stmts.push(
          this.d1
            .prepare(
              'INSERT INTO commit_receipts (vault_id, request_id, payload_hash, new_version, committed_count, changes_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
            )
            .bind(vaultId, requestId, payloadHash, newVersion, changes.length, JSON.stringify(committedChanges), now)
        );
      }

      stmts.push(
        this.d1
          .prepare(
            `INSERT INTO devices (id, vault_id, device_name, last_seen)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen`
          )
          .bind(deviceId, vaultId, deviceId, now)
      );

      let results: D1Result[];
      try {
        results = await this.d1.batch(stmts);
      } catch (err: any) {
        const message = String(err?.message || err);
        if (requestId && message.includes('commit_receipts')) {
          // A concurrent request with the same requestId won the insert; replay it.
          const receipt = await this.readReceipt(vaultId, requestId);
          if (receipt) {
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
        if (message.includes('file_records')) {
          throw new StorageConflictError(
            'identity-conflict',
            'File identity conflicts with an existing record'
          );
        }
        throw err;
      }

      if ((results[0]?.meta?.changes ?? 0) === 1) {
        return {
          success: true,
          newVersion,
          committedCount: changes.length,
          requestId,
          changes: committedChanges
        };
      }
      // CAS lost the race; retry against the new latest_version
    }

    throw new StorageConflictError(
      'version-conflict',
      'Concurrent commits prevented version allocation; please retry'
    );
  }

  async getVaultActivity(vaultId: string, sinceMs: number): Promise<VaultActivityDay[]> {
    const res = await this.d1
      .prepare(
        `SELECT strftime('%Y-%m-%d', updated_at / 1000, 'unixepoch') as day, COUNT(*) as count
         FROM file_records
         WHERE vault_id = ? AND updated_at >= ?
         GROUP BY day
         ORDER BY day ASC`
      )
      .bind(vaultId, sinceMs)
      .all<VaultActivityDay>();
    return res.results || [];
  }

  async acquireInitialSync(vaultId: string, tokenId: string, leaseMs: number): Promise<'acquired' | 'already_initialized' | 'busy'> {
    const vault = await this.d1.prepare('SELECT latest_version as latestVersion FROM vaults WHERE id = ?').bind(vaultId).first<{ latestVersion: number }>();
    if (!vault) throw new StorageNotFoundError(`Vault ${vaultId} not found`);
    const now = Date.now();
    const lock = await this.d1.prepare('SELECT token_id as tokenId, expires_at as expiresAt FROM initial_sync_locks WHERE vault_id = ?').bind(vaultId).first<{ tokenId: string; expiresAt: number }>();
    if (lock && lock.expiresAt > now && lock.tokenId !== tokenId) return 'busy';
    if (vault.latestVersion > 0 && (!lock || lock.expiresAt <= now)) return 'already_initialized';
    const result = await this.d1.prepare(
      `INSERT INTO initial_sync_locks (vault_id, token_id, expires_at)
       VALUES (?, ?, ?)
       ON CONFLICT(vault_id) DO UPDATE SET token_id = excluded.token_id, expires_at = excluded.expires_at
       WHERE initial_sync_locks.expires_at <= ? OR initial_sync_locks.token_id = ?`
    ).bind(vaultId, tokenId, now + leaseMs, now, tokenId).run();
    return (result.meta?.changes || 0) === 1 ? 'acquired' : 'busy';
  }

  async renewInitialSync(vaultId: string, tokenId: string, leaseMs: number): Promise<boolean> {
    const result = await this.d1.prepare('UPDATE initial_sync_locks SET expires_at = ? WHERE vault_id = ? AND token_id = ? AND expires_at > ?').bind(Date.now() + leaseMs, vaultId, tokenId, Date.now()).run();
    return (result.meta?.changes || 0) === 1;
  }

  async completeInitialSync(vaultId: string, tokenId: string): Promise<void> {
    await this.d1.prepare('DELETE FROM initial_sync_locks WHERE vault_id = ? AND token_id = ?').bind(vaultId, tokenId).run();
  }

  async canCommitInitialSync(vaultId: string, tokenId: string): Promise<boolean> {
    const vault = await this.d1.prepare('SELECT latest_version as latestVersion FROM vaults WHERE id = ?').bind(vaultId).first<{ latestVersion: number }>();
    if (!vault) return false;
    const lock = await this.d1.prepare('SELECT token_id as tokenId, expires_at as expiresAt FROM initial_sync_locks WHERE vault_id = ?').bind(vaultId).first<{ tokenId: string; expiresAt: number }>();
    if (lock && lock.expiresAt > Date.now()) return lock.tokenId === tokenId;
    return vault.latestVersion > 0;
  }

  async listActiveBlobHashes(vaultId: string): Promise<string[]> {
    const res = await this.d1
      .prepare(
        'SELECT DISTINCT content_hash as hash FROM file_records WHERE vault_id = ? AND is_deleted = 0'
      )
      .bind(vaultId)
      .all<{ hash: string }>();
    return (res.results || []).map((r) => r.hash);
  }

  // Admin analytics
  async getAdminStats(): Promise<AdminStats> {
    const userRes = await this.d1.prepare('SELECT count(*) as c FROM users').first<{ c: number }>();
    const vaultRes = await this.d1.prepare('SELECT count(*) as c FROM vaults').first<{ c: number }>();
    const fileRes = await this.d1
      .prepare('SELECT count(*) as c FROM file_records WHERE is_deleted = 0')
      .first<{ c: number }>();
    const storageRes = await this.d1
      .prepare('SELECT COALESCE(SUM(size), 0) as s FROM file_records WHERE is_deleted = 0')
      .first<{ s: number }>();

    return {
      totalUsers: userRes?.c || 0,
      totalVaults: vaultRes?.c || 0,
      totalFiles: fileRes?.c || 0,
      totalStorageBytes: storageRes?.s || 0
    };
  }

  async listAllUsers(): Promise<AdminUserInfo[]> {
    const res = await this.d1
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
      .all<AdminUserInfo>();

    return res.results || [];
  }

  async createDeletionJob(
    resourceType: 'vault' | 'user',
    resourceId: string,
    ownerUserId?: string
  ): Promise<DeletionJob> {
    const jobId = crypto.randomUUID();
    const now = Date.now();
    await this.d1
      .prepare(
        'INSERT INTO deletion_jobs (job_id, resource_type, resource_id, owner_user_id, status, attempts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)'
      )
      .bind(jobId, resourceType, resourceId, ownerUserId ?? null, 'pending', now, now)
      .run();
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
    const row = await this.d1
      .prepare(
        'SELECT job_id as jobId, resource_type as resourceType, resource_id as resourceId, owner_user_id as ownerUserId, status, attempts, last_error as lastError, created_at as createdAt, updated_at as updatedAt FROM deletion_jobs WHERE job_id = ?'
      )
      .bind(jobId)
      .first<DeletionJob>();
    return row || null;
  }

  async updateDeletionJob(
    jobId: string,
    status: DeletionJobStatus,
    lastError?: string | null
  ): Promise<DeletionJob | null> {
    await this.d1
      .prepare(
        'UPDATE deletion_jobs SET status = ?, attempts = attempts + 1, last_error = ?, updated_at = ? WHERE job_id = ?'
      )
      .bind(status, lastError ?? null, Date.now(), jobId)
      .run();
    return this.getDeletionJob(jobId);
  }

  async deleteUser(userId: string): Promise<void> {
    const vaultsRes = await this.d1
      .prepare('SELECT id FROM vaults WHERE user_id = ?')
      .bind(userId)
      .all<{ id: string }>();

    const stmts: D1PreparedStatement[] = [];
    for (const v of vaultsRes.results || []) {
      stmts.push(this.d1.prepare('DELETE FROM file_records WHERE vault_id = ?').bind(v.id));
      stmts.push(this.d1.prepare('DELETE FROM devices WHERE vault_id = ?').bind(v.id));
      stmts.push(this.d1.prepare('DELETE FROM commit_receipts WHERE vault_id = ?').bind(v.id));
    }
    stmts.push(this.d1.prepare('DELETE FROM vaults WHERE user_id = ?').bind(userId));
    stmts.push(this.d1.prepare('DELETE FROM auth_tokens WHERE user_id = ?').bind(userId));
    stmts.push(this.d1.prepare('DELETE FROM users WHERE id = ?').bind(userId));

    if (stmts.length > 0) {
      await this.d1.batch(stmts);
    }
  }
}
