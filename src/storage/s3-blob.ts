import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command
} from '@aws-sdk/client-s3';
import type { IBlobStore } from './types';

export interface S3Config {
  endpoint?: string;
  region?: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix?: string;
}

export class S3BlobStore implements IBlobStore {
  private client: S3Client;
  private bucket: string;
  private prefix: string;

  constructor(config: S3Config) {
    this.bucket = config.bucket;
    this.prefix = config.prefix ? (config.prefix.endsWith('/') ? config.prefix : `${config.prefix}/`) : '';

    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region || 'auto',
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      },
      forcePathStyle: true
    });
  }

  private sanitize(str: string): string {
    return str.replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  private getKey(vaultId: string, hash: string): string {
    const safeVault = this.sanitize(vaultId);
    const safeHash = hash.replace(/[^a-f0-9]/gi, '');
    return `${this.prefix}${safeVault}/${safeHash}`;
  }

  async put(vaultId: string, hash: string, data: Uint8Array): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: this.getKey(vaultId, hash),
      Body: data,
      ContentType: 'application/octet-stream'
    });
    await this.client.send(command);
  }

  async get(vaultId: string, hash: string): Promise<Uint8Array | null> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.getKey(vaultId, hash)
      });
      const response = await this.client.send(command);
      if (!response.Body) return null;
      return await response.Body.transformToByteArray();
    } catch {
      return null;
    }
  }

  async has(vaultId: string, hash: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: this.getKey(vaultId, hash)
      });
      await this.client.send(command);
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
    const safeVault = this.sanitize(vaultId);
    const prefix = `${this.prefix}${safeVault}/`;

    const listCmd = new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: prefix
    });
    const listResp = await this.client.send(listCmd);

    if (listResp.Contents && listResp.Contents.length > 0) {
      const deleteCmd = new DeleteObjectsCommand({
        Bucket: this.bucket,
        Delete: {
          Objects: listResp.Contents.map((c) => ({ Key: c.Key }))
        }
      });
      await this.client.send(deleteCmd);
    }
  }
}
