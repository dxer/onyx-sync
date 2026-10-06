import type { ClientFileMeta, LocalBaseSnapshot } from '@onyx/shared';

export class LocalSyncDb {
  private db: IDBDatabase | null = null;
  private dbName: string;

  constructor(vaultId: string, localVaultKey?: string) {
    const cleanVault = (vaultId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
    const suffix = localVaultKey ? `_${localVaultKey}` : '';
    this.dbName = `obsidian_sync_${cleanVault}${suffix}`;
  }

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('files')) {
          db.createObjectStore('files', { keyPath: 'path' });
        }
        if (!db.objectStoreNames.contains('snapshots')) {
          db.createObjectStore('snapshots', { keyPath: 'path' });
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  private getStore(storeName: string, mode: IDBTransactionMode): IDBObjectStore {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    const tx = this.db.transaction(storeName, mode);
    return tx.objectStore(storeName);
  }

  // Meta methods
  async getMeta<T>(key: string): Promise<T | null> {
    return new Promise((resolve, reject) => {
      const store = this.getStore('meta', 'readonly');
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror = () => reject(req.error);
    });
  }

  async setMeta<T>(key: string, value: T): Promise<void> {
    return new Promise((resolve, reject) => {
      const store = this.getStore('meta', 'readwrite');
      const req = store.put({ key, value });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // File records methods
  async getFile(path: string): Promise<ClientFileMeta | null> {
    return new Promise((resolve, reject) => {
      const store = this.getStore('files', 'readonly');
      const req = store.get(path);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async setFile(file: ClientFileMeta): Promise<void> {
    return new Promise((resolve, reject) => {
      const store = this.getStore('files', 'readwrite');
      const req = store.put(file);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async deleteFile(path: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const store = this.getStore('files', 'readwrite');
      const req = store.delete(path);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async getAllFiles(): Promise<ClientFileMeta[]> {
    return new Promise((resolve, reject) => {
      const store = this.getStore('files', 'readonly');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  // Base snapshot methods for 3-way merge
  async getSnapshot(path: string): Promise<LocalBaseSnapshot | null> {
    return new Promise((resolve, reject) => {
      const store = this.getStore('snapshots', 'readonly');
      const req = store.get(path);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async setSnapshot(path: string, content: string, hash: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const store = this.getStore('snapshots', 'readwrite');
      const req = store.put({
        path,
        content,
        hash,
        timestamp: Date.now()
      });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async deleteSnapshot(path: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const store = this.getStore('snapshots', 'readwrite');
      const req = store.delete(path);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}
