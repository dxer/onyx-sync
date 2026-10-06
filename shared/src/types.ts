/**
 * Shared Type Definitions for Obsidian Sync Protocol
 */

export interface User {
  id: string;
  username: string;
  role?: 'admin' | 'user';
  createdAt: number;
}

export interface UserToken {
  token: string;
  userId: string;
  vaultId: string;
  deviceName: string;
  createdAt: number;
  lastUsedAt: number;
}

export interface SessionInfoResponse {
  vaultId: string;
  vaultName: string;
  userId: string;
  username: string;
  deviceName: string;
  salt: string;
  latestVersion: number;
  serverTime: number;
}

export interface VaultActivityDay {
  day: string; // YYYY-MM-DD
  count: number;
}

export interface AdminCreateUserRequest {
  username: string;
  password: string;
  role?: 'admin' | 'user';
}

export interface UpdateTokenRequest {
  deviceName: string;
}

export interface RotateTokenResponse {
  token: string;
  deviceName: string;
  vaultId: string;
}

export interface VaultSummary {
  id: string;
  userId: string;
  name: string;
  salt: string;
  latestVersion: number;
  fileCount: number;
  totalSize: number;
  createdAt: number;
  tokens?: UserToken[];
  activity?: VaultActivityDay[];
}

export interface AdminStats {
  totalUsers: number;
  totalVaults: number;
  totalFiles: number;
  totalStorageBytes: number;
}

export interface AdminUserInfo {
  id: string;
  username: string;
  role: string;
  vaultCount: number;
  totalStorageBytes: number;
  createdAt: number;
}

export interface AuthRegisterRequest {
  username: string;
  password: string;
}

export interface AuthLoginRequest {
  username: string;
  password: string;
}

export interface AuthResponse {
  user: User;
  token: string; // Master token for dashboard
}

export interface Vault {
  id: string;
  userId: string; // The user who owns this vault
  name: string;
  salt: string; // Hex-encoded random salt for password derivation
  latestVersion: number; // Global monotonic increasing logical clock
  createdAt: number;
}

export interface Device {
  id: string;
  vaultId: string;
  deviceName: string;
  lastSeen: number;
}

export interface FileRecord {
  id: string;
  vaultId: string;
  encryptedPath: string; // Base64url encoded ciphertext of relative path
  contentHash: string; // Deterministic HMAC-SHA256 hash of content (hex)
  size: number; // Size of ciphertext blob in bytes
  version: number; // Global version at commit
  isDeleted: number; // 0 for active, 1 for deleted (tombstone)
  mtime: number; // Last modified time in milliseconds
  updatedAt: number; // Server timestamp in milliseconds
}

export interface FileChange {
  id: string;
  encryptedPath: string;
  contentHash: string;
  size: number;
  version: number;
  isDeleted: boolean;
  mtime: number;
}

export interface CommitChangeItem {
  id?: string; // Optional if new file
  encryptedPath: string;
  contentHash: string;
  size: number;
  isDeleted: boolean;
  mtime: number;
}

export interface CommitPayload {
  changes: CommitChangeItem[];
}

export interface CommitResult {
  success: boolean;
  newVersion: number;
  committedCount: number;
}

export interface SyncStatusResponse {
  vaultId: string;
  name: string;
  salt: string;
  latestVersion: number;
  serverTime: number;
}

export interface ChangesResponse {
  vaultId: string;
  latestVersion: number;
  changes: FileChange[];
}

export interface BlobCheckResponse {
  existingHashes: string[];
  missingHashes: string[];
}

export interface ClientFileMeta {
  path: string; // Plaintext local path
  encryptedPath: string; // Ciphertext path
  localHash: string; // Local content HMAC hash
  baseHash?: string; // Content hash of the last successfully synced base version
  mtime: number;
  size: number;
  isDeleted: boolean;
  syncedVersion: number;
}

export interface LocalBaseSnapshot {
  path: string;
  hash: string;
  content: string; // Cached plaintext for 3-way merge
  timestamp: number;
}
