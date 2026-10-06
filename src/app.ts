import { Hono } from 'hono';
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
import { hashPassword, newSalt } from './auth-utils';
import { DASHBOARD_HTML } from './dashboard-html';

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
}

export function createApp(config?: AppConfig) {
  const app = new Hono<AppContext>();

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
  app.get('/', (c) => c.html(DASHBOARD_HTML));
  app.get('/dashboard', (c) => c.html(DASHBOARD_HTML));
  app.get('/admin', (c) => c.html(DASHBOARD_HTML));

  // Health check (Public)
  app.get('/api/v1/health', (c) => {
    return c.json({ status: 'ok', time: Date.now() });
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

    const body = await c.req.json<AuthRegisterRequest>();
    const username = body.username?.trim();
    const password = body.password;

    if (!username || username.length < 3) {
      return c.json({ error: 'Username must be at least 3 characters long' }, 400);
    }
    if (!password || password.length < 6) {
      return c.json({ error: 'Password must be at least 6 characters long' }, 400);
    }

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
    const body = await c.req.json<AuthLoginRequest>();

    const username = body.username?.trim();
    const password = body.password;

    if (!username || !password) {
      return c.json({ error: 'Missing username or password' }, 400);
    }

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

  // Sync: Changes
  app.get('/api/v1/sync/changes', async (c) => {
    const metadata = c.get('metadata');
    const { vault } = c.get('currentSession')!;
    const sinceVersion = Number(c.req.query('since') || 0);

    const changes = await metadata.getChanges(vault.id, sinceVersion);
    const response: ChangesResponse = {
      vaultId: vault.id,
      latestVersion: vault.latestVersion,
      changes
    };
    return c.json(response);
  });

  // Sync: Commit
  app.post('/api/v1/sync/commit', async (c) => {
    const metadata = c.get('metadata');
    const notifier = c.get('notifier');
    const { vault, tokenInfo } = c.get('currentSession')!;
    const payload = await c.req.json<CommitPayload>();

    if (!Array.isArray(payload.changes)) {
      return c.json({ error: 'Invalid commit payload' }, 400);
    }

    try {
      const result = await metadata.commitChanges(
        vault.id,
        tokenInfo.deviceName,
        payload.changes
      );

      if (notifier && result.success) {
        notifier.notifyChange(vault.id, result.newVersion);
      }

      return c.json(result);
    } catch (err: any) {
      return c.json({ error: err.message || 'Commit failed' }, 500);
    }
  });

  // Sync: Blobs Check
  app.post('/api/v1/sync/blobs/check', async (c) => {
    const blobs = c.get('blobs');
    const { vault } = c.get('currentSession')!;
    const body = await c.req.json<{ hashes: string[] }>();

    if (!Array.isArray(body.hashes)) {
      return c.json({ error: 'hashes must be an array' }, 400);
    }

    const checkResult = await blobs.checkHashes(vault.id, body.hashes);
    const response: BlobCheckResponse = checkResult;
    return c.json(response);
  });

  // Sync: Upload Blob
  app.put('/api/v1/sync/blobs/:hash', async (c) => {
    const blobs = c.get('blobs');
    const { vault } = c.get('currentSession')!;
    const hash = c.req.param('hash');

    const arrayBuffer = await c.req.arrayBuffer();
    if (arrayBuffer.byteLength === 0) {
      return c.json({ error: 'Blob content cannot be empty' }, 400);
    }

    const bytes = new Uint8Array(arrayBuffer);
    await blobs.put(vault.id, hash, bytes);

    return c.json({ hash, size: bytes.byteLength }, 201);
  });

  // Sync: Download Blob
  app.get('/api/v1/sync/blobs/:hash', async (c) => {
    const blobs = c.get('blobs');
    const { vault } = c.get('currentSession')!;
    const hash = c.req.param('hash');

    const data = await blobs.get(vault.id, hash);
    if (!data) {
      return c.text('Blob Not Found', 404);
    }

    return new Response(data, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': data.byteLength.toString(),
        'Cache-Control': 'public, max-age=31536000, immutable'
      }
    });
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
    const body = await c.req.json<{ name: string }>();

    const name = body.name?.trim();
    if (!name) {
      return c.json({ error: 'Vault name is required' }, 400);
    }

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
    const body = await c.req.json<{ deviceName: string }>();

    const deviceName = body.deviceName?.trim() || 'My Device';

    const vault = await metadata.getVault(vaultId);
    if (!vault) return c.json({ error: 'Vault not found' }, 404);
    if (vault.userId !== user.id) return c.json({ error: 'Forbidden' }, 403);

    const token = await metadata.createToken(user.id, vault.id, deviceName);

    return c.json({ token, deviceName, vaultId: vault.id }, 201);
  });

  // Rename Device for Token
  app.patch('/api/v1/user/tokens/:token', async (c) => {
    const metadata = c.get('metadata');
    const user = c.get('currentUser')!;
    const token = c.req.param('token');
    const body = await c.req.json<UpdateTokenRequest>();

    const deviceName = body.deviceName?.trim();
    if (!deviceName) {
      return c.json({ error: 'Device name cannot be empty' }, 400);
    }

    const tokenInfo = await metadata.getToken(token);
    if (!tokenInfo) return c.json({ error: 'Token not found' }, 404);
    if (tokenInfo.userId !== user.id && user.role !== 'admin') {
      return c.json({ error: 'Forbidden' }, 403);
    }

    await metadata.updateToken(token, deviceName);
    return c.json({ success: true, deviceName });
  });

  // Rotate / Regenerate Token for Device
  app.post('/api/v1/user/tokens/:token/rotate', async (c) => {
    const metadata = c.get('metadata');
    const user = c.get('currentUser')!;
    const oldToken = c.req.param('token');

    const tokenInfo = await metadata.getToken(oldToken);
    if (!tokenInfo) return c.json({ error: 'Token not found' }, 404);
    if (tokenInfo.userId !== user.id && user.role !== 'admin') {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const newToken = await metadata.rotateToken(oldToken);
    if (!newToken) return c.json({ error: 'Failed to rotate token' }, 500);

    return c.json({
      success: true,
      token: newToken,
      deviceName: tokenInfo.deviceName,
      vaultId: tokenInfo.vaultId
    });
  });

  // Revoke / Delete Device Token
  app.delete('/api/v1/user/tokens/:token', async (c) => {
    const metadata = c.get('metadata');
    const token = c.req.param('token');
    await metadata.deleteToken(token);
    return c.json({ success: true });
  });

  // Get Vault 365-day Activity Data
  app.get('/api/v1/user/vaults/:id/activity', async (c) => {
    const metadata = c.get('metadata');
    const user = c.get('currentUser')!;
    const vaultId = c.req.param('id');
    const days = parseInt(c.req.query('days') || '365', 10);

    const vault = await metadata.getVault(vaultId);
    if (!vault) return c.json({ error: 'Vault not found' }, 404);
    if (vault.userId !== user.id && user.role !== 'admin') {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const sinceMs = Date.now() - Math.max(1, days) * 86400000;
    const activity = await metadata.getVaultActivity(vaultId, sinceMs);
    return c.json({ activity });
  });

  // Delete user vault (and physical blobs)
  app.delete('/api/v1/user/vaults/:id', async (c) => {
    const metadata = c.get('metadata');
    const blobs = c.get('blobs');
    const user = c.get('currentUser')!;
    const vaultId = c.req.param('id');

    const vault = await metadata.getVault(vaultId);
    if (!vault) return c.json({ error: 'Vault not found' }, 404);
    if (vault.userId !== user.id) return c.json({ error: 'Forbidden' }, 403);

    await metadata.deleteVault(vaultId);
    await blobs.deleteVault(vaultId);
    return c.json({ success: true });
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
    const body = await c.req.json<AdminCreateUserRequest>();

    const username = body.username?.trim();
    const password = body.password;
    const role = body.role === 'admin' ? 'admin' : 'user';

    if (!username || username.length < 3) {
      return c.json({ error: '用户名长度至少需要 3 位' }, 400);
    }
    if (!password || password.length < 6) {
      return c.json({ error: '密码长度至少需要 6 位' }, 400);
    }

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
    for (const v of vaults) {
      await blobs.deleteVault(v.id);
    }
    await metadata.deleteUser(userId);
    return c.json({ success: true });
  });

  return app;
}

export const app = createApp();
