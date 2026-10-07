import { createApp } from './app';
import { D1MetadataStore } from './storage/d1';
import { R2BlobStore } from './storage/r2';

export interface CloudflareEnv {
  DB: D1Database;
  BUCKET: R2Bucket;
  MAX_BLOB_BYTES?: string;
  MAX_COMMIT_CHANGES?: string;
  MAX_BLOB_CHECKS?: string;
}

export default {
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext): Promise<Response> {
    const metadata = new D1MetadataStore(env.DB);
    const blobs = new R2BlobStore(env.BUCKET);
    await metadata.init();

    const app = createApp({
      metadata,
      blobs,
      maxBlobBytes: env.MAX_BLOB_BYTES ? Number(env.MAX_BLOB_BYTES) : undefined,
      maxCommitChanges: env.MAX_COMMIT_CHANGES ? Number(env.MAX_COMMIT_CHANGES) : undefined,
      maxBlobChecks: env.MAX_BLOB_CHECKS ? Number(env.MAX_BLOB_CHECKS) : undefined
    });

    return app.fetch(request, env as any, ctx);
  }
};
