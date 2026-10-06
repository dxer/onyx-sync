import { createApp } from './app';
import { D1MetadataStore } from './storage/d1';
import { R2BlobStore } from './storage/r2';

export interface CloudflareEnv {
  DB: D1Database;
  BUCKET: R2Bucket;
}

export default {
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext): Promise<Response> {
    const metadata = new D1MetadataStore(env.DB);
    const blobs = new R2BlobStore(env.BUCKET);

    const app = createApp({
      metadata,
      blobs
    });

    return app.fetch(request, env as any, ctx);
  }
};
