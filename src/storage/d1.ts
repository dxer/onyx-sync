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

export class D1MetadataStore implements IMetadataStore {
  private d1: D1Database;

  constructor(d1: D1Database) {
    this.d1 = d1;
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
    try {
      await this.d1.prepare('ALTER TABLE user_tokens ADD COLUMN vault_id TEXT DEFAULT ""').run();
    } catch {}

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

  async createToken(userId: string, vaultId: string, deviceName: string): Promise<string> {
    const token = `ost_${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`;
    const now = Date.now();
    await this.d1
      .prepare(
        'INSERT INTO user_tokens (token, user_id, vault_id, device_name, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .bind(token, userId, vaultId, deviceName, now, now)
      .run();

    return token;
  }

  async verifyToken(token: string): Promise<TokenValidationResult | null> {
    const row = await this.d1
      .prepare(
        `SELECT u.id as u_id, u.username as u_username, u.role as u_role, u.created_at as u_created_at,
                t.token, t.user_id as t_user_id, t.vault_id as t_vault_id, t.device_name as t_device_name, t.created_at as t_created_at, t.last_used_at as t_last_used_at,
                v.id as v_id, v.user_id as v_user_id, v.name as v_name, v.salt as v_salt, v.latest_version as v_latest_version, v.created_at as v_created_at
         FROM user_tokens t
         JOIN users u ON t.user_id = u.id
         LEFT JOIN vaults v ON t.vault_id = v.id
         WHERE t.token = ?`
      )
      .bind(token)
      .first<any>();

    if (row && row.v_id) {
      await this.d1
        .prepare('UPDATE user_tokens SET last_used_at = ? WHERE token = ?')
        .bind(Date.now(), token)
        .run();

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
    const row = await this.d1
      .prepare(
        `SELECT u.id, u.username, u.role, u.created_at as createdAt 
         FROM user_tokens t 
         JOIN users u ON t.user_id = u.id 
         WHERE t.token = ?`
      )
      .bind(token)
      .first<User>();

    if (row) {
      await this.d1
        .prepare('UPDATE user_tokens SET last_used_at = ? WHERE token = ?')
        .bind(Date.now(), token)
        .run();
      return row;
    }

    return null;
  }

  async getToken(token: string): Promise<UserToken | null> {
    const row = await this.d1
      .prepare(
        `SELECT token, user_id as userId, vault_id as vaultId, device_name as deviceName, created_at as createdAt, last_used_at as lastUsedAt 
         FROM user_tokens WHERE token = ?`
      )
      .bind(token)
      .first<UserToken>();
    return row || null;
  }

  async updateToken(token: string, deviceName: string): Promise<void> {
    await this.d1
      .prepare('UPDATE user_tokens SET device_name = ? WHERE token = ?')
      .bind(deviceName, token)
      .run();
  }

  async rotateToken(oldToken: string): Promise<string | null> {
    const existing = await this.getToken(oldToken);
    if (!existing) return null;

    const newToken = `ost_${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`;
    const now = Date.now();
    await this.d1.batch([
      this.d1.prepare('DELETE FROM user_tokens WHERE token = ?').bind(oldToken),
      this.d1
        .prepare(
          'INSERT INTO user_tokens (token, user_id, vault_id, device_name, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .bind(newToken, existing.userId, existing.vaultId, existing.deviceName, now, now)
    ]);
    return newToken;
  }

  async deleteToken(token: string): Promise<void> {
    await this.d1.prepare('DELETE FROM user_tokens WHERE token = ?').bind(token).run();
  }

  async listUserTokens(userId: string): Promise<UserToken[]> {
    const res = await this.d1
      .prepare(
        `SELECT token, user_id as userId, vault_id as vaultId, device_name as deviceName, created_at as createdAt, last_used_at as lastUsedAt 
         FROM user_tokens 
         WHERE user_id = ? 
         ORDER BY last_used_at DESC`
      )
      .bind(userId)
      .all<UserToken>();

    return res.results || [];
  }

  async listVaultTokens(vaultId: string): Promise<UserToken[]> {
    const res = await this.d1
      .prepare(
        `SELECT token, user_id as userId, vault_id as vaultId, device_name as deviceName, created_at as createdAt, last_used_at as lastUsedAt 
         FROM user_tokens 
         WHERE vault_id = ? 
         ORDER BY last_used_at DESC`
      )
      .bind(vaultId)
      .all<UserToken>();

    return res.results || [];
  }

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
      this.d1.prepare('DELETE FROM user_tokens WHERE vault_id = ?').bind(vaultId),
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

  async commitChanges(
    vaultId: string,
    deviceId: string,
    changes: CommitChangeItem[]
  ): Promise<CommitResult> {
    const vault = await this.d1
      .prepare('SELECT latest_version FROM vaults WHERE id = ?')
      .bind(vaultId)
      .first<{ latest_version: number }>();

    if (!vault) {
      throw new Error(`Vault ${vaultId} not found`);
    }

    const newVersion = vault.latest_version + 1;
    const now = Date.now();
    const batchStatements: D1PreparedStatement[] = [];

    batchStatements.push(
      this.d1
        .prepare('UPDATE vaults SET latest_version = ? WHERE id = ?')
        .bind(newVersion, vaultId)
    );

    for (const item of changes) {
      const existing = await this.d1
        .prepare('SELECT id FROM file_records WHERE vault_id = ? AND encrypted_path = ?')
        .bind(vaultId, item.encryptedPath)
        .first<{ id: string }>();

      const isDel = item.isDeleted ? 1 : 0;

      if (existing) {
        batchStatements.push(
          this.d1
            .prepare(
              `UPDATE file_records 
               SET content_hash = ?, size = ?, version = ?, is_deleted = ?, mtime = ?, updated_at = ? 
               WHERE id = ?`
            )
            .bind(item.contentHash, item.size, newVersion, isDel, item.mtime, now, existing.id)
        );
      } else {
        const fileId = item.id || crypto.randomUUID();
        batchStatements.push(
          this.d1
            .prepare(
              `INSERT INTO file_records (id, vault_id, encrypted_path, content_hash, size, version, is_deleted, mtime, updated_at) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .bind(fileId, vaultId, item.encryptedPath, item.contentHash, item.size, newVersion, isDel, item.mtime, now)
        );
      }
    }

    batchStatements.push(
      this.d1
        .prepare(
          `INSERT INTO devices (id, vault_id, device_name, last_seen) 
           VALUES (?, ?, ?, ?) 
           ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen`
        )
        .bind(deviceId, vaultId, deviceId, now)
    );

    await this.d1.batch(batchStatements);

    return {
      success: true,
      newVersion,
      committedCount: changes.length
    };
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

  async deleteUser(userId: string): Promise<void> {
    const vaultsRes = await this.d1
      .prepare('SELECT id FROM vaults WHERE user_id = ?')
      .bind(userId)
      .all<{ id: string }>();

    const stmts: D1PreparedStatement[] = [];
    for (const v of vaultsRes.results || []) {
      stmts.push(this.d1.prepare('DELETE FROM file_records WHERE vault_id = ?').bind(v.id));
      stmts.push(this.d1.prepare('DELETE FROM devices WHERE vault_id = ?').bind(v.id));
    }
    stmts.push(this.d1.prepare('DELETE FROM vaults WHERE user_id = ?').bind(userId));
    stmts.push(this.d1.prepare('DELETE FROM user_tokens WHERE user_id = ?').bind(userId));
    stmts.push(this.d1.prepare('DELETE FROM users WHERE id = ?').bind(userId));

    if (stmts.length > 0) {
      await this.d1.batch(stmts);
    }
  }
}
