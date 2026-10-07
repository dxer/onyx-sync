import type { IBlobStore, BlobListPage } from './types';
import { assertHash } from '../request-validation';
import { isValidBlobFileName, normalizeBlobHash } from './blob-utils';

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
    return `${safeVault}/${normalizeBlobHash(hash)}`;
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
    let cursor: string | undefined;

    do {
      const listed = await this.bucket.list({ prefix: `${safeVault}/`, cursor });
      const keys = listed.objects.map((obj) => obj.key);
      await Promise.all(keys.map((key) => this.bucket.delete(key)));
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
  }

  async list(vaultId: string, cursor?: string): Promise<BlobListPage> {
    const safeVault = this.sanitize(vaultId);
    const prefix = `${safeVault}/`;
    const listed = await this.bucket.list({ prefix, cursor });

    const blobs = listed.objects
      .map((obj) => ({
        hash: obj.key.slice(prefix.length),
        lastModified: obj.uploaded ? new Date(obj.uploaded).getTime() : null
      }))
      .filter((entry) => isValidBlobFileName(entry.hash));

    return {
      blobs,
      nextCursor: listed.truncated ? listed.cursor : undefined
    };
  }

  async deleteBlob(vaultId: string, hash: string): Promise<void> {
    assertHash(hash);
    await this.bucket.delete(this.getKey(vaultId, hash));
  }
}
