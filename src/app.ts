import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { randomUUID } from 'node:crypto';
import type {
  User,
  UserToken,
  Vault,
  SyncStatusResponse,
  ChangesResponse,
  CommitPayload,
  BlobCheckResponse,
  AuthRegisterRequest,
  AuthLoginRequest,
  AuthResponse,
  SessionInfoResponse,
  AdminCreateUserRequest,
  UpdateTokenRequest,
  VaultActivityDay
} from '@onyx/shared';
import type { IMetadataStore, IBlobStore, INotifier } from './storage/types';
import { StorageConflictError, StorageNotFoundError } from './storage/errors';
import { hashPassword, newSalt } from './auth-utils';
import { ALPINE_JS, TAILWIND_JS } from './dashboard-assets';
import { DASHBOARD_HTML, DASHBOARD_APP_JS } from './dashboard-html';
import { mintWsTicket, WS_TICKET_TTL_SECONDS } from './ws-tickets';
import {
  DEFAULT_MAX_BLOB_BYTES,
  DEFAULT_MAX_BLOB_CHECKS,
  DEFAULT_MAX_COMMIT_CHANGES,
  MAX_NAME_LENGTH,
  MAX_USERNAME_LENGTH,
  MIN_USERNAME_LENGTH,
  RequestValidationError,
  assertCommitChange,
  assertHash,
  assertLoginPassword,
  assertNewPassword,
  assertNonEmptyString,
  assertRequestId,
  parseChangesLimit,
  parseNonNegativeInteger,
  readBodyWithLimit,
  readJson
} from './request-validation';

export type AppContext = {
  Variables: {
    metadata: IMetadataStore;
    blobs: IBlobStore;
    notifier?: INotifier;
    currentUser?: User;
    currentSession?: {
      user: User;
      tokenInfo: UserToken;
      vault: Vault;
    };
  };
};

export interface AppConfig {
  metadata?: IMetadataStore;
  blobs?: IBlobStore;
  notifier?: INotifier;
  maxBlobBytes?: number;
  maxCommitChanges?: number;
  maxBlobChecks?: number;
  /** Enables POST /api/v1/ws/ticket; absent on deployments without WebSocket support (Worker). */
  wsTicketSecret?: string;
}

const DEFAULT_GC_GRACE_DAYS = 7;
const MAX_GC_GRACE_DAYS = 90;
const MAX_GC_PAGES = 10000;

