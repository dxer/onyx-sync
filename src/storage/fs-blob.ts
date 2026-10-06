import { mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { IBlobStore } from './types';

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
    const safeHash = hash.replace(/[^a-f0-9]/gi, '');
    return join(this.blobsDir, safeVault, safeHash);
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
    } catch {
      return null;
    }
  }

  async has(vaultId: string, hash: string): Promise<boolean> {
    const filePath = this.getFilePath(vaultId, hash);
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
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
}
