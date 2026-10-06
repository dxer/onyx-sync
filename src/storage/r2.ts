import type { IBlobStore } from './types';

export class R2BlobStore implements IBlobStore {
  private bucket: R2Bucket;

  constructor(bucket: R2Bucket) {
    this.bucket = bucket;
  }

  private sanitize(str: string): string {
    return str.replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  private getKey(vaultId: string, hash: string): string {
    const safeVault = this.sanitize(vaultId);
    const safeHash = hash.replace(/[^a-f0-9]/gi, '');
    return `${safeVault}/${safeHash}`;
  }

  async put(vaultId: string, hash: string, data: Uint8Array): Promise<void> {
    const key = this.getKey(vaultId, hash);
    await this.bucket.put(key, data, {
      httpMetadata: {
        contentType: 'application/octet-stream'
      }
    });
  }

  async get(vaultId: string, hash: string): Promise<Uint8Array | null> {
    const key = this.getKey(vaultId, hash);
    const object = await this.bucket.get(key);
    if (!object) return null;
    const arrayBuffer = await object.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }

  async has(vaultId: string, hash: string): Promise<boolean> {
    const key = this.getKey(vaultId, hash);
    const head = await this.bucket.head(key);
    return head !== null;
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
    const safeVault = this.sanitize(vaultId);
    const listed = await this.bucket.list({ prefix: `${safeVault}/` });
    for (const obj of listed.objects) {
      await this.bucket.delete(obj.key);
    }
  }
}
