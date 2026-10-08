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

export type DeletionJobStatus = 'pending' | 'completed' | 'failed';

export type InitialSyncResult = 'acquired' | 'already_initialized' | 'busy';

export interface DeletionJob {
  jobId: string;
  resourceType: 'vault' | 'user';
  resourceId: string;
  ownerUserId: string | null;
  status: DeletionJobStatus;
  attempts: number;
  lastError?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateTokenOptions {
  tokenType?: 'master' | 'device';
  /** Overrides the default lifetime (master 30d / device 180d). Negative values create already-expired tokens (tests). */
  expiresInDays?: number;
}

export interface IMetadataStore {
  init(): Promise<void>;

  // User management
  createUser(username: string, passwordHash: string, salt: string, role?: 'admin' | 'user'): Promise<User>;
  getUserByUsername(username: string): Promise<UserWithSecret | null>;
  getUserById(id: string): Promise<User | null>;
  updateUserPassword(id: string, passwordHash: string, salt: string, role?: 'admin' | 'user'): Promise<void>;

  // Token management (secrets are stored hash-only; plaintext is returned exactly once at creation)
  createToken(userId: string, vaultId: string, deviceName: string, options?: CreateTokenOptions): Promise<string>;
  /** Deletes every token of a user (password reset, account recovery). Returns rows removed. */
  revokeUserTokens(userId: string): Promise<number>;
  verifyToken(token: string): Promise<TokenValidationResult | null>;
  verifyUserMasterToken(token: string): Promise<User | null>;
  getTokenById(tokenId: string): Promise<UserToken | null>;
  isTokenActive(tokenId: string): Promise<boolean>;
  updateToken(tokenId: string, deviceName: string): Promise<void>;
  rotateToken(tokenId: string): Promise<string | null>;
  deleteToken(tokenId: string): Promise<void>;
  listUserTokens(userId: string): Promise<UserToken[]>;
  listVaultTokens(vaultId: string): Promise<UserToken[]>;

  // Vault management
  getVault(vaultId: string): Promise<Vault | null>;
  createVault(vault: { id: string; userId: string; name: string; salt: string }): Promise<Vault>;
  listUserVaults(userId: string): Promise<VaultSummary[]>;
  deleteVault(vaultId: string): Promise<void>;
  getChanges(vaultId: string, sinceVersion: number, limit?: number): Promise<FileChange[]>;
  commitChanges(
    vaultId: string,
    deviceId: string,
    changes: CommitChangeItem[],
    requestId?: string,
    /** Display name for the devices row; deviceId is the stable key. */
    deviceName?: string
  ): Promise<CommitResult>;
  getVaultActivity(vaultId: string, sinceMs: number): Promise<VaultActivityDay[]>;
  acquireInitialSync(vaultId: string, tokenId: string, leaseMs: number): Promise<InitialSyncResult>;
  renewInitialSync(vaultId: string, tokenId: string, leaseMs: number): Promise<boolean>;
  completeInitialSync(vaultId: string, tokenId: string): Promise<void>;
  canCommitInitialSync(vaultId: string, tokenId: string): Promise<boolean>;
  /** Content hashes referenced by live (non-tombstoned) records — the GC keep-set. */
  listActiveBlobHashes(vaultId: string): Promise<string[]>;
  /** Sum of live (non-tombstone) record sizes; drives the per-vault quota. */
  getVaultTotalBytes(vaultId: string): Promise<number>;

  // Admin management
  getAdminStats(): Promise<AdminStats>;
  listAllUsers(): Promise<AdminUserInfo[]>;
  deleteUser(userId: string): Promise<void>;
  createDeletionJob(
    resourceType: 'vault' | 'user',
    resourceId: string,
    ownerUserId?: string
  ): Promise<DeletionJob>;
  getDeletionJob(jobId: string): Promise<DeletionJob | null>;
  updateDeletionJob(jobId: string, status: DeletionJobStatus, lastError?: string | null): Promise<DeletionJob | null>;
}

export interface BlobListEntry {
  hash: string;
  lastModified: number | null;
}

export interface BlobListPage {
  blobs: BlobListEntry[];
  nextCursor?: string;
}

export interface IBlobStore {
  put(vaultId: string, hash: string, data: Uint8Array): Promise<void>;
  get(vaultId: string, hash: string): Promise<Uint8Array | null>;
  has(vaultId: string, hash: string): Promise<boolean>;
  checkHashes(vaultId: string, hashes: string[]): Promise<{ existingHashes: string[]; missingHashes: string[] }>;
  deleteVault(vaultId: string): Promise<void>;
  /** Lists stored blob hashes page by page (GC support). */
  list(vaultId: string, cursor?: string): Promise<BlobListPage>;
  /** Deletes a single blob; missing blobs are treated as success. */
  deleteBlob(vaultId: string, hash: string): Promise<void>;
}

export interface INotifier {
  notifyChange(vaultId: string, version: number): void;
}
