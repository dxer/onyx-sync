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

export interface UserWithSecret extends User {
  passwordHash: string;
  salt: string;
}

export interface TokenValidationResult {
  user: User;
  tokenInfo: UserToken;
  vault: Vault;
}

export interface IMetadataStore {
  init(): Promise<void>;

  // User management
  createUser(username: string, passwordHash: string, salt: string, role?: 'admin' | 'user'): Promise<User>;
  getUserByUsername(username: string): Promise<UserWithSecret | null>;
  getUserById(id: string): Promise<User | null>;
  updateUserPassword(id: string, passwordHash: string, salt: string, role?: 'admin' | 'user'): Promise<void>;

  // Token management
  createToken(userId: string, vaultId: string, deviceName: string): Promise<string>;
  verifyToken(token: string): Promise<TokenValidationResult | null>;
  verifyUserMasterToken(token: string): Promise<User | null>;
  getToken(token: string): Promise<UserToken | null>;
  updateToken(token: string, deviceName: string): Promise<void>;
  rotateToken(token: string): Promise<string | null>;
  deleteToken(token: string): Promise<void>;
  listUserTokens(userId: string): Promise<UserToken[]>;
  listVaultTokens(vaultId: string): Promise<UserToken[]>;

  // Vault management
  getVault(vaultId: string): Promise<Vault | null>;
  createVault(vault: { id: string; userId: string; name: string; salt: string }): Promise<Vault>;
  listUserVaults(userId: string): Promise<VaultSummary[]>;
  deleteVault(vaultId: string): Promise<void>;
  getChanges(vaultId: string, sinceVersion: number): Promise<FileChange[]>;
  commitChanges(vaultId: string, deviceId: string, changes: CommitChangeItem[]): Promise<CommitResult>;
  getVaultActivity(vaultId: string, sinceMs: number): Promise<VaultActivityDay[]>;

  // Admin management
  getAdminStats(): Promise<AdminStats>;
  listAllUsers(): Promise<AdminUserInfo[]>;
  deleteUser(userId: string): Promise<void>;
}

export interface IBlobStore {
  put(vaultId: string, hash: string, data: Uint8Array): Promise<void>;
  get(vaultId: string, hash: string): Promise<Uint8Array | null>;
  has(vaultId: string, hash: string): Promise<boolean>;
  checkHashes(vaultId: string, hashes: string[]): Promise<{ existingHashes: string[]; missingHashes: string[] }>;
  deleteVault(vaultId: string): Promise<void>;
}

export interface INotifier {
  notifyChange(vaultId: string, version: number): void;
}
