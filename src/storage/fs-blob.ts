import { mkdir, writeFile, readFile, access, rm, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { IBlobStore, BlobListPage } from './types';
import { isValidBlobFileName, normalizeBlobHash } from './blob-utils';

const LIST_PAGE_SIZE = 1000;

export class LocalFsBlobStore implements IBlobStore {
  private blobsDir: string;

  constructor(blobsDir: string) {
    this.blobsDir = blobsDir;
  }

  async init(): Promise<void> {
    await mkdir(this.blobsDir, { recursive: true });
  }

  private sanitize(str: string): string {
    return str.replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  private getFilePath(vaultId: string, hash: string): string {
    const safeVault = this.sanitize(vaultId);
    return join(this.blobsDir, safeVault, normalizeBlobHash(hash));
  }

  private getVaultDir(vaultId: string): string {
    const safeVault = this.sanitize(vaultId);
    return join(this.blobsDir, safeVault);
  }

  async put(vaultId: string, hash: string, data: Uint8Array): Promise<void> {
    const vaultDir = this.getVaultDir(vaultId);
    await mkdir(vaultDir, { recursive: true });
    const filePath = this.getFilePath(vaultId, hash);
    await writeFile(filePath, data);
  }

  async get(vaultId: string, hash: string): Promise<Uint8Array | null> {
    const filePath = this.getFilePath(vaultId, hash);
    try {
      const buffer = await readFile(filePath);
      return new Uint8Array(buffer);
    } catch (error: any) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async has(vaultId: string, hash: string): Promise<boolean> {
    const filePath = this.getFilePath(vaultId, hash);
    try {
      await access(filePath);
      return true;
    } catch (error: any) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  }

  async checkHashes(vaultId: string, hashes: string[]): Promise<{ existingHashes: string[]; missingHashes: string[] }> {
    const existingHashes: string[] = [];
    const missingHashes: string[] = [];

    await Promise.all(
      hashes.map(async (hash) => {
        if (await this.has(vaultId, hash)) {
          existingHashes.push(hash);
        } else {
          missingHashes.push(hash);
        }
      })
    );

    return { existingHashes, missingHashes };
  }

  async deleteVault(vaultId: string): Promise<void> {
    const vaultDir = this.getVaultDir(vaultId);
    await rm(vaultDir, { recursive: true, force: true });
  }

  async list(vaultId: string, cursor?: string): Promise<BlobListPage> {
    const vaultDir = this.getVaultDir(vaultId);
    let entries: string[];
    try {
      entries = await readdir(vaultDir);
    } catch (error: any) {
      if (error?.code === 'ENOENT') return { blobs: [] };
      throw error;
    }

    const hashes = entries.filter(isValidBlobFileName).sort();
    const offset = cursor ? Math.max(0, Number(cursor) || 0) : 0;
    const page = hashes.slice(offset, offset + LIST_PAGE_SIZE);
    const blobs = await Promise.all(
      page.map(async (hash) => {
        try {
          const info = await stat(join(vaultDir, hash));
          return { hash, lastModified: info.mtimeMs };
        } catch {
          return { hash, lastModified: null };
        }
      })
    );

    return {
      blobs,
      nextCursor: offset + page.length < hashes.length ? String(offset + page.length) : undefined
    };
  }

  async deleteBlob(vaultId: string, hash: string): Promise<void> {
    await rm(this.getFilePath(vaultId, hash), { force: true });
  }
}
