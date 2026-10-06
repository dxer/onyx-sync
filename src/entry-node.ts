import { serve } from '@hono/node-server';
import { WebSocketServer, WebSocket } from 'ws';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { createApp } from './app';
import { SqliteMetadataStore } from './storage/sqlite';
import { LocalFsBlobStore } from './storage/fs-blob';
import { S3BlobStore } from './storage/s3-blob';
import type { IMetadataStore, INotifier } from './storage/types';
import { hashPassword, newSalt } from './auth-utils';

// Load .env configuration
function loadEnv() {
  const possiblePaths = [
    join(process.cwd(), '.env'),
    join(process.cwd(), 'packages', 'server', '.env'),
    join(__dirname, '.env'),
    join(__dirname, '..', '..', '.env')
  ];

  for (const envPath of possiblePaths) {
    if (existsSync(envPath)) {
      try {
        if (typeof (process as any).loadEnvFile === 'function') {
          (process as any).loadEnvFile(envPath);
        } else {
          parseAndInjectEnv(envPath);
        }
      } catch {
        parseAndInjectEnv(envPath);
      }
      console.log(`[Config] Loaded environment variables from ${envPath}`);
      break;
    }
  }
}

function parseAndInjectEnv(filePath: string) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx !== -1) {
        const key = line.slice(0, eqIdx).trim();
        const val = line.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  } catch {}
}

loadEnv();

// Read configuration from environment variables
const PORT = Number(process.env.PORT) || 8080;
const DB_PATH = process.env.DB_PATH || join(process.cwd(), 'data', 'sync.db');
const STORAGE_TYPE = process.env.STORAGE_TYPE || 'local';
const LOCAL_DIR = process.env.STORAGE_LOCAL_DIR || join(process.cwd(), 'data', 'blobs');

// 1. Initialize SQLite Metadata Store
const metadata = new SqliteMetadataStore(DB_PATH);

// 2. Initialize Blob Store (Local File System or S3)
let blobs: LocalFsBlobStore | S3BlobStore;
if (STORAGE_TYPE === 's3') {
  console.log('[Storage] Initializing S3 Blob Store...');
  blobs = new S3BlobStore({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || 'auto',
    bucket: process.env.S3_BUCKET || 'onyx-blobs',
    accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
    prefix: process.env.S3_PREFIX
  });
} else {
  console.log(`[Storage] Initializing Local File System Blob Store at ${LOCAL_DIR}...`);
  blobs = new LocalFsBlobStore(LOCAL_DIR);
}

// 3. Setup WebSocket Notifier for connected clients
interface ConnectedClient {
  ws: WebSocket;
  vaultId: string;
}

const clients = new Set<ConnectedClient>();

const notifier: INotifier = {
  notifyChange(vaultId: string, version: number) {
    const payload = JSON.stringify({
      event: 'version_bump',
      vaultId,
      version,
      timestamp: Date.now()
    });

    for (const client of clients) {
      if (client.vaultId === vaultId && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(payload);
      }
    }
  }
};

// 4. Create App with configured stores
const app = createApp({
  metadata,
  blobs,
  notifier
});

// Helper: Ensure administrator account matches .env configuration
async function syncAdminFromEnv(metadataStore: IMetadataStore) {
  const adminUsername = process.env.ADMIN_USERNAME?.trim();
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminUsername || !adminPassword) {
    return;
  }

  const existingUser = await metadataStore.getUserByUsername(adminUsername);
  if (!existingUser) {
    const salt = newSalt();
    const passwordHash = await hashPassword(adminPassword, salt);
    await metadataStore.createUser(adminUsername, passwordHash, salt, 'admin');
    console.log(`[Auth] Initialized super administrator "${adminUsername}" from .env.`);
  } else {
    const computedHash = await hashPassword(adminPassword, existingUser.salt);
    if (computedHash !== existingUser.passwordHash || existingUser.role !== 'admin') {
      const salt = newSalt();
      const passwordHash = await hashPassword(adminPassword, salt);
      await metadataStore.updateUserPassword(existingUser.id, passwordHash, salt, 'admin');
      console.log(`[Auth] Synchronized super administrator "${adminUsername}" password from .env.`);
    } else {
      console.log(`[Auth] Super administrator "${adminUsername}" verified from .env.`);
    }
  }
}

// 5. Bootstrap Server
async function bootstrap() {
  await metadata.init();
  if (blobs instanceof LocalFsBlobStore) {
    await blobs.init();
  }

  // Synchronize admin credentials from .env
  await syncAdminFromEnv(metadata);

  const server = serve({
    fetch: app.fetch,
    port: PORT
  });

  // Attach WebSocket server on /api/v1/ws
  const wss = new WebSocketServer({ server: server as any, path: '/api/v1/ws' });

  wss.on('connection', async (ws, req) => {
    const url = new URL(req.url || '', `http://localhost:${PORT}`);
    const token = url.searchParams.get('token');

    if (!token) {
      ws.close(4001, 'Unauthorized: Missing token');
      return;
    }

    const session = await metadata.verifyToken(token);
    if (!session) {
      ws.close(4001, 'Unauthorized: Invalid token');
      return;
    }

    const vaultId = session.vault.id;
    const client: ConnectedClient = { ws, vaultId };
    clients.add(client);

    ws.on('close', () => {
      clients.delete(client);
    });

    ws.on('error', () => {
      clients.delete(client);
    });

    ws.send(JSON.stringify({ event: 'connected', vaultId, deviceName: session.tokenInfo.deviceName }));
  });

  console.log(`🚀 Onyx Sync Server started on http://0.0.0.0:${PORT}`);
  console.log(`🔌 WebSocket real-time endpoint available at ws://0.0.0.0:${PORT}/api/v1/ws`);
}

bootstrap().catch((err) => {
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
