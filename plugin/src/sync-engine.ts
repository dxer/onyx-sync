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
  formatConflictFilename,
  type CommitChangeItem,
  type SyncStatusResponse,
  type SessionInfoResponse
} from '@onyx/shared';
import type { SyncPluginSettings, SyncState } from './types';
import { SyncApiClient } from './client';
import { LocalSyncDb } from './db';
import { VaultWatcher } from './watcher';
import { t } from './i18n';

const textDecoder = new TextDecoder();

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
  private dataKey: CryptoKey | null = null;
  private hmacKey: CryptoKey | null = null;
  private ws: WebSocket | null = null;
  private pollTimer: number | null = null;
  private currentSession: SessionInfoResponse | null = null;

  constructor(
    app: App,
    settings: SyncPluginSettings,
    onStatusChange: (status: SyncState) => void
  ) {
    this.app = app;
    this.settings = settings;
    this.onStatusChange = onStatusChange;

    const localKey = getLocalVaultKey(app);
    this.client = new SyncApiClient(settings.serverUrl, settings.deviceToken);
    this.db = new LocalSyncDb(settings.cachedVaultId || 'default', localKey);

    this.watcher = new VaultWatcher(app, (dirtyBatch, deletedBatch) => {
      for (const p of dirtyBatch) {
        this.dirtyPaths.add(p);
      }
      for (const p of deletedBatch) {
        this.pendingDeletes.add(p);
      }
      if (this.settings.autoSync) {
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

  updateSettings(settings: SyncPluginSettings): void {
    const oldServer = this.settings.serverUrl;
    const oldToken = this.settings.deviceToken;
    const oldPass = this.settings.passphrase;

    this.settings = settings;
    this.client.setCredentials(settings.serverUrl, settings.deviceToken);

    if (oldServer !== settings.serverUrl || oldToken !== settings.deviceToken || oldPass !== settings.passphrase) {
      this.dataKey = null;
      this.hmacKey = null;
      this.currentSession = null;
      this.isInitialized = false;
      this.db.close();
      const localKey = getLocalVaultKey(this.app);
      this.db = new LocalSyncDb(settings.cachedVaultId || 'default', localKey);
      this.db.init().catch(console.error);
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
    if (!this.currentSession.salt) {
      throw new Error('Server returned invalid salt for vault');
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
    if (this.isSyncing) return;
    if (!this.settings.serverUrl || !this.settings.deviceToken || !this.settings.passphrase) {
      this.onStatusChange('offline');
      return;
    }

    let remoteStatus: SyncStatusResponse;
    try {
      remoteStatus = await this.client.getStatus();
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
    const hasLocalChanges = this.dirtyPaths.size > 0 || this.pendingDeletes.size > 0;
    const needsFullScan = options.fullScan || !this.isInitialized;

    if (!hasRemoteChanges && !hasLocalChanges && !needsFullScan && !options.force) {
      return;
    }

    this.isSyncing = true;
    this.onStatusChange('syncing');

    try {
      await this.ensureCryptoKeys();
      if (!this.dataKey || !this.hmacKey) throw new Error('Crypto keys not initialized');

      // 1. PULL & MERGE PHASE
      if (hasRemoteChanges || lastVersion === 0 || options.force) {
        await this.pullAndMerge(lastVersion, remoteStatus.latestVersion);
      }

      // 2. PUSH PHASE
      await this.scanAndPush(needsFullScan);

      this.isInitialized = true;
      this.onStatusChange('idle');

      if (options.force) {
        new Notice(t('syncSuccessNotice'));
      }
    } catch (err: any) {
      console.error('[Obsidian Cloud Sync] Sync failed:', err);
      this.onStatusChange('error');
      new Notice(t('syncFailedNotice', { error: err.message || String(err) }));
    } finally {
      this.isSyncing = false;
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

  private async pullAndMerge(lastVersion: number, targetVersion: number): Promise<void> {
    const dataKey = this.dataKey!;
    const changesResp = await this.client.getChanges(lastVersion);

    if (changesResp.changes.length === 0) {
      await this.db.setMeta('last_synced_version', targetVersion);
      return;
    }

    for (const change of changesResp.changes) {
      try {
        const rawPath = await decryptPath(change.encryptedPath, dataKey);
        const normPath = normalizePath(rawPath);

        // Handle Remote Deletion
        if (change.isDeleted) {
          if (await this.app.vault.adapter.exists(normPath)) {
            this.watcher.suppress(normPath);
            await this.app.vault.adapter.remove(normPath);
          }
          await this.db.deleteFile(normPath);
          await this.db.deleteSnapshot(normPath);
          continue;
        }

        // Handle Remote Create / Update
        const encryptedBlob = await this.client.downloadBlob(change.contentHash);
        const plainBytes = await decryptData(encryptedBlob, dataKey);

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
            encryptedPath: change.encryptedPath,
            localHash: change.contentHash,
            baseHash: change.contentHash,
            mtime: change.mtime,
            size: plainBytes.byteLength,
            isDeleted: false,
            syncedVersion: change.version
          });
        }
      } catch (fileErr) {
        console.warn(`[Obsidian Cloud Sync] Failed to apply change for item:`, fileErr);
      }
    }

    await this.db.setMeta('last_synced_version', targetVersion);
  }

  private async scanAndPush(fullScan: boolean): Promise<void> {
    const dataKey = this.dataKey!;
    const hmacKey = this.hmacKey!;

    const pathsToCheck = new Set<string>();

    if (fullScan) {
      for (const f of this.app.vault.getFiles()) {
        pathsToCheck.add(normalizePath(f.path));
      }
    } else {
      for (const p of this.dirtyPaths) {
        pathsToCheck.add(normalizePath(p));
      }
    }

    this.dirtyPaths.clear();

    const changesToCommit: CommitChangeItem[] = [];
    const blobsToUpload = new Map<string, Uint8Array>();

    // 1. Process explicit deletes
    for (const deletedPath of this.pendingDeletes) {
      const existing = await this.db.getFile(deletedPath);
      if (existing && !existing.isDeleted) {
        const encryptedPath = await encryptPath(deletedPath, dataKey);
        changesToCommit.push({
          encryptedPath,
          contentHash: '',
          size: 0,
          isDeleted: true,
          mtime: Date.now()
        });
      }
    }
    this.pendingDeletes.clear();

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

      if (!existingRecord || existingRecord.localHash !== currentHash) {
        const encryptedBlob = await encryptData(bytes, dataKey);
        const encryptedPath = await encryptPath(path, dataKey);

        blobsToUpload.set(currentHash, encryptedBlob);

        changesToCommit.push({
          encryptedPath,
          contentHash: currentHash,
          size: encryptedBlob.byteLength,
          isDeleted: false,
          mtime: file.stat.mtime
        });
      }
    }

    if (changesToCommit.length === 0) {
      return;
    }

    // Upload missing blobs
    const hashes = Array.from(blobsToUpload.keys());
    if (hashes.length > 0) {
      const checkResult = await this.client.checkBlobs(hashes);

      for (const missingHash of checkResult.missingHashes) {
        const blob = blobsToUpload.get(missingHash);
        if (blob) {
          await this.client.uploadBlob(missingHash, blob);
        }
      }
    }

    // Commit changes
    const commitResult = await this.client.commit(changesToCommit);

    if (commitResult.success) {
      await this.db.setMeta('last_synced_version', commitResult.newVersion);

      for (const item of changesToCommit) {
        const plainPath = normalizePath(await decryptPath(item.encryptedPath, dataKey));

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
    }
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

    try {
      const wsUrl = new URL(this.settings.serverUrl);
      wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl.pathname = '/api/v1/ws';
      wsUrl.searchParams.set('token', this.settings.deviceToken);

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
    } catch {
      // ignore
    }
  }

  private disconnectWebSocket(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
