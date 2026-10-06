import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
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
import type { IMetadataStore, UserWithSecret, TokenValidationResult } from './types';
import { TABLES_SQL, INDEXES_SQL } from './sqlite-common';

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
      const tokenCols = this.db.prepare('PRAGMA table_info(user_tokens)').all().map((c: any) => c.name);
      if (!tokenCols.includes('vault_id')) {
        this.db.exec('ALTER TABLE user_tokens ADD COLUMN vault_id TEXT DEFAULT ""');
      }
    } catch {
      // ignore
    }

    // Safely create indexes after columns exist
    try {
      this.db.exec(INDEXES_SQL);
    } catch {
      // ignore
    }
  }

  close(): void {
    this.db.close();
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

  // Token management
  async createToken(userId: string, vaultId: string, deviceName: string): Promise<string> {
    const token = `ost_${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '')}`;
    const now = Date.now();
    this.db
      .prepare(
        'INSERT INTO user_tokens (token, user_id, vault_id, device_name, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(token, userId, vaultId, deviceName, now, now);

    return token;
  }

  async verifyToken(token: string): Promise<TokenValidationResult | null> {
    const row = this.db
      .prepare(
        `SELECT u.id as u_id, u.username as u_username, u.role as u_role, u.created_at as u_created_at,
                t.token, t.user_id as t_user_id, t.vault_id as t_vault_id, t.device_name as t_device_name, t.created_at as t_created_at, t.last_used_at as t_last_used_at,
                v.id as v_id, v.user_id as v_user_id, v.name as v_name, v.salt as v_salt, v.latest_version as v_latest_version, v.created_at as v_created_at
         FROM user_tokens t
         JOIN users u ON t.user_id = u.id
         LEFT JOIN vaults v ON t.vault_id = v.id
         WHERE t.token = ?`
      )
      .get(token) as any;

    if (row && row.v_id) {
      this.db
        .prepare('UPDATE user_tokens SET last_used_at = ? WHERE token = ?')
        .run(Date.now(), token);

      return {
        user: {
          id: row.u_id,
          username: row.u_username,
          role: row.u_role,
          createdAt: row.u_created_at
        },
        tokenInfo: {
          token: row.token,
          userId: row.t_user_id,
          vaultId: row.t_vault_id,
          deviceName: row.t_device_name,
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
      .prepare(
        `SELECT u.id, u.username, u.role, u.created_at as createdAt 
         FROM user_tokens t 
         JOIN users u ON t.user_id = u.id 
         WHERE t.token = ?`
      )
      .get(token) as User | undefined;

    if (row) {
      this.db
        .prepare('UPDATE user_tokens SET last_used_at = ? WHERE token = ?')
        .run(Date.now(), token);
      return row;
    }

    return null;
  }

  async getToken(token: string): Promise<UserToken | null> {
    const row = this.db
      .prepare(
        `SELECT token, user_id as userId, vault_id as vaultId, device_name as deviceName, created_at as createdAt, last_used_at as lastUsedAt 
         FROM user_tokens WHERE token = ?`
      )
      .get(token) as UserToken | undefined;
    return row || null;
  }

  async updateToken(token: string, deviceName: string): Promise<void> {
    this.db.prepare('UPDATE user_tokens SET device_name = ? WHERE token = ?').run(deviceName, token);
  }

  async rotateToken(oldToken: string): Promise<string | null> {
    const existing = await this.getToken(oldToken);
    if (!existing) return null;

    const newToken = `ost_${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '')}`;
    const now = Date.now();
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM user_tokens WHERE token = ?').run(oldToken);
      this.db
        .prepare(
          'INSERT INTO user_tokens (token, user_id, vault_id, device_name, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(newToken, existing.userId, existing.vaultId, existing.deviceName, now, now);
    });
    tx();
    return newToken;
  }

  async deleteToken(token: string): Promise<void> {
    this.db.prepare('DELETE FROM user_tokens WHERE token = ?').run(token);
  }

  async listUserTokens(userId: string): Promise<UserToken[]> {
    const rows = this.db
      .prepare(
        `SELECT token, user_id as userId, vault_id as vaultId, device_name as deviceName, created_at as createdAt, last_used_at as lastUsedAt 
         FROM user_tokens 
         WHERE user_id = ? 
         ORDER BY last_used_at DESC`
      )
      .all(userId) as UserToken[];

    return rows;
  }

  async listVaultTokens(vaultId: string): Promise<UserToken[]> {
    const rows = this.db
      .prepare(
        `SELECT token, user_id as userId, vault_id as vaultId, device_name as deviceName, created_at as createdAt, last_used_at as lastUsedAt 
         FROM user_tokens 
         WHERE vault_id = ? 
         ORDER BY last_used_at DESC`
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
      this.db.prepare('DELETE FROM user_tokens WHERE vault_id = ?').run(vaultId);
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
    changes: CommitChangeItem[]
  ): Promise<CommitResult> {
    const transaction = this.db.transaction(() => {
      const vault = this.db
        .prepare('SELECT latest_version FROM vaults WHERE id = ?')
        .get(vaultId) as { latest_version: number } | undefined;

      if (!vault) {
        throw new Error(`Vault ${vaultId} not found`);
      }

      const newVersion = vault.latest_version + 1;
      this.db
        .prepare('UPDATE vaults SET latest_version = ? WHERE id = ?')
        .run(newVersion, vaultId);

      const now = Date.now();
      const findExistingStmt = this.db.prepare(
        'SELECT id FROM file_records WHERE vault_id = ? AND encrypted_path = ?'
      );
      const updateStmt = this.db.prepare(
        `UPDATE file_records 
         SET content_hash = ?, size = ?, version = ?, is_deleted = ?, mtime = ?, updated_at = ? 
         WHERE id = ?`
      );
      const insertStmt = this.db.prepare(
        `INSERT INTO file_records (id, vault_id, encrypted_path, content_hash, size, version, is_deleted, mtime, updated_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const item of changes) {
        const existing = findExistingStmt.get(vaultId, item.encryptedPath) as { id: string } | undefined;
        const isDel = item.isDeleted ? 1 : 0;

        if (existing) {
          updateStmt.run(
            item.contentHash,
            item.size,
            newVersion,
            isDel,
            item.mtime,
            now,
            existing.id
          );
        } else {
          const fileId = item.id || randomUUID();
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

      this.db
        .prepare(
          `INSERT INTO devices (id, vault_id, device_name, last_seen) 
           VALUES (?, ?, ?, ?) 
           ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen`
        )
        .run(deviceId, vaultId, deviceId, now);

      return {
        success: true,
        newVersion,
        committedCount: changes.length
      };
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

  async deleteUser(userId: string): Promise<void> {
    const tx = this.db.transaction(() => {
      const vaults = this.db.prepare('SELECT id FROM vaults WHERE user_id = ?').all(userId) as Array<{
        id: string;
      }>;
      for (const v of vaults) {
        this.db.prepare('DELETE FROM file_records WHERE vault_id = ?').run(v.id);
        this.db.prepare('DELETE FROM devices WHERE vault_id = ?').run(v.id);
      }
      this.db.prepare('DELETE FROM vaults WHERE user_id = ?').run(userId);
      this.db.prepare('DELETE FROM user_tokens WHERE user_id = ?').run(userId);
      this.db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    });
    tx();
  }
}
