import { normalizePath, Notice, type App, type TFile } from 'obsidian';
import {
  deriveMasterKey,
  deriveSubKeys,
  encryptData,
  decryptData,
  calculateContentHmac,
  encryptPath,
  decryptPath,
  hexToBytes,
  threeWayMerge,
  formatConflictFilename
} from '@onyx/shared';
import type {
  CommitChangeItem,
  CommitResult,
  SyncStatusResponse,
  SessionInfoResponse,
  ClientFileMeta
} from '@onyx/shared';
import type { SyncPluginSettings, SyncState } from './types';
import { SyncApiClient } from './client';
import { LocalSyncDb } from './db';
import { VaultWatcher, foldRename } from './watcher';
import { t } from './i18n';

const textDecoder = new TextDecoder();

type PendingOutbox = {
  requestId: string;
  changes: CommitChangeItem[];
  blobs: Array<{ hash: string; data: Uint8Array }>;
  /** Plaintext renames captured with this batch, applied locally after the commit is acknowledged. */
  renames: Array<{ oldPath: string; newPath: string }>;
  createdAt: number;
  attempts: number;
  lastError?: string;
  nextAttemptAt?: number;
};

const OUTBOX_BACKOFF_BASE_MS = 30_000;
const OUTBOX_BACKOFF_MAX_MS = 15 * 60_000;

function outboxBackoffMs(attempts: number): number {
  return Math.min(OUTBOX_BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), OUTBOX_BACKOFF_MAX_MS);
}