export function createApp(config?: AppConfig) {
  const app = new Hono<AppContext>();
  const maxBlobBytes = config?.maxBlobBytes ?? DEFAULT_MAX_BLOB_BYTES;
  const maxCommitChanges = config?.maxCommitChanges ?? DEFAULT_MAX_COMMIT_CHANGES;
  const maxBlobChecks = config?.maxBlobChecks ?? DEFAULT_MAX_BLOB_CHECKS;
  const wsTicketSecret = config?.wsTicketSecret;

  app.onError((error, c) => {
    if (error instanceof RequestValidationError) {
      return c.json({ error: error.message }, 400);
    }
    if (error instanceof StorageConflictError) {
      return c.json({ error: error.message, code: error.code }, 409);
    }
    if (error instanceof StorageNotFoundError) {
      return c.json({ error: error.message }, 404);
    }
    console.error('[API] Unhandled request error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  });

  // Enable CORS
  app.use('*', cors());

  // Inject dependencies
  app.use('*', async (c, next) => {
    if (config?.metadata) c.set('metadata', config.metadata);
    if (config?.blobs) c.set('blobs', config.blobs);
    if (config?.notifier) c.set('notifier', config.notifier);
    await next();
  });

  // ==================== DASHBOARD WEB UI ====================

  // No inline scripts and no external origins → a strict CSP is possible.
  const CSP_POLICY =
    "default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
  const dashboardHandler = (c: Context<AppContext>) =>
    c.html(DASHBOARD_HTML, 200, {
      'Content-Security-Policy': CSP_POLICY,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    });
  app.get('/', dashboardHandler);
  app.get('/dashboard', dashboardHandler);
  app.get('/admin', dashboardHandler);

  // Self-hosted vendor/application scripts (formerly Tailwind + Alpine CDNs)
  const jsHeaders = {
    'Content-Type': 'application/javascript; charset=utf-8',
    'Cache-Control': 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff'
  };
  app.get('/assets/tailwind.js', (c) => new Response(TAILWIND_JS, { headers: jsHeaders }));
  app.get('/assets/alpine.min.js', (c) => new Response(ALPINE_JS, { headers: jsHeaders }));
  app.get('/assets/app.js', (c) => new Response(DASHBOARD_APP_JS, { headers: jsHeaders }));

  // Health checks (Public)
  const healthHandler = (c: Context<AppContext>) => c.json({ status: 'ok', time: Date.now() });
  app.get('/api/v1/health', healthHandler);
  app.get('/api/v1/healthz', healthHandler);
  app.get('/api/v1/readyz', async (c) => {
    try {
      await c.get('metadata').getAdminStats();
      return c.json({ status: 'ready', time: Date.now() });
    } catch {
      return c.json({ status: 'not_ready' }, 503);
    }
  });

  // ==================== AUTH ROUTES ====================

  // Check if system needs initial admin setup
  app.get('/api/v1/auth/setup-status', async (c) => {
    const metadata = c.get('metadata');
    const stats = await metadata.getAdminStats();
    return c.json({ needsSetup: stats.totalUsers === 0, totalUsers: stats.totalUsers });
  });

  // Register new user (Only allowed on initial setup when totalUsers === 0)
  app.post('/api/v1/auth/register', async (c) => {
    const metadata = c.get('metadata');
    const stats = await metadata.getAdminStats();

    if (stats.totalUsers > 0) {
      return c.json(
        { error: '公开注册已关闭。如需新账号，请联系管理员在管理控制台中添加。' },
        403
      );
    }

    const body = await readJson<AuthRegisterRequest>(c.req.raw);
    const username = body?.username?.trim();
    const password = body?.password;
    assertNonEmptyString(username, 'username', MAX_USERNAME_LENGTH);
    if (username.length < MIN_USERNAME_LENGTH) {
      throw new RequestValidationError('Username must be at least 3 characters long');
    }
    assertNewPassword(password);

    const existing = await metadata.getUserByUsername(username);
    if (existing) {
      return c.json({ error: 'Username already taken' }, 409);
    }

    const role = 'admin'; // First user is automatically super administrator
    const salt = newSalt();
    const passwordHash = await hashPassword(password, salt);
    const user = await metadata.createUser(username, passwordHash, salt, role);

    const token = await metadata.createToken(user.id, '', 'Web Dashboard');

    const response: AuthResponse = { user, token };
    return c.json(response, 201);
  });

  // User Login (Web dashboard)
  app.post('/api/v1/auth/login', async (c) => {
    const metadata = c.get('metadata');
    const body = await readJson<AuthLoginRequest>(c.req.raw);

    const username = body?.username?.trim();
    const password = body?.password;
    assertNonEmptyString(username, 'username', MAX_USERNAME_LENGTH);
    assertLoginPassword(password);

    const userSecret = await metadata.getUserByUsername(username);
    if (!userSecret) {
      return c.json({ error: 'Invalid username or password' }, 401);
    }

    const computedHash = await hashPassword(password, userSecret.salt);
    if (computedHash !== userSecret.passwordHash) {
      return c.json({ error: 'Invalid username or password' }, 401);
    }

    const token = await metadata.createToken(userSecret.id, '', 'Web Dashboard');
    const user: User = {
      id: userSecret.id,
      username: userSecret.username,
      role: userSecret.role || 'user',
      createdAt: userSecret.createdAt
    };

    const response: AuthResponse = { user, token };
    return c.json(response);
  });

  // ==================== SESSION & SYNC AUTH (TOKEN-AS-CAPABILITY) ====================

  // Client Session Handshake: Client sends Device Token -> receives vault & device info!
  app.get('/api/v1/session', async (c) => {
    const authHeader = c.req.header('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return c.json({ error: 'Missing Device Token' }, 401);
    }

    const metadata = c.get('metadata');
    const session = await metadata.verifyToken(token);

    if (!session) {
      return c.json({ error: 'Invalid or revoked Device Token' }, 401);
    }

    const response: SessionInfoResponse = {
      vaultId: session.vault.id,
      vaultName: session.vault.name,
      userId: session.user.id,
      username: session.user.username,
      deviceName: session.tokenInfo.deviceName,
      salt: session.vault.salt,
      latestVersion: session.vault.latestVersion,
      serverTime: Date.now()
    };

    return c.json(response);
  });

  // Token-scoped Sync Middleware
  app.use('/api/v1/sync/*', async (c, next) => {
    const authHeader = c.req.header('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return c.json({ error: 'Missing Bearer Token' }, 401);
    }

    const metadata = c.get('metadata');
    const session = await metadata.verifyToken(token);

    if (!session) {
      return c.json({ error: 'Unauthorized: Invalid or revoked Device Token' }, 401);
    }

    c.set('currentSession', session);
    await next();
  });

  // Sync: Status
  app.get('/api/v1/sync/status', async (c) => {
    const { vault } = c.get('currentSession')!;
    const response: SyncStatusResponse = {
      vaultId: vault.id,
      name: vault.name,
      salt: vault.salt,
      latestVersion: vault.latestVersion,
      serverTime: Date.now()
    };
    return c.json(response);
  });

  // Sync: Changes (paginated; the client keeps pulling while hasMore is true)
  app.get('/api/v1/sync/changes', async (c) => {
    const metadata = c.get('metadata');
    const { vault } = c.get('currentSession')!;
    const sinceVersion = parseNonNegativeInteger(c.req.query('since') || '0', 'since');
    const limit = parseChangesLimit(c.req.query('limit'));

    const changes = await metadata.getChanges(vault.id, sinceVersion, limit);
    const response: ChangesResponse = {
      vaultId: vault.id,
      latestVersion: vault.latestVersion,
      changes,
      hasMore: changes.length >= limit
    };
    return c.json(response);
  });

  // Sync: Commit
  app.post('/api/v1/sync/commit', async (c) => {
    const metadata = c.get('metadata');
    const notifier = c.get('notifier');
    const { vault, tokenInfo } = c.get('currentSession')!;
    const initialSync = await metadata.acquireInitialSync(vault.id, tokenInfo.tokenId, 10 * 60 * 1000);
    if (initialSync === 'busy' || !(await metadata.canCommitInitialSync(vault.id, tokenInfo.tokenId))) {
      return c.json({ error: 'Another device is initializing this vault', code: 'initial-sync-in-progress' }, 409);
    }
    const payload = await readJson<CommitPayload>(c.req.raw);

    if (!payload || !Array.isArray(payload.changes)) {
      throw new RequestValidationError('Invalid commit payload');
    }
    assertRequestId(payload.requestId);
    if (payload.changes.length > maxCommitChanges) {
      return c.json({ error: 'Too many changes in one commit' }, 413);
    }
    const ids = new Set<string>();
    const paths = new Set<string>();
    for (const change of payload.changes) {
      assertCommitChange(change);
      if (change.id && ids.has(change.id)) {
        throw new RequestValidationError('Duplicate file id in commit');
      }
      if (paths.has(change.encryptedPath)) {
        throw new RequestValidationError('Duplicate encrypted path in commit');
      }
      if (change.id) ids.add(change.id);
      paths.add(change.encryptedPath);
    }

    // The server is zero-knowledge (contentHash is a client-side HMAC it cannot
    // recompute), but it can still require that every referenced blob was
    // uploaded first and that the declared size matches the stored bytes.
    // Otherwise a commit could point at a missing blob and a later download
    // would 404 on every other device.
    const blobs = c.get('blobs');
    for (const change of payload.changes) {
      if (change.isDeleted) continue;
      const blob = await blobs.get(vault.id, change.contentHash);
      if (!blob) {
        return c.json(
          { error: `Blob ${change.contentHash} has not been uploaded`, code: 'blob-missing' },
          409
        );
      }
      if (blob.byteLength !== change.size) {
        return c.json(
          { error: `Blob size mismatch for ${change.contentHash}`, code: 'blob-size-mismatch' },
          400
        );
      }
    }

    try {
      const result = await metadata.commitChanges(
        vault.id,
        tokenInfo.deviceName,
        payload.changes,
        payload.requestId
      );

      if (notifier && result.success && !result.replayed) {
        notifier.notifyChange(vault.id, result.newVersion);
      }

      return c.json(result);
    } catch (err: any) {
      if (err instanceof StorageConflictError) {
        return c.json({ error: err.message, code: err.code }, 409);
      }
      if (err instanceof StorageNotFoundError) {
        return c.json({ error: err.message }, 404);
      }
      console.error('[API] Commit failed:', err);
      return c.json({ error: 'Commit failed' }, 500);
    }
  });

  // A lease prevents two clients from bootstrapping an empty vault at once.
  app.post('/api/v1/sync/initialization/start', async (c) => {
    const metadata = c.get('metadata');
    const { vault, tokenInfo } = c.get('currentSession')!;
    const leaseMs = 10 * 60 * 1000;
    const result = await metadata.acquireInitialSync(vault.id, tokenInfo.tokenId, leaseMs);
    if (result === 'busy') {
      return c.json({ error: 'Another device is initializing this vault', code: 'initial-sync-in-progress' }, 409);
    }
    return c.json({ status: result, leaseSeconds: Math.floor(leaseMs / 1000) });
  });

  app.post('/api/v1/sync/initialization/heartbeat', async (c) => {
    const metadata = c.get('metadata');
    const { vault, tokenInfo } = c.get('currentSession')!;
    const renewed = await metadata.renewInitialSync(vault.id, tokenInfo.tokenId, 10 * 60 * 1000);
    return renewed ? c.json({ success: true }) : c.json({ error: 'Initial sync lease is no longer owned', code: 'initial-sync-in-progress' }, 409);
  });

  app.post('/api/v1/sync/initialization/complete', async (c) => {
    const metadata = c.get('metadata');
    const { vault, tokenInfo } = c.get('currentSession')!;
    await metadata.completeInitialSync(vault.id, tokenInfo.tokenId);
    return c.json({ success: true });
  });

  // Sync: Blobs Check
  app.post('/api/v1/sync/blobs/check', async (c) => {
    const blobs = c.get('blobs');
    const { vault } = c.get('currentSession')!;
    const body = await readJson<{ hashes: string[] }>(c.req.raw);

    if (!body || !Array.isArray(body.hashes)) {
      throw new RequestValidationError('hashes must be an array');
    }
    if (body.hashes.length > maxBlobChecks) {
      return c.json({ error: 'Too many hashes in one request' }, 413);
    }
    for (const hash of body.hashes) assertHash(hash);

    const checkResult = await blobs.checkHashes(vault.id, body.hashes);
    const response: BlobCheckResponse = checkResult;
    return c.json(response);
  });

  // Sync: Upload Blob
  // NOTE: content hashes are client-side HMACs over the plaintext (zero-knowledge
  // E2EE), so the server cannot recompute them. Integrity is enforced by the
  // client: it verifies decrypt(blob) hashes to the claimed value before upload
  // and after every download.
  app.put('/api/v1/sync/blobs/:hash', async (c) => {
    const blobs = c.get('blobs');
    const { vault } = c.get('currentSession')!;
    const hash = c.req.param('hash');
    assertHash(hash);

    const bytes = await readBodyWithLimit(c.req.raw, maxBlobBytes);
    if (bytes.byteLength === 0) {
      return c.json({ error: 'Blob content cannot be empty' }, 400);
    }

    // Content hashes are client-side HMACs; identical bytes re-uploaded under
    // the same hash are idempotent, but different bytes under an existing hash
    // must never silently overwrite stored data.
    const existing = await blobs.get(vault.id, hash);
    if (existing) {
      const identical =
        existing.byteLength === bytes.byteLength &&
        existing.every((value, index) => value === bytes[index]);
      if (!identical) {
        return c.json(
          { error: 'A different blob already exists for this hash', code: 'blob-hash-mismatch' },
          409
        );
      }
      return c.json({ hash, size: existing.byteLength });
    }

    await blobs.put(vault.id, hash, bytes);

    return c.json({ hash, size: bytes.byteLength }, 201);
  });

  // Sync: Download Blob
  app.get('/api/v1/sync/blobs/:hash', async (c) => {
    const blobs = c.get('blobs');
    const { vault } = c.get('currentSession')!;
    const hash = c.req.param('hash');
    assertHash(hash);

    const data = await blobs.get(vault.id, hash);
    if (!data) {
      return c.text('Blob Not Found', 404);
    }

    return new Response(data, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': data.byteLength.toString(),
        'Cache-Control': 'private, no-store'
      }
    });
  });

  // ==================== REALTIME (WEBSOCKET TICKETS) ====================

  // Exchanges the current Bearer token for a single-use, short-lived WebSocket
  // ticket. Deployments without WebSocket support (Cloudflare Worker) return 501;
  // clients fall back to REST polling.
  app.post('/api/v1/ws/ticket', async (c) => {
    if (!wsTicketSecret) {
      return c.json({ error: 'WebSocket tickets are not available on this deployment; use REST + polling' }, 501);
    }

    const authHeader = c.req.header('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return c.json({ error: 'Missing Bearer Token' }, 401);
    }

    const metadata = c.get('metadata');
    const session = await metadata.verifyToken(token);
    if (!session) {
      return c.json({ error: 'Unauthorized: Invalid or revoked Device Token' }, 401);
    }

    const ticket = await mintWsTicket(wsTicketSecret, {
      jti: randomUUID(),
      tokenId: session.tokenInfo.tokenId,
      userId: session.user.id,
      vaultId: session.vault.id,
      exp: Date.now() + WS_TICKET_TTL_SECONDS * 1000
    });

    return c.json({ ticket, expiresIn: WS_TICKET_TTL_SECONDS });
  });

  // ==================== USER WEB DASHBOARD ROUTES ====================

  app.use('/api/v1/user/*', async (c, next) => {
    const authHeader = c.req.header('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return c.json({ error: 'Missing Bearer Token' }, 401);
    }

    const metadata = c.get('metadata');
    const user = await metadata.verifyUserMasterToken(token);

    if (!user) {
      return c.json({ error: 'Unauthorized: Invalid or expired token' }, 401);
    }

    c.set('currentUser', user);
    await next();
  });

  // Current User Profile
  app.get('/api/v1/auth/me', async (c) => {
    const authHeader = c.req.header('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return c.json({ error: 'Unauthorized' }, 401);

    const metadata = c.get('metadata');
    const user = await metadata.verifyUserMasterToken(token);
    if (!user) return c.json({ error: 'Unauthorized' }, 401);

    return c.json({ user });
  });

  // List user vaults
  app.get('/api/v1/user/vaults', async (c) => {
    const metadata = c.get('metadata');
    const user = c.get('currentUser')!;
    const vaults = await metadata.listUserVaults(user.id);
    return c.json({ vaults });
  });

  // Create new Vault on web platform
  app.post('/api/v1/user/vaults', async (c) => {
    const metadata = c.get('metadata');
    const user = c.get('currentUser')!;
    const body = await readJson<{ name: string }>(c.req.raw);

    assertNonEmptyString(body?.name, 'Vault name', MAX_NAME_LENGTH);
    const name = body.name.trim();

    const vaultId = `${name.replace(/[^a-zA-Z0-9_-]/g, '_')}_${randomUUID().slice(0, 8)}`;
    const salt = newSalt();

    const vault = await metadata.createVault({
      id: vaultId,
      userId: user.id,
      name,
      salt
    });

    return c.json({ vault }, 201);
  });

  // Create Device Token for a specific Vault
  app.post('/api/v1/user/vaults/:id/tokens', async (c) => {
    const metadata = c.get('metadata');
    const user = c.get('currentUser')!;
    const vaultId = c.req.param('id');
    const body = await readJson<{ deviceName: string }>(c.req.raw);

    const deviceName = body?.deviceName?.trim() || 'My Device';
    assertNonEmptyString(deviceName, 'Device name', MAX_NAME_LENGTH);

    const vault = await metadata.getVault(vaultId);
    if (!vault) return c.json({ error: 'Vault not found' }, 404);
    if (vault.userId !== user.id) return c.json({ error: 'Forbidden' }, 403);

    const token = await metadata.createToken(user.id, vault.id, deviceName);

    return c.json({ token, deviceName, vaultId: vault.id }, 201);
  });

  const getTokenForManagement = async (c: Context<AppContext>, tokenId: string): Promise<UserToken | Response> => {
    const metadata = c.get('metadata');
    const user = c.get('currentUser')!;
    const tokenInfo = await metadata.getTokenById(tokenId);
    if (!tokenInfo) {
      return c.json({ error: 'Token not found' }, 404);
    }
    if (tokenInfo.userId !== user.id && user.role !== 'admin') {
      return c.json({ error: 'Forbidden' }, 403);
    }
    return tokenInfo;
  };

  // Rename Device for Token
  app.patch('/api/v1/user/tokens/:tokenId', async (c) => {
    const metadata = c.get('metadata');
    const tokenId = c.req.param('tokenId');
    const body = await readJson<UpdateTokenRequest>(c.req.raw);

    assertNonEmptyString(body?.deviceName, 'Device name', MAX_NAME_LENGTH);
    const deviceName = body.deviceName.trim();

    const tokenInfo = await getTokenForManagement(c, tokenId);
    if (tokenInfo instanceof Response) return tokenInfo;

    await metadata.updateToken(tokenId, deviceName);
    return c.json({ success: true, deviceName });
  });

  // Rotate / Regenerate Token for Device
  app.post('/api/v1/user/tokens/:tokenId/rotate', async (c) => {
    const metadata = c.get('metadata');
    const tokenId = c.req.param('tokenId');

    const tokenInfo = await getTokenForManagement(c, tokenId);
    if (tokenInfo instanceof Response) return tokenInfo;

    const newToken = await metadata.rotateToken(tokenId);
    if (!newToken) return c.json({ error: 'Failed to rotate token' }, 500);

    return c.json({
      success: true,
      token: newToken,
      deviceName: tokenInfo.deviceName,
      vaultId: tokenInfo.vaultId
    });
  });

  // Revoke / Delete Device Token
  app.delete('/api/v1/user/tokens/:tokenId', async (c) => {
    const metadata = c.get('metadata');
    const tokenId = c.req.param('tokenId');

    const tokenInfo = await getTokenForManagement(c, tokenId);
    if (tokenInfo instanceof Response) return tokenInfo;

    await metadata.deleteToken(tokenId);
    return c.json({ success: true });
  });

  // Get Vault 365-day Activity Data
  app.get('/api/v1/user/vaults/:id/activity', async (c) => {
    const metadata = c.get('metadata');
    const user = c.get('currentUser')!;
    const vaultId = c.req.param('id');
    const days = parseNonNegativeInteger(c.req.query('days') || '365', 'days');
    if (days > 3650) {
      throw new RequestValidationError('days exceeds the maximum allowed range');
    }

    const vault = await metadata.getVault(vaultId);
    if (!vault) return c.json({ error: 'Vault not found' }, 404);
    if (vault.userId !== user.id && user.role !== 'admin') {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const sinceMs = Date.now() - Math.max(1, days) * 86400000;
    const activity = await metadata.getVaultActivity(vaultId, sinceMs);
    return c.json({ activity });
  });

  // Delete user vault (async job: metadata first, then physical blobs)
  app.delete('/api/v1/user/vaults/:id', async (c) => {
    const metadata = c.get('metadata');
    const blobs = c.get('blobs');
    const user = c.get('currentUser')!;
    const vaultId = c.req.param('id');

    const vault = await metadata.getVault(vaultId);
    if (!vault) return c.json({ error: 'Vault not found' }, 404);
    if (vault.userId !== user.id) return c.json({ error: 'Forbidden' }, 403);

    const job = await metadata.createDeletionJob('vault', vaultId, user.id);
    try {
      await metadata.deleteVault(vaultId);
      await blobs.deleteVault(vaultId);
      const updated = await metadata.updateDeletionJob(job.jobId, 'completed');
      return c.json({ success: true, jobId: job.jobId, status: updated?.status || 'completed' });
    } catch (error) {
      console.error('[API] Vault deletion failed:', error);
      const message = error instanceof Error ? error.message : String(error);
      const updated = await metadata.updateDeletionJob(job.jobId, 'failed', message).catch(() => null);
      return c.json(
        {
          error: 'Vault deletion scheduled for retry',
          jobId: job.jobId,
          status: updated?.status || 'failed'
        },
        202
      );
    }
  });

  // Deletion job status
  app.get('/api/v1/user/deletion-jobs/:jobId', async (c) => {
    const metadata = c.get('metadata');
    const user = c.get('currentUser')!;
    const job = await metadata.getDeletionJob(c.req.param('jobId'));
    if (!job) return c.json({ error: 'Deletion job not found' }, 404);
    if (job.ownerUserId !== user.id && user.role !== 'admin') {
      return c.json({ error: 'Forbidden' }, 403);
    }
    return c.json({ job });
  });

  // Retry a failed deletion job
  app.post('/api/v1/user/deletion-jobs/:jobId/retry', async (c) => {
    const metadata = c.get('metadata');
    const blobs = c.get('blobs');
    const user = c.get('currentUser')!;
    const job = await metadata.getDeletionJob(c.req.param('jobId'));
    if (!job) return c.json({ error: 'Deletion job not found' }, 404);
    if (job.ownerUserId !== user.id && user.role !== 'admin') {
      return c.json({ error: 'Forbidden' }, 403);
    }
    if (job.resourceType !== 'vault') {
      return c.json({ error: 'Only vault deletion jobs can be retried here' }, 400);
    }

    try {
      await metadata.deleteVault(job.resourceId);
      await blobs.deleteVault(job.resourceId);
      const updated = await metadata.updateDeletionJob(job.jobId, 'completed');
      return c.json({ success: true, job: updated });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const updated = await metadata.updateDeletionJob(job.jobId, 'failed', message).catch(() => null);
      return c.json({ error: 'Deletion retry scheduled', job: updated || job }, 202);
    }
  });

  // Garbage-collect unreferenced blobs of a vault.
  // Deletes stored blobs that no live file_record references and that are older
  // than the grace period (protects blobs of in-flight commits).
  app.post('/api/v1/user/vaults/:id/gc', async (c) => {
    const metadata = c.get('metadata');
    const blobs = c.get('blobs');
    const user = c.get('currentUser')!;
    const vaultId = c.req.param('id');

    const vault = await metadata.getVault(vaultId);
    if (!vault) return c.json({ error: 'Vault not found' }, 404);
    if (vault.userId !== user.id && user.role !== 'admin') {
      return c.json({ error: 'Forbidden' }, 403);
    }

    let graceDays = DEFAULT_GC_GRACE_DAYS;
    let body: { graceDays?: number } | null = null;
    try {
      body = await c.req.raw.json();
    } catch {
      body = null; // empty body → default grace period
    }
    if (body && body.graceDays !== undefined) {
      if (!Number.isSafeInteger(body.graceDays) || body.graceDays < 0 || body.graceDays > MAX_GC_GRACE_DAYS) {
        throw new RequestValidationError(`graceDays must be an integer between 0 and ${MAX_GC_GRACE_DAYS}`);
      }
      graceDays = body.graceDays;
    }

    const referenced = new Set(await metadata.listActiveBlobHashes(vaultId));
    const cutoff = Date.now() - graceDays * 86400000;

    let cursor: string | undefined;
    let scanned = 0;
    let deleted = 0;
    let kept = 0;
    let pages = 0;

    do {
      const page = await blobs.list(vaultId, cursor);
      for (const entry of page.blobs) {
        scanned++;
        if (referenced.has(entry.hash)) {
          kept++;
          continue;
        }
        if (graceDays > 0 && entry.lastModified !== null && entry.lastModified > cutoff) {
          kept++;
          continue;
        }
        await blobs.deleteBlob(vaultId, entry.hash);
        deleted++;
      }
      cursor = page.nextCursor;
    } while (cursor && ++pages < MAX_GC_PAGES);

    return c.json({ vaultId, scanned, deleted, kept, graceDays });
  });

  // ==================== ADMIN ROUTES ====================

  const checkAdmin = async (c: any, next: any) => {
    const authHeader = c.req.header('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return c.json({ error: 'Unauthorized' }, 401);

    const metadata = c.get('metadata');
    const user = await metadata.verifyUserMasterToken(token);
    if (!user || user.role !== 'admin') {
      return c.json({ error: 'Forbidden: Admin access required' }, 403);
    }
    await next();
  };

  app.get('/api/v1/admin/stats', checkAdmin, async (c) => {
    const metadata = c.get('metadata');
    const stats = await metadata.getAdminStats();
    return c.json({ stats });
  });

  app.get('/api/v1/admin/users', checkAdmin, async (c) => {
    const metadata = c.get('metadata');
    const users = await metadata.listAllUsers();
    return c.json({ users });
  });

  app.post('/api/v1/admin/users', checkAdmin, async (c) => {
    const metadata = c.get('metadata');
    const body = await readJson<AdminCreateUserRequest>(c.req.raw);

    const username = body?.username?.trim();
    const password = body?.password;
    assertNonEmptyString(username, 'username', MAX_USERNAME_LENGTH);
    if (username.length < MIN_USERNAME_LENGTH) {
      throw new RequestValidationError('用户名长度至少需要 3 位');
    }
    assertNewPassword(password);
    const role = body.role === 'admin' ? 'admin' : 'user';

    const existing = await metadata.getUserByUsername(username);
    if (existing) {
      return c.json({ error: '该用户名已被使用' }, 409);
    }

    const salt = newSalt();
    const passwordHash = await hashPassword(password, salt);
    const user = await metadata.createUser(username, passwordHash, salt, role);

    return c.json({ user }, 201);
  });

  app.delete('/api/v1/admin/users/:id', checkAdmin, async (c) => {
    const metadata = c.get('metadata');
    const blobs = c.get('blobs');
    const userId = c.req.param('id');

    const vaults = await metadata.listUserVaults(userId);
    const jobs: Array<{ vaultId: string; jobId: string; status: string }> = [];
    for (const v of vaults) {
      const job = await metadata.createDeletionJob('vault', v.id, userId);
      try {
        await metadata.deleteVault(v.id);
        await blobs.deleteVault(v.id);
        await metadata.updateDeletionJob(job.jobId, 'completed');
        jobs.push({ vaultId: v.id, jobId: job.jobId, status: 'completed' });
      } catch (error) {
        console.error(`[API] Vault ${v.id} deletion failed:`, error);
        const message = error instanceof Error ? error.message : String(error);
        const updated = await metadata.updateDeletionJob(job.jobId, 'failed', message).catch(() => null);
        jobs.push({ vaultId: v.id, jobId: job.jobId, status: updated?.status || 'failed' });
      }
    }
    await metadata.deleteUser(userId);
    return c.json({ success: true, jobs });
  });

  return app;
}

export const app = createApp();
