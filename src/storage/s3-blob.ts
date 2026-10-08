import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command
} from '@aws-sdk/client-s3';
import type { IBlobStore, BlobListPage } from './types';
import { assertHash } from '../request-validation';
import { isValidBlobFileName, normalizeBlobHash } from './blob-utils';

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
    return `${this.prefix}${safeVault}/${normalizeBlobHash(hash)}`;
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
    } catch (error: any) {
      if (error?.name === 'NoSuchKey' || error?.name === 'NotFound' || error?.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw error;
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
    } catch (error: any) {
      if (error?.name === 'NoSuchKey' || error?.name === 'NotFound' || error?.$metadata?.httpStatusCode === 404) return false;
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
    const safeVault = this.sanitize(vaultId);
    const prefix = `${this.prefix}${safeVault}/`;
    let continuationToken: string | undefined;

    do {
      const listResp = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken
      }));
      const keys = (listResp.Contents || [])
        .map((object) => object.Key)
        .filter((key): key is string => Boolean(key));

      for (let index = 0; index < keys.length; index += 1000) {
        const batch = keys.slice(index, index + 1000);
        if (batch.length === 0) continue;
        const result = await this.client.send(new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })) }
        }));
        if (result.Errors && result.Errors.length > 0) {
          throw new Error(`Failed to delete ${result.Errors.length} blob objects`);
        }
      }

      continuationToken = listResp.IsTruncated ? listResp.NextContinuationToken : undefined;
    } while (continuationToken);
  }

  async list(vaultId: string, cursor?: string): Promise<BlobListPage> {
    const safeVault = this.sanitize(vaultId);
    const prefix = `${this.prefix}${safeVault}/`;
    const listResp = await this.client.send(new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: prefix,
      ContinuationToken: cursor || undefined
    }));

    const blobs = (listResp.Contents || [])
      .map((object) => ({
        hash: (object.Key || '').slice(prefix.length),
        lastModified: object.LastModified ? object.LastModified.getTime() : null
      }))
      .filter((entry) => isValidBlobFileName(entry.hash));

    return {
      blobs,
      nextCursor: listResp.IsTruncated ? listResp.NextContinuationToken : undefined
    };
  }

  async deleteBlob(vaultId: string, hash: string): Promise<void> {
    assertHash(hash);
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: this.getKey(vaultId, hash)
    }));
  }
}