function getLocalVaultKey(app: App): string {
  const appId = (app as any).appId || '';
  const basePath = (app.vault.adapter as any).basePath || '';
  const vaultName = app.vault.getName() || 'vault';
  const raw = `${appId}_${basePath}_${vaultName}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash << 5) - hash + raw.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function isTextFile(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.endsWith('.md') ||
    lower.endsWith('.txt') ||
    lower.endsWith('.json') ||
    lower.endsWith('.canvas') ||
    lower.endsWith('.csv') ||
    lower.endsWith('.svg') ||
    lower.endsWith('.html') ||
    lower.endsWith('.css') ||
    lower.endsWith('.js') ||
    lower.endsWith('.ts')
  );
}

export class SyncEngine {
  private app: App;
  private settings: SyncPluginSettings;
  private client: SyncApiClient;
  private db: LocalSyncDb;
  private watcher: VaultWatcher;
  private onStatusChange: (status: SyncState) => void;

  private isSyncing = false;
  private isInitialized = false;
  private dirtyPaths = new Set<string>();
  private pendingDeletes = new Set<string>();
  private pendingRenames = new Map<string, string>();
  private dataKey: CryptoKey | null = null;
  private hmacKey: CryptoKey | null = null;
  private ws: WebSocket | null = null;
  private pollTimer: number | null = null;
  private currentSession: SessionInfoResponse | null = null;
  private localVaultKey: string;
  private activeVaultId: string | null = null;
  private wakeRequested = false;
  private inFlightDirty = new Set<string>();
  private inFlightDeletes = new Set<string>();
  private inFlightRenames = new Map<string, string>();

  constructor(
    app: App,
    settings: SyncPluginSettings,
    onStatusChange: (status: SyncState) => void
  ) {
    this.app = app;
    this.settings = { ...settings };
    this.onStatusChange = onStatusChange;

    this.localVaultKey = getLocalVaultKey(app);
    this.client = new SyncApiClient(this.settings.serverUrl, this.settings.deviceToken);
    this.db = new LocalSyncDb(this.settings.cachedVaultId || 'default', this.localVaultKey);

    this.watcher = new VaultWatcher(app, (batch) => {
      for (const p of batch.dirty) {
        this.dirtyPaths.add(p);
      }
      for (const p of batch.deleted) {
        this.pendingDeletes.add(p);
      }
      for (const rename of batch.renamed) {
        foldRename(this.pendingRenames, normalizePath(rename.oldPath), normalizePath(rename.newPath));
        this.dirtyPaths.add(normalizePath(rename.newPath));
      }
      if (this.settings.autoSync) {
        this.wakeRequested = true;
        this.sync().catch(console.error);
      }
    });
  }

  async start(): Promise<void> {
    await this.db.init();
    this.watcher.start();

    window.addEventListener('focus', this.handleWindowFocus);

    if (this.settings.autoSync && this.settings.serverUrl && this.settings.deviceToken && this.settings.passphrase) {
      this.sync({ fullScan: true }).catch(console.error);
    } else {
      this.onStatusChange('idle');
    }

    this.startPolling();
    this.connectWebSocket();
  }

  stop(): void {
    window.removeEventListener('focus', this.handleWindowFocus);
    this.watcher.stop();
    this.stopPolling();
    this.disconnectWebSocket();
    this.db.close();
  }

  async updateSettings(settings: SyncPluginSettings): Promise<void> {
    const nextSettings = { ...settings };
    const credentialsChanged =
      this.settings.serverUrl !== nextSettings.serverUrl ||
      this.settings.deviceToken !== nextSettings.deviceToken ||
      this.settings.passphrase !== nextSettings.passphrase;

    this.settings = nextSettings;
    this.client.setCredentials(nextSettings.serverUrl, nextSettings.deviceToken);

    if (credentialsChanged) {
      this.dataKey = null;
      this.hmacKey = null;
      this.currentSession = null;
      this.activeVaultId = null;
      this.isInitialized = false;
      this.db.close();
      this.db = new LocalSyncDb(nextSettings.cachedVaultId || 'default', this.localVaultKey);
      await this.db.init();
      this.disconnectWebSocket();
      this.connectWebSocket();
    }

    this.startPolling();
  }

  private handleWindowFocus = () => {
    if (this.settings.autoSync) {
      this.sync().catch(console.error);
    }
  };

  private async ensureCryptoKeys(): Promise<void> {
    if (this.dataKey && this.hmacKey && this.currentSession) {
      return;
    }

    if (!this.settings.deviceToken || !this.settings.passphrase) {
      throw new Error('Device Token and Passphrase must be set');
    }

    // 1. Handshake with server using token
    this.currentSession = await this.client.getSession();
    if (!this.currentSession.salt || !this.currentSession.vaultId) {
      throw new Error('Server returned invalid vault session');
    }

    if (this.activeVaultId !== this.currentSession.vaultId) {
      this.db.close();
      this.db = new LocalSyncDb(this.currentSession.vaultId, this.localVaultKey);
      await this.db.init();
      this.activeVaultId = this.currentSession.vaultId;
      this.isInitialized = false;
    }

    this.settings.cachedVaultId = this.currentSession.vaultId;
    this.settings.cachedVaultName = this.currentSession.vaultName;
    this.settings.cachedDeviceName = this.currentSession.deviceName;

    // 2. Derive E2EE keys
    const saltBytes = hexToBytes(this.currentSession.salt);
    const masterKey = await deriveMasterKey(this.settings.passphrase, saltBytes);
    const subKeys = await deriveSubKeys(masterKey);

    this.dataKey = subKeys.dataKey;
    this.hmacKey = subKeys.hmacKey;
  }

  async sync(options: { fullScan?: boolean; force?: boolean } = {}): Promise<void> {
    if (this.isSyncing) {
      this.wakeRequested = true;
      return;
    }
    if (!this.settings.serverUrl || !this.settings.deviceToken || !this.settings.passphrase) {
      this.onStatusChange('offline');
      return;
    }

    try {
      await this.ensureCryptoKeys();
    } catch {
      this.onStatusChange('offline');
      return;
    }

    let remoteStatus: SyncStatusResponse;
    try {
      remoteStatus = await this.client.getStatus();
      if (!this.currentSession || remoteStatus.vaultId !== this.currentSession.vaultId || remoteStatus.salt !== this.currentSession.salt) {
        throw new Error('Server session and status refer to different vaults');
      }
    } catch {
      this.onStatusChange('offline');
      return;
    }

    let lastVersion = (await this.db.getMeta<number>('last_synced_version')) || 0;

    const localUserFiles = this.app.vault.getFiles().filter(
      (f) => !f.path.startsWith('.obsidian') && !f.path.startsWith('.trash')
    );
    if (localUserFiles.length === 0 && remoteStatus.latestVersion > 0) {
      lastVersion = 0;
    }

    const hasRemoteChanges = remoteStatus.latestVersion > lastVersion;
    const hasLocalChanges = this.dirtyPaths.size > 0 || this.pendingDeletes.size > 0 || this.pendingRenames.size > 0;
    const needsFullScan = options.fullScan || !this.isInitialized;

    if (!hasRemoteChanges && !hasLocalChanges && !needsFullScan && !options.force) {
      return;
    }

    this.isSyncing = true;
    this.onStatusChange('syncing');

    try {
      await this.ensureCryptoKeys();
      await this.replayOutbox();
      if (!this.dataKey || !this.hmacKey) throw new Error('Crypto keys not initialized');

      // 1. PULL & MERGE PHASE
      if (hasRemoteChanges || lastVersion === 0 || options.force) {
        await this.pullAndMerge(lastVersion);
      }

      // 2. PUSH PHASE
      await this.scanAndPush(needsFullScan);

      this.isInitialized = true;
      this.onStatusChange('idle');

      if (options.force) {
        new Notice(t('syncSuccessNotice'));
      }
    } catch (err: any) {
      this.restoreInFlightEvents();
      console.error('[Obsidian Cloud Sync] Sync failed:', err);
      this.onStatusChange('error');
      new Notice(t('syncFailedNotice', { error: err.message || String(err) }));
    } finally {
      this.isSyncing = false;
      if (this.wakeRequested) {
        this.wakeRequested = false;
        queueMicrotask(() => this.sync().catch(console.error));
      }
    }
  }

  private async ensureDirectory(filePath: string): Promise<void> {
    const norm = normalizePath(filePath);
    const lastSlash = norm.lastIndexOf('/');
    if (lastSlash === -1) return;

    const dirPath = norm.substring(0, lastSlash);
    const parts = dirPath.split('/');
    let current = '';

    for (const part of parts) {
      if (!part) continue;
      current = current ? `${current}/${part}` : part;
      const normalizedCurrent = normalizePath(current);
      if (!(await this.app.vault.adapter.exists(normalizedCurrent))) {
        try {
          await this.app.vault.adapter.mkdir(normalizedCurrent);
        } catch {
          // ignore
        }
      }
    }
  }

  private async writeVaultFile(path: string, bytes: Uint8Array): Promise<void> {
    const norm = normalizePath(path);
    await this.ensureDirectory(norm);

    if (isTextFile(norm)) {
      const text = textDecoder.decode(bytes);
      await this.app.vault.adapter.write(norm, text);
    } else {
      const cleanBuffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      ) as ArrayBuffer;

      if (typeof this.app.vault.adapter.writeBinary === 'function') {
        await this.app.vault.adapter.writeBinary(norm, cleanBuffer);
      } else {
        await (this.app.vault.adapter as any).write(norm, cleanBuffer);
      }
    }
  }

  private async pullAndMerge(lastVersion: number): Promise<void> {
    const dataKey = this.dataKey!;
    const changesResp = await this.client.getChanges(lastVersion);

    if (!this.currentSession || changesResp.vaultId !== this.currentSession.vaultId || !Array.isArray(changesResp.changes)) {
      throw new Error('Invalid changes response');
    }
    if (!Number.isSafeInteger(changesResp.latestVersion) || changesResp.latestVersion < lastVersion) {
      throw new Error('Invalid changes response version');
    }

    let previousVersion = lastVersion;
    for (const change of changesResp.changes) {
      if (!Number.isSafeInteger(change.version) || change.version <= lastVersion || change.version <= previousVersion || change.version > changesResp.latestVersion) {
        throw new Error(`Invalid remote change version: ${change.version}`);
      }
      previousVersion = change.version;
    }

    if (changesResp.changes.length === 0) {
      await this.db.setMeta('last_synced_version', changesResp.latestVersion);
      return;
    }

    let appliedVersion = lastVersion;
    for (const change of changesResp.changes) {
      const rawPath = await decryptPath(change.encryptedPath, dataKey);
        const normPath = normalizePath(rawPath);
        const localById = await this.db.getFileById(change.id);
        const previousPath = localById && normalizePath(localById.path) !== normPath
          ? normalizePath(localById.path)
          : null;

        if (previousPath && !change.isDeleted && !(await this.app.vault.adapter.exists(normPath))) {
          this.watcher.suppress(previousPath);
          this.watcher.suppress(normPath);
          await this.ensureDirectory(normPath);
          await this.app.vault.adapter.rename(previousPath, normPath);
          await this.db.moveFile(previousPath, normPath);
          await this.migrateSnapshot(previousPath, normPath);
        }

        // Tombstone sanity must be validated before the deletion is applied and
        // before the local cursor advances.
        if (change.isDeleted && (change.contentHash !== '' || change.size !== 0)) {
          throw new Error(`Invalid remote tombstone for ${change.id}`);
        }

        // Handle Remote Deletion
        if (change.isDeleted) {
          const deletePath = previousPath || normPath;
          if (await this.app.vault.adapter.exists(deletePath)) {
            this.watcher.suppress(deletePath);
            await this.app.vault.adapter.remove(deletePath);
          }
          await this.db.deleteFile(deletePath);
          await this.db.deleteSnapshot(deletePath);
          continue;
        }

        // Handle Remote Create / Update
        const encryptedBlob = await this.client.downloadBlob(change.contentHash);
        const plainBytes = await decryptData(encryptedBlob, dataKey);
        const actualHash = await calculateContentHmac(plainBytes, this.hmacKey!);
        if (actualHash !== change.contentHash) {
          throw new Error(`Remote blob HMAC mismatch for ${change.id}`);
        }

        const existsLocally = await this.app.vault.adapter.exists(normPath);

        if (!existsLocally) {
          this.watcher.suppress(normPath);
          await this.writeVaultFile(normPath, plainBytes);

          if (isTextFile(normPath)) {
            const text = textDecoder.decode(plainBytes);
            await this.db.setSnapshot(normPath, text, change.contentHash);
          }

          await this.db.setFile({
            path: normPath,
            id: change.id,
            encryptedPath: change.encryptedPath,
            localHash: change.contentHash,
            baseHash: change.contentHash,
            mtime: change.mtime,
            size: plainBytes.byteLength,
            isDeleted: false,
            syncedVersion: change.version
          });
        } else {
          const localBinary = await this.app.vault.adapter.readBinary(normPath);
          const localBytes = new Uint8Array(localBinary);
          const localHash = await calculateContentHmac(localBytes, this.hmacKey!);

          if (localHash === change.contentHash) {
            await this.db.setFile({
              path: normPath,
              id: change.id,
              encryptedPath: change.encryptedPath,
              localHash: change.contentHash,
              baseHash: change.contentHash,
              mtime: change.mtime,
              size: plainBytes.byteLength,
              isDeleted: false,
              syncedVersion: change.version
            });
            continue;
          }

          if (isTextFile(normPath)) {
            const localText = textDecoder.decode(localBytes);
            const remoteText = textDecoder.decode(plainBytes);
            const baseSnapshot = await this.db.getSnapshot(normPath);
            const baseText = baseSnapshot ? baseSnapshot.content : '';

            const mergeResult = threeWayMerge(baseText, localText, remoteText);

            if (mergeResult.hasConflict && this.settings.conflictStrategy === 'conflict_file') {
              const deviceName = this.currentSession?.deviceName || 'Device';
              const conflictPath = normalizePath(formatConflictFilename(normPath, deviceName));
              this.watcher.suppress(conflictPath);
              await this.app.vault.adapter.write(conflictPath, localText);

              this.watcher.suppress(normPath);
              await this.app.vault.adapter.write(normPath, remoteText);
              await this.db.setSnapshot(normPath, remoteText, change.contentHash);
            } else {
              this.watcher.suppress(normPath);
              await this.app.vault.adapter.write(normPath, mergeResult.mergedText);
              await this.db.setSnapshot(normPath, mergeResult.mergedText, change.contentHash);
            }
          } else {
            this.watcher.suppress(normPath);
            await this.writeVaultFile(normPath, plainBytes);
          }

          await this.db.setFile({
            path: normPath,
            id: change.id,
            encryptedPath: change.encryptedPath,
            localHash: change.contentHash,
            baseHash: change.contentHash,
            mtime: change.mtime,
            size: plainBytes.byteLength,
            isDeleted: false,
            syncedVersion: change.version
          });
        }
      appliedVersion = Math.max(appliedVersion, change.version);
    }

    await this.db.setMeta('last_synced_version', appliedVersion);
  }

  private async scanAndPush(fullScan: boolean): Promise<void> {
    const dataKey = this.dataKey!;
    const hmacKey = this.hmacKey!;

    const pathsToCheck = new Set<string>();

    const claimedDirty = new Set(this.dirtyPaths);
    const claimedDeletes = new Set(this.pendingDeletes);
    const claimedRenames = new Map(this.pendingRenames);
    this.inFlightDirty = claimedDirty;
    this.inFlightDeletes = claimedDeletes;
    this.inFlightRenames = claimedRenames;
    this.dirtyPaths.clear();
    this.pendingDeletes.clear();
    this.pendingRenames.clear();

    if (fullScan) {
      for (const f of this.app.vault.getFiles()) {
        pathsToCheck.add(normalizePath(f.path));
      }
    } else {
      for (const p of claimedDirty) {
        pathsToCheck.add(normalizePath(p));
      }
    }

    const changesToCommit: CommitChangeItem[] = [];
    const blobsToUpload = new Map<string, Uint8Array>();
    const renameRecords = new Map<string, ClientFileMeta>();

    // 1. Process explicit deletes
    for (const deletedPath of claimedDeletes) {
      const existing = await this.db.getFile(deletedPath);
      if (existing && !existing.isDeleted) {
        const encryptedPath = await encryptPath(deletedPath, dataKey);
        changesToCommit.push({
          id: existing.id,
          encryptedPath,
          contentHash: '',
          size: 0,
          isDeleted: true,
          mtime: Date.now()
        });
      }
    }
    // 2. Process modified/created files
    for (const path of pathsToCheck) {
      if (path.startsWith('.obsidian') || path.startsWith('.trash') || path.startsWith('.git')) {
        continue;
      }

      const file = this.app.vault.getAbstractFileByPath(path) as TFile | null;
      if (!file) {
        continue;
      }

      const binary = await this.app.vault.adapter.readBinary(path);
      const bytes = new Uint8Array(binary);
      const currentHash = await calculateContentHmac(bytes, hmacKey);

      const existingRecord = await this.db.getFile(path);
      const renameSource = Array.from(claimedRenames.entries()).find(([, renamedPath]) => renamedPath === path)?.[0];
      const renameRecord = renameSource ? await this.db.getFile(renameSource) : null;
      const isRename = Boolean(renameRecord);
      const contentChanged = !existingRecord || existingRecord.localHash !== currentHash;

      if (contentChanged || isRename) {
        const encryptedPath = await encryptPath(path, dataKey);
        let encryptedBlob: Uint8Array | null = null;

        if (contentChanged) {
          encryptedBlob = await encryptData(bytes, dataKey);
          // The server is zero-knowledge (contentHash is a client-side HMAC over
          // plaintext), so verify locally that the ciphertext round-trips to the
          // claimed hash before it leaves the device.
          const roundtrip = await decryptData(encryptedBlob, dataKey);
          const roundtripHash = await calculateContentHmac(roundtrip, hmacKey);
          if (roundtripHash !== currentHash) {
            throw new Error(`Local encryption roundtrip failed for ${path}`);
          }
          blobsToUpload.set(currentHash, encryptedBlob);
        }

        changesToCommit.push({
          id: existingRecord?.id || renameRecord?.id,
          encryptedPath,
          contentHash: currentHash,
          size: encryptedBlob?.byteLength || existingRecord?.size || renameRecord?.size || 0,
          isDeleted: false,
          mtime: file.stat.mtime
        });
      }
    }

    if (changesToCommit.length === 0) {
      this.restoreClaimedEvents(claimedDirty, claimedDeletes, claimedRenames);
      return;
    }

    // Persist the complete operation before any network side effect. From this
    // point on the claimed watcher events are durably captured by the outbox,
    // so they must never be restored into the pending sets on failure.
    const requestId = globalThis.crypto.randomUUID();
    const outbox: PendingOutbox = {
      requestId,
      changes: changesToCommit,
      blobs: Array.from(blobsToUpload.entries()).map(([hash, data]) => ({ hash, data })),
      renames: Array.from(claimedRenames.entries()).map(([oldPath, newPath]) => ({ oldPath, newPath })),
      createdAt: Date.now(),
      attempts: 0
    };
    await this.db.putOutbox(outbox);
    this.inFlightDirty.clear();
    this.inFlightDeletes.clear();
    this.inFlightRenames.clear();

    await this.runOutbox(outbox);
  }

  /**
   * Drives one outbox entry to completion: server commit, local
   * acknowledgement, and only then removal from the outbox. Any failure keeps
   * the entry (with backoff metadata) for a later replay.
   */
  private async runOutbox(outbox: PendingOutbox): Promise<void> {
    try {
      const commitResult = await this.commitOutbox(outbox);
      await this.applyCommitAck(outbox, commitResult);
      await this.db.deleteOutbox(outbox.requestId);
    } catch (error) {
      await this.markOutboxFailure(outbox, error);
      throw error;
    }
  }

  private async markOutboxFailure(outbox: PendingOutbox, error: unknown): Promise<void> {
    const attempts = (outbox.attempts || 0) + 1;
    const message = error instanceof Error ? error.message : String(error);
    try {
      await this.db.putOutbox({
        ...outbox,
        attempts,
        lastError: message,
        nextAttemptAt: Date.now() + outboxBackoffMs(attempts)
      });
    } catch (dbError) {
      console.error('[Obsidian Cloud Sync] Failed to persist outbox retry state:', dbError);
    }
  }

  /** Applies an acknowledged commit to the local database (files, snapshots, rename bookkeeping, version). */
  private async applyCommitAck(outbox: PendingOutbox, commitResult: CommitResult): Promise<void> {
    const dataKey = this.dataKey!;
    await this.db.setMeta('last_synced_version', commitResult.newVersion);

    for (const [index, item] of outbox.changes.entries()) {
      const plainPath = normalizePath(await decryptPath(item.encryptedPath, dataKey));
      const committed = commitResult.changes?.[index];
      const fileId = committed?.id || item.id;

      if (item.isDeleted) {
        await this.db.deleteFile(plainPath);
        await this.db.deleteSnapshot(plainPath);
      } else {
        const file = this.app.vault.getAbstractFileByPath(plainPath) as TFile | null;
        if (file) {
          const binary = await this.app.vault.adapter.readBinary(plainPath);
          const bytes = new Uint8Array(binary);

          if (isTextFile(plainPath)) {
            const text = textDecoder.decode(bytes);
            await this.db.setSnapshot(plainPath, text, item.contentHash);
          }

          await this.db.setFile({
            path: plainPath,
            id: fileId,
            encryptedPath: item.encryptedPath,
            localHash: item.contentHash,
            baseHash: item.contentHash,
            mtime: file.stat.mtime,
            size: item.size,
            isDeleted: false,
            syncedVersion: commitResult.newVersion
          });
        }
      }
    }

    // Once the new path carries the stable id, retire the old path's record and
    // move its merge snapshot across.
    for (const { oldPath, newPath } of outbox.renames || []) {
      const record = await this.db.getFile(newPath);
      if (record && record.id) {
        await this.db.deleteFile(oldPath);
        await this.migrateSnapshot(oldPath, newPath);
      }
    }
  }

  private async migrateSnapshot(oldPath: string, newPath: string): Promise<void> {
    const snapshot = await this.db.getSnapshot(oldPath);
    if (snapshot) {
      await this.db.deleteSnapshot(oldPath);
      await this.db.setSnapshot(newPath, snapshot.content, snapshot.hash);
    }
  }

  private async commitOutbox(outbox: PendingOutbox): Promise<CommitResult> {
    const hashes = outbox.blobs.map((blob) => blob.hash);
    if (hashes.length > 0) {
      const checkResult = await this.client.checkBlobs(hashes);
      for (const missingHash of checkResult.missingHashes) {
        const blob = outbox.blobs.find((item) => item.hash === missingHash);
        if (blob) await this.client.uploadBlob(blob.hash, blob.data);
      }
    }
    const result = await this.client.commit(outbox.changes, outbox.requestId);
    if (!result.success || !result.changes || result.changes.length !== outbox.changes.length) {
      throw new Error('Commit response was incomplete');
    }
    return result;
  }

  private async replayOutbox(): Promise<void> {
    const pending = await this.db.getAllOutbox<PendingOutbox>();
    const now = Date.now();
    for (const outbox of pending.sort((a, b) => a.createdAt - b.createdAt)) {
      if (outbox.nextAttemptAt && outbox.nextAttemptAt > now) continue;
      try {
        await this.runOutbox(outbox);
      } catch (error) {
        console.error('[Obsidian Cloud Sync] Outbox replay failed:', error);
        // Stop at the first still-failing entry to preserve submission order.
        break;
      }
    }
  }

  private restoreInFlightEvents(): void {
    if (this.inFlightDirty.size === 0 && this.inFlightDeletes.size === 0 && this.inFlightRenames.size === 0) return;
    this.restoreClaimedEvents(this.inFlightDirty, this.inFlightDeletes, this.inFlightRenames);
  }

  private restoreClaimedEvents(
    dirty: Set<string>,
    deleted: Set<string>,
    renamed: Map<string, string>
  ): void {
    for (const path of dirty) this.dirtyPaths.add(path);
    for (const path of deleted) this.pendingDeletes.add(path);
    for (const [oldPath, newPath] of renamed) this.pendingRenames.set(oldPath, newPath);
    this.inFlightDirty.clear();
    this.inFlightDeletes.clear();
    this.inFlightRenames.clear();
  }

  private startPolling(): void {
    this.stopPolling();
    if (!this.settings.autoSync || this.settings.syncInterval <= 0) return;

    this.pollTimer = window.setInterval(() => {
      this.sync().catch(console.error);
    }, this.settings.syncInterval * 1000);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private connectWebSocket(): void {
    this.disconnectWebSocket();

    if (!this.settings.serverUrl || !this.settings.deviceToken) return;

    // Exchange the long-lived device token for a short-lived single-use ticket;
    // deployments without WebSocket support (Worker) reject the exchange and we
    // simply stay on REST polling.
    void this.openWebSocketWithTicket().catch(() => {
      // ignore: polling remains active
    });
  }

  private async openWebSocketWithTicket(): Promise<void> {
    const { ticket } = await this.client.createWsTicket();

    const wsUrl = new URL(this.settings.serverUrl);
    wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    wsUrl.pathname = '/api/v1/ws';
    wsUrl.searchParams.set('ticket', ticket);

    this.ws = new WebSocket(wsUrl.toString());

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.event === 'version_bump') {
          this.sync({ force: true }).catch(console.error);
        }
      } catch {
        // ignore
      }
    };

    this.ws.onerror = () => {
      this.disconnectWebSocket();
    };
  }

  private disconnectWebSocket(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
