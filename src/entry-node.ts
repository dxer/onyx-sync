import { serve } from '@hono/node-server';
import { WebSocketServer, WebSocket } from 'ws';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createApp } from './app';
import { ensureAdminFromEnv } from './admin-bootstrap';
import { hashPasswordForManualSql, parseAdminResetArgs, parsePasswordArg, parseUsernameArg, resetUserPassword } from './admin-cli';
import { SqliteMetadataStore } from './storage/sqlite';
import { LocalFsBlobStore } from './storage/fs-blob';
import { S3BlobStore } from './storage/s3-blob';
import type { IMetadataStore, INotifier } from './storage/types';
import { verifyWsTicket } from './ws-tickets';

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
  } catch (err) {
    console.warn(`[Config] Could not parse .env file at ${filePath}:`, err);
  }
}

loadEnv();

// Read configuration from environment variables
const PORT = Number(process.env.PORT) || 8080;
const DB_PATH = process.env.DB_PATH || join(process.cwd(), 'data', 'sync.db');
const STORAGE_TYPE = process.env.STORAGE_TYPE || 'local';
const LOCAL_DIR = process.env.STORAGE_LOCAL_DIR || join(process.cwd(), 'data', 'blobs');
const MAX_BLOB_BYTES = Number(process.env.MAX_BLOB_BYTES) || undefined;
const MAX_COMMIT_CHANGES = Number(process.env.MAX_COMMIT_CHANGES) || undefined;
const MAX_BLOB_CHECKS = Number(process.env.MAX_BLOB_CHECKS) || undefined;
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = Number(process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS) || undefined;
const LOGIN_RATE_LIMIT_WINDOW_SECONDS = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_SECONDS) || undefined;

// Secret used to sign short-lived WebSocket tickets. An ephemeral fallback keeps
// single-process deployments working; set WS_TICKET_SECRET to keep tickets valid
// across restarts.
const WS_TICKET_SECRET = process.env.WS_TICKET_SECRET || randomBytes(32).toString('hex');
if (!process.env.WS_TICKET_SECRET) {
  console.warn('[Config] WS_TICKET_SECRET not set; using an ephemeral secret (outstanding tickets die on restart).');
}

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
  tokenId: string;
  deviceName: string;
}

const clients = new Set<ConnectedClient>();

// Single-use enforcement for WebSocket tickets (stateless signature + local replay cache)
const usedTickets = new Map<string, number>();
setInterval(() => {
  const now = Date.now();
  for (const [jti, expiresAt] of usedTickets) {
    if (expiresAt < now) usedTickets.delete(jti);
  }
}, 60_000).unref();

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
  notifier,
  maxBlobBytes: MAX_BLOB_BYTES,
  maxCommitChanges: MAX_COMMIT_CHANGES,
  maxBlobChecks: MAX_BLOB_CHECKS,
  corsOrigins: CORS_ORIGINS,
  loginRateLimit: {
    maxAttempts: LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
    windowSeconds: LOGIN_RATE_LIMIT_WINDOW_SECONDS
  },
  wsTicketSecret: WS_TICKET_SECRET
});

// First-boot admin provisioning. ADMIN_PASSWORD is honored exactly once —
// it never overwrites an existing account (see src/admin-bootstrap.ts).
async function ensureAdminAccount(metadataStore: IMetadataStore) {
  await ensureAdminFromEnv(metadataStore, {
    adminUsername: process.env.ADMIN_USERNAME?.trim(),
    adminPassword: process.env.ADMIN_PASSWORD
  });
}

// 5. Bootstrap Server
async function bootstrap() {
  await metadata.init();
  if (blobs instanceof LocalFsBlobStore) {
    await blobs.init();
  }

  // Synchronize admin credentials from .env
  await ensureAdminAccount(metadata);

  const server = serve({
    fetch: app.fetch,
    port: PORT
  });

  // Attach WebSocket server on /api/v1/ws
  const wss = new WebSocketServer({ server: server as any, path: '/api/v1/ws' });

  wss.on('connection', async (ws, req) => {
    const url = new URL(req.url || '', `http://localhost:${PORT}`);
    const ticket = url.searchParams.get('ticket');

    if (!ticket) {
      ws.close(4001, 'Unauthorized: Missing ticket');
      return;
    }

    const payload = await verifyWsTicket(WS_TICKET_SECRET, ticket);
    if (!payload) {
      ws.close(4001, 'Unauthorized: Invalid or expired ticket');
      return;
    }
    if (usedTickets.has(payload.jti)) {
      ws.close(4001, 'Unauthorized: Ticket already used');
      return;
    }
    usedTickets.set(payload.jti, payload.exp);

    // Re-check the underlying credential: revocation must survive ticket minting.
    if (!(await metadata.isTokenActive(payload.tokenId))) {
      ws.close(4001, 'Unauthorized: Token revoked or expired');
      return;
    }

    const vault = await metadata.getVault(payload.vaultId);
    if (!vault) {
      ws.close(4001, 'Unauthorized: Vault no longer exists');
      return;
    }

    const tokenInfo = await metadata.getTokenById(payload.tokenId);
    const client: ConnectedClient = {
      ws,
      vaultId: payload.vaultId,
      tokenId: payload.tokenId,
      deviceName: tokenInfo?.deviceName || 'Device'
    };
    clients.add(client);

    ws.on('close', () => {
      clients.delete(client);
    });

    ws.on('error', () => {
      clients.delete(client);
    });

    ws.send(JSON.stringify({ event: 'connected', vaultId: client.vaultId, deviceName: client.deviceName }));
  });

  // Revoke/expiry enforcement for live sockets
  setInterval(async () => {
    for (const client of clients) {
      try {
        if (!(await metadata.isTokenActive(client.tokenId))) {
          client.ws.close(4004, 'Token revoked or expired');
          clients.delete(client);
        }
      } catch {
        // keep the socket on transient storage errors
      }
    }
  }, 60_000).unref();

  console.log(`🚀 Onyx Sync Server started on http://0.0.0.0:${PORT}`);
  console.log('🔌 WebSocket real-time endpoint at /api/v1/ws (short-lived ticket auth via POST /api/v1/ws/ticket)');
}

// Local recovery subcommands. These run INSTEAD of the server and need only
// the metadata store — e.g. inside Docker:
//   docker exec onyx-sync-server node dist/node/entry-node.js admin:reset-password --username admin --password <new>
// The password may also come from ONYX_RESET_PASSWORD to keep it out of shell history.
async function runAdminSubcommand(command: string, args: string[]): Promise<void> {
  const store = new SqliteMetadataStore(DB_PATH);
  await store.init();
  try {
    if (command === 'admin:reset-password') {
      const parsed = parseAdminResetArgs(args);
      const result = await resetUserPassword(store, parsed);
      console.log(
        `[Auth] Password for "${result.username}" has been reset. ` +
          `Ship the [AUDIT] line above to your persistent logs.`
      );
    } else {
      const username = parseUsernameArg(args) || '<username>';
      const password = parsePasswordArg(args);
      const { salt, passwordHash } = await hashPasswordForManualSql(password);
      console.log(`salt: ${salt}`);
      console.log(`password_hash: ${passwordHash}`);
      console.log(
        `SQL: UPDATE users SET password_hash = '${passwordHash}', salt = '${salt}' WHERE username = '${username}';`
      );
    }
  } finally {
    store.close();
  }
}

const subcommand = process.argv[2];
if (subcommand === 'admin:reset-password' || subcommand === 'admin:hash-password') {
  runAdminSubcommand(subcommand, process.argv.slice(3)).then(
    () => process.exit(0),
    (err) => {
      console.error(`[Auth] ${subcommand} failed:`, err instanceof Error ? err.message : err);
      process.exit(1);
    }
  );
} else {
  bootstrap().catch((err) => {
    console.error('Fatal bootstrap error:', err);
    process.exit(1);
  });
}
