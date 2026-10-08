import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { Hono } from 'hono';
import { createApp, type AppContext } from '../app';
import { ensureAdminFromEnv } from '../admin-bootstrap';
import {
  hashPasswordForManualSql,
  parseAdminResetArgs,
  parsePasswordArg,
  parseUsernameArg,
  resetUserPassword
} from '../admin-cli';
import { buildResetSql, resetD1Password, splitD1Args } from '../admin-reset-d1';
import { formatLogLine, logger, setLogFormat, setLogLevel, setLogSink } from '../logger';
import { createShutdownHandler } from '../shutdown';
import { hashPassword, newSalt } from '../auth-utils';
import { SqliteMetadataStore } from '../storage/sqlite';
import { LocalFsBlobStore } from '../storage/fs-blob';
import type { IBlobStore } from '../storage/types';
import { mintWsTicket, verifyWsTicket } from '../ws-tickets';

const WS_SECRET = 'test-ws-ticket-secret';

/** Delegates to the inner store; deleteVault can be made to fail on demand. */
class FlakyBlobStore implements IBlobStore {
  failing = false;
  constructor(private inner: IBlobStore) {}

  async put(vaultId: string, hash: string, data: Uint8Array) { return this.inner.put(vaultId, hash, data); }
  async get(vaultId: string, hash: string) { return this.inner.get(vaultId, hash); }
  async has(vaultId: string, hash: string) { return this.inner.has(vaultId, hash); }
  async checkHashes(vaultId: string, hashes: string[]) { return this.inner.checkHashes(vaultId, hashes); }
  async list(vaultId: string, cursor?: string) { return this.inner.list(vaultId, cursor); }
  async deleteBlob(vaultId: string, hash: string) { return this.inner.deleteBlob(vaultId, hash); }
  async deleteVault(vaultId: string) {
    if (this.failing) throw new Error('simulated blob backend outage');
    return this.inner.deleteVault(vaultId);
  }
}

describe('Token Capability Session & Partitioned Sync Tests', () => {
  let tempDir: string;
  let dbPath: string;
  let blobsDir: string;
  let metadata: SqliteMetadataStore;
  let blobs: LocalFsBlobStore;
  let flakyBlobs: FlakyBlobStore;
  let app: Hono<AppContext>;
  let appDeletion: Hono<AppContext>;
  let appNoWs: Hono<AppContext>;

  let aliceUserId: string;
  let aliceMasterToken: string;
  let aliceVaultId: string;
  let aliceDeviceToken: string;
  let aliceTokenId: string;

  let bobMasterToken: string;
  let bobVaultId: string;
  let bobDeviceToken: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'obsidian-sync-capability-'));
    dbPath = join(tempDir, 'test.db');
    blobsDir = join(tempDir, 'blobs');

    metadata = new SqliteMetadataStore(dbPath);
    blobs = new LocalFsBlobStore(blobsDir);
    flakyBlobs = new FlakyBlobStore(blobs);

    await metadata.init();
    await blobs.init();

    app = createApp({ metadata, blobs, wsTicketSecret: WS_SECRET });
    appDeletion = createApp({ metadata, blobs: flakyBlobs });
    appNoWs = createApp({ metadata, blobs });
  });

  afterAll(async () => {
    metadata.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('provisions Alice (initial admin) and Bob (admin-created user)', async () => {
    // 1. Public registration is open only while the system is empty — first user becomes admin
    const resAlice = await app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'password123' })
    });
    expect(resAlice.status).toBe(201);
    const dataAlice = await resAlice.json();
    expect(dataAlice.user.role).toBe('admin');
    aliceUserId = dataAlice.user.id;
    aliceMasterToken = dataAlice.token;

    // 2. Public registration is closed once an account exists
    const resStranger = await app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'stranger', password: 'password999' })
    });
    expect(resStranger.status).toBe(403);

    // 3. Admin provisions Bob
    const resBob = await app.request('/api/v1/admin/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceMasterToken}`
      },
      body: JSON.stringify({ username: 'bob', password: 'password456', role: 'user' })
    });
    expect(resBob.status).toBe(201);

    // 4. Bob logs in
    const loginBob = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'bob', password: 'password456' })
    });
    expect(loginBob.status).toBe(200);
    const dataBob = await loginBob.json();
    bobMasterToken = dataBob.token;
  });

  it('Alice creates a Vault on web platform and generates a Device Token for MacBook', async () => {
    // 1. Alice creates vault
    const vaultRes = await app.request('/api/v1/user/vaults', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceMasterToken}`
      },
      body: JSON.stringify({ name: 'Alice Private Notes' })
    });
    expect(vaultRes.status).toBe(201);
    const vaultData = await vaultRes.json();
    aliceVaultId = vaultData.vault.id;
    expect(vaultData.vault.name).toBe('Alice Private Notes');

    // 2. Alice generates device token for MacBook
    const tokenRes = await app.request(`/api/v1/user/vaults/${aliceVaultId}/tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceMasterToken}`
      },
      body: JSON.stringify({ deviceName: 'MacBook Pro' })
    });
    expect(tokenRes.status).toBe(201);
    const tokenData = await tokenRes.json();
    expect(tokenData.token).toMatch(/^ost_/);
    expect(tokenData.deviceName).toBe('MacBook Pro');
    aliceDeviceToken = tokenData.token;

    // 3. Token listings expose only the tokenId — never the secret
    const listRes = await app.request('/api/v1/user/vaults', {
      headers: { Authorization: `Bearer ${aliceMasterToken}` }
    });
    const listData = await listRes.json();
    const vault = listData.vaults.find((v: any) => v.id === aliceVaultId);
    expect(vault.tokens).toHaveLength(1);
    expect(vault.tokens[0].tokenId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(vault.tokens[0].token).toBeUndefined();
    expect(JSON.stringify(vault.tokens)).not.toContain(aliceDeviceToken);
    aliceTokenId = vault.tokens[0].tokenId;
  });

  it('Client handshakes via /api/v1/session using Device Token (no vaultId needed)', async () => {
    const sessionRes = await app.request('/api/v1/session', {
      headers: { Authorization: `Bearer ${aliceDeviceToken}` }
    });
    expect(sessionRes.status).toBe(200);
    const session = await sessionRes.json();

    expect(session.vaultId).toBe(aliceVaultId);
    expect(session.vaultName).toBe('Alice Private Notes');
    expect(session.deviceName).toBe('MacBook Pro');
    expect(session.username).toBe('alice');
    expect(session.salt.length).toBe(64);
  });

  it('Client uploads blob and commits changes using token-scoped /api/v1/sync routes', async () => {
    const testHash = 'a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890';
    const fakeCiphertext = new Uint8Array([11, 22, 33, 44, 55]);

    // 1. Upload blob directly to /sync/blobs/:hash
    const uploadRes = await app.request(`/api/v1/sync/blobs/${testHash}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        Authorization: `Bearer ${aliceDeviceToken}`
      },
      body: fakeCiphertext
    });
    expect(uploadRes.status).toBe(201);

    // 2. Verify physical disk directory is strictly partitioned under /blobs/<aliceVaultId>/<testHash>
    const expectedDiskPath = join(blobsDir, aliceVaultId, testHash);
    await expect(access(expectedDiskPath)).resolves.toBeUndefined();

    // 3. Commit changes to /sync/commit
    const commitRes = await app.request('/api/v1/sync/commit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceDeviceToken}`
      },
      body: JSON.stringify({
        changes: [
          {
            encryptedPath: 'AliceEncryptedPath1',
            contentHash: testHash,
            size: fakeCiphertext.byteLength,
            isDeleted: false,
            mtime: 1728200000000
          }
        ]
      })
    });
    expect(commitRes.status).toBe(200);
    const commitData = await commitRes.json();
    expect(commitData.success).toBe(true);
    expect(commitData.newVersion).toBe(1);

    // 4. Query changes
    const changesRes = await app.request('/api/v1/sync/changes?since=0', {
      headers: { Authorization: `Bearer ${aliceDeviceToken}` }
    });
    expect(changesRes.status).toBe(200);
    const changesData = await changesRes.json();
    expect(changesData.latestVersion).toBe(1);
    expect(changesData.changes.length).toBe(1);
    expect(changesData.changes[0].contentHash).toBe(testHash);
    expect(changesData.changes[0].id).toMatch(/^[0-9a-f-]{36}$/i);

    const fileId = changesData.changes[0].id;
    const renameRes = await app.request('/api/v1/sync/commit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceDeviceToken}`
      },
      body: JSON.stringify({
        changes: [
          {
            id: fileId,
            encryptedPath: 'AliceEncryptedPathRenamed',
            contentHash: testHash,
            size: fakeCiphertext.byteLength,
            isDeleted: false,
            mtime: 1728200001000
          }
        ]
      })
    });
    expect(renameRes.status).toBe(200);
    const renameData = await renameRes.json();
    expect(renameData.changes).toEqual([
      { id: fileId, encryptedPath: 'AliceEncryptedPathRenamed' }
    ]);

    const renamedChangesRes = await app.request('/api/v1/sync/changes?since=1', {
      headers: { Authorization: `Bearer ${aliceDeviceToken}` }
    });
    const renamedChanges = await renamedChangesRes.json();
    expect(renamedChanges.latestVersion).toBe(2);
    expect(renamedChanges.changes).toHaveLength(1);
    expect(renamedChanges.changes[0].id).toBe(fileId);
    expect(renamedChanges.changes[0].encryptedPath).toBe('AliceEncryptedPathRenamed');
  });

  it('commit requestId replays the same receipt and rejects payload reuse', async () => {
    const testHash = 'a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890';
    const requestId = '7f9c24e84a1b4c1e9d2f000000000001';
    const payload = {
      requestId,
      changes: [
        {
          encryptedPath: 'AliceReplayPath',
          contentHash: testHash,
          size: 5,
          isDeleted: false,
          mtime: 1728200002000
        }
      ]
    };

    const first = await app.request('/api/v1/sync/commit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceDeviceToken}`
      },
      body: JSON.stringify(payload)
    });
    expect(first.status).toBe(200);
    const firstData = await first.json();
    expect(firstData.success).toBe(true);
    expect(firstData.newVersion).toBe(3);
    expect(firstData.replayed).toBeFalsy();

    // Retrying the exact same request replays the stored receipt (no new version)
    const retry = await app.request('/api/v1/sync/commit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceDeviceToken}`
      },
      body: JSON.stringify(payload)
    });
    expect(retry.status).toBe(200);
    const retryData = await retry.json();
    expect(retryData.replayed).toBe(true);
    expect(retryData.newVersion).toBe(3);
    expect(retryData.requestId).toBe(requestId);

    // Reusing the requestId with a different payload is a conflict
    const abused = await app.request('/api/v1/sync/commit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceDeviceToken}`
      },
      body: JSON.stringify({
        requestId,
        changes: [
          {
            encryptedPath: 'AliceReplayPathDIFFERENT',
            contentHash: testHash,
            size: 5,
            isDeleted: false,
            mtime: 1728200002000
          }
        ]
      })
    });
    expect(abused.status).toBe(409);
    expect((await abused.json()).code).toBe('request-id-reuse');
  });

  it('rejects device tokens on dashboard APIs and validates sync inputs', async () => {
    const userRes = await app.request('/api/v1/user/vaults', {
      headers: { Authorization: `Bearer ${aliceDeviceToken}` }
    });
    expect(userRes.status).toBe(401);

    const invalidHashRes = await app.request('/api/v1/sync/blobs/check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceDeviceToken}`
      },
      body: JSON.stringify({ hashes: ['not-a-hash'] })
    });
    expect(invalidHashRes.status).toBe(400);

    const invalidSinceRes = await app.request('/api/v1/sync/changes?since=NaN', {
      headers: { Authorization: `Bearer ${aliceDeviceToken}` }
    });
    expect(invalidSinceRes.status).toBe(400);

    const invalidJsonRes = await app.request('/api/v1/sync/commit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceDeviceToken}`
      },
      body: '{'
    });
    expect(invalidJsonRes.status).toBe(400);

    const badTombstoneRes = await app.request('/api/v1/sync/commit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceDeviceToken}`
      },
      body: JSON.stringify({
        requestId: '7f9c24e84a1b4c1e9d2f000000000002',
        changes: [
          {
            encryptedPath: 'AliceTombstonePath',
            contentHash: testHashOfLength64(),
            size: 5,
            isDeleted: true,
            mtime: 1728200003000
          }
        ]
      })
    });
    expect(badTombstoneRes.status).toBe(400);
  });

  it('exposes healthz and readyz endpoints', async () => {
    const healthz = await app.request('/api/v1/healthz');
    expect(healthz.status).toBe(200);
    expect((await healthz.json()).status).toBe('ok');

    const readyz = await app.request('/api/v1/readyz');
    expect(readyz.status).toBe(200);
    expect((await readyz.json()).status).toBe('ready');
  });

  it('serves the dashboard with strict CSP and self-hosted assets (no CDN)', async () => {
    const page = await app.request('/');
    expect(page.status).toBe(200);
    const csp = page.headers.get('Content-Security-Policy') || '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    const html = await page.text();
    expect(html).not.toContain('cdn.tailwindcss.com');
    expect(html).not.toContain('jsdelivr');
    expect(html).toContain('/assets/app.js');

    for (const asset of ['/assets/tailwind.js', '/assets/alpine.min.js', '/assets/app.js']) {
      const res = await app.request(asset);
      expect(res.status).toBe(200);
      expect((res.headers.get('content-type') || '').includes('javascript')).toBe(true);
      expect((await res.text()).length).toBeGreaterThan(100);
    }
  });

  it('Bob cannot access Alice sync endpoints or data with Bob token', async () => {
    // 1. Bob creates his vault and token
    const bobVaultRes = await app.request('/api/v1/user/vaults', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bobMasterToken}`
      },
      body: JSON.stringify({ name: 'Bob Vault' })
    });
    const bobVaultData = await bobVaultRes.json();
    bobVaultId = bobVaultData.vault.id;

    const bobTokenRes = await app.request(`/api/v1/user/vaults/${bobVaultId}/tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bobMasterToken}`
      },
      body: JSON.stringify({ deviceName: 'Bob Phone' })
    });
    const bobTokenData = await bobTokenRes.json();
    bobDeviceToken = bobTokenData.token;

    // Cross-user token management is blocked (tokenId-based API)
    const crossUserDelete = await app.request(`/api/v1/user/tokens/${aliceTokenId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${bobMasterToken}` }
    });
    expect(crossUserDelete.status).toBe(403);

    const crossUserRotate = await app.request(`/api/v1/user/tokens/${aliceTokenId}/rotate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bobMasterToken}` }
    });
    expect(crossUserRotate.status).toBe(403);

    // 2. Bob sync/status returns Bob's vault (0 files), not Alice's
    const bobStatusRes = await app.request('/api/v1/sync/status', {
      headers: { Authorization: `Bearer ${bobDeviceToken}` }
    });
    expect(bobStatusRes.status).toBe(200);
    const bobStatus = await bobStatusRes.json();
    expect(bobStatus.vaultId).toBe(bobVaultId);
    expect(bobStatus.latestVersion).toBe(0);

    // 3. Bob attempts to download Alice blob from Bob session -> 404 Not Found in Bob vault!
    const testHash = 'a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890';
    const bobStealRes = await app.request(`/api/v1/sync/blobs/${testHash}`, {
      headers: { Authorization: `Bearer ${bobDeviceToken}` }
    });
    expect(bobStealRes.status).toBe(404);
  });

  it('mints single-purpose WebSocket tickets and refuses them without WS support', async () => {
    const ok = await app.request('/api/v1/ws/ticket', {
      method: 'POST',
      headers: { Authorization: `Bearer ${aliceDeviceToken}` }
    });
    expect(ok.status).toBe(200);
    const data = await ok.json();
    expect(data.expiresIn).toBe(60);
    expect(typeof data.ticket).toBe('string');

    const payload = await verifyWsTicket(WS_SECRET, data.ticket);
    expect(payload).not.toBeNull();
    expect(payload!.tokenId).toBe(aliceTokenId);
    expect(payload!.vaultId).toBe(aliceVaultId);

    // Wrong secret / tampered ticket fails verification
    expect(await verifyWsTicket('wrong-secret', data.ticket)).toBeNull();
    expect(await verifyWsTicket(WS_SECRET, data.ticket + 'x')).toBeNull();

    // Tickets require authentication
    const anon = await app.request('/api/v1/ws/ticket', { method: 'POST' });
    expect(anon.status).toBe(401);

    // Deployments without WebSocket support (Worker) advertise 501 → clients poll
    const noWs = await appNoWs.request('/api/v1/ws/ticket', {
      method: 'POST',
      headers: { Authorization: `Bearer ${aliceDeviceToken}` }
    });
    expect(noWs.status).toBe(501);
  });

  it('garbage-collects unreferenced blobs while keeping live ones', async () => {
    const liveHash = 'b00000000000000000000000000000000000000000000000000000000000000f';
    const orphanHash = 'b00000000000000000000000000000000000000000000000000000000000000d';
    const bytes = new Uint8Array([1, 2, 3]);

    for (const hash of [liveHash, orphanHash]) {
      const upload = await app.request(`/api/v1/sync/blobs/${hash}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          Authorization: `Bearer ${bobDeviceToken}`
        },
        body: bytes
      });
      expect(upload.status).toBe(201);
    }

    // Only liveHash is referenced by a committed record
    const commit = await app.request('/api/v1/sync/commit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bobDeviceToken}`
      },
      body: JSON.stringify({
        requestId: '7f9c24e84a1b4c1e9d2f000000000003',
        changes: [
          {
            encryptedPath: 'BobLivePath',
            contentHash: liveHash,
            size: 3,
            isDeleted: false,
            mtime: 1728200004000
          }
        ]
      })
    });
    expect(commit.status).toBe(200);

    // graceDays=0 → orphan deleted immediately, live blob kept
    const gc = await app.request(`/api/v1/user/vaults/${bobVaultId}/gc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bobMasterToken}`
      },
      body: JSON.stringify({ graceDays: 0 })
    });
    expect(gc.status).toBe(200);
    const gcData = await gc.json();
    expect(gcData.scanned).toBe(2);
    expect(gcData.deleted).toBe(1);
    expect(gcData.kept).toBe(1);

    const liveAfter = await app.request(`/api/v1/sync/blobs/${liveHash}`, {
      headers: { Authorization: `Bearer ${bobDeviceToken}` }
    });
    expect(liveAfter.status).toBe(200);

    const orphanAfter = await app.request(`/api/v1/sync/blobs/${orphanHash}`, {
      headers: { Authorization: `Bearer ${bobDeviceToken}` }
    });
    expect(orphanAfter.status).toBe(404);

    // A second sweep finds nothing to delete
    const gc2 = await app.request(`/api/v1/user/vaults/${bobVaultId}/gc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bobMasterToken}`
      },
      body: JSON.stringify({ graceDays: 0 })
    });
    expect((await gc2.json()).deleted).toBe(0);
  });

  it('rejects commits that reference missing blobs, protects stored blobs, and paginates changes', async () => {
    // Isolated vault so version counters and GC expectations elsewhere are untouched.
    const vaultRes = await app.request('/api/v1/user/vaults', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceMasterToken}`
      },
      body: JSON.stringify({ name: 'Pagination Vault' })
    });
    expect(vaultRes.status).toBe(201);
    const paginationVaultId = (await vaultRes.json()).vault.id;

    const tokenRes = await app.request(`/api/v1/user/vaults/${paginationVaultId}/tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceMasterToken}`
      },
      body: JSON.stringify({ deviceName: 'Pagination Device' })
    });
    expect(tokenRes.status).toBe(201);
    const paginationToken = (await tokenRes.json()).token;
    const auth = { Authorization: `Bearer ${paginationToken}` };

    const putBlob = (hash: string, bytes: Uint8Array) =>
      app.request(`/api/v1/sync/blobs/${hash}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', ...auth },
        body: bytes
      });
    const commitFile = (encryptedPath: string, contentHash: string, size: number, requestId: string) =>
      app.request('/api/v1/sync/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({
          requestId,
          changes: [{ encryptedPath, contentHash, size, isDeleted: false, mtime: 1728200010000 }]
        })
      });

    const h1 = 'c111111111111111111111111111111111111111111111111111111111111111';
    const h2 = 'c222222222222222222222222222222222222222222222222222222222222222';
    const h3 = 'c333333333333333333333333333333333333333333333333333333333333333';
    const h4 = 'c444444444444444444444444444444444444444444444444444444444444444';
    const h5 = 'c555555555555555555555555555555555555555555555555555555555555555';
    const bytes1 = new Uint8Array([9, 9, 9]);

    expect((await putBlob(h1, bytes1)).status).toBe(201);
    expect((await commitFile('PaginatedPath1', h1, bytes1.byteLength, '7f9c24e84a1b4c1e9d2f000000000011')).status).toBe(200);

    // Referencing a blob that was never uploaded is rejected before any version is allocated.
    const missing = await commitFile('PaginatedMissing', h2, 3, '7f9c24e84a1b4c1e9d2f000000000012');
    expect(missing.status).toBe(409);
    expect((await missing.json()).code).toBe('blob-missing');

    // Declared size must match the stored bytes.
    const sizeMismatch = await commitFile('PaginatedPath1', h1, 999, '7f9c24e84a1b4c1e9d2f000000000013');
    expect(sizeMismatch.status).toBe(400);
    expect((await sizeMismatch.json()).code).toBe('blob-size-mismatch');

    // Different bytes under an existing hash are rejected; identical bytes are idempotent.
    expect((await putBlob(h1, new Uint8Array([1, 2, 3, 4]))).status).toBe(409);
    expect((await putBlob(h1, bytes1)).status).toBe(200);

    for (const [index, h] of [h3, h4, h5].entries()) {
      const bytes = new Uint8Array([index + 1]);
      expect((await putBlob(h, bytes)).status).toBe(201);
      const commit = await commitFile(`PaginatedPath${index + 2}`, h, bytes.byteLength, `7f9c24e84a1b4c1e9d2f00000000002${index}`);
      expect(commit.status).toBe(200);
    }

    const page1Res = await app.request('/api/v1/sync/changes?since=0&limit=2', { headers: auth });
    expect(page1Res.status).toBe(200);
    const page1 = await page1Res.json();
    expect(page1.changes).toHaveLength(2);
    expect(page1.hasMore).toBe(true);

    const cursor = page1.changes[1].version;
    const page2Res = await app.request(`/api/v1/sync/changes?since=${cursor}&limit=2`, { headers: auth });
    const page2 = await page2Res.json();
    expect(page2.changes).toHaveLength(2);
    expect(page2.hasMore).toBe(false);
    expect(page2.latestVersion).toBe(4);

    const invalidLimit = await app.request('/api/v1/sync/changes?since=0&limit=NaN', { headers: auth });
    expect(invalidLimit.status).toBe(400);
  });

  it('turns vault deletion into a retryable job when the blob backend fails', async () => {
    // Alice creates a disposable vault
    const vaultRes = await app.request('/api/v1/user/vaults', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceMasterToken}`
      },
      body: JSON.stringify({ name: 'Doomed Vault' })
    });
    const { vault } = await vaultRes.json();
    const doomedVaultId = vault.id;

    // First attempt: metadata deletion succeeds, blob deletion fails → job marked failed
    flakyBlobs.failing = true;
    const del = await appDeletion.request(`/api/v1/user/vaults/${doomedVaultId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${aliceMasterToken}` }
    });
    expect(del.status).toBe(202);
    const delData = await del.json();
    expect(delData.status).toBe('failed');
    const jobId = delData.jobId;

    // Job status is visible to the owner, not to other users
    const statusRes = await app.request(`/api/v1/user/deletion-jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${aliceMasterToken}` }
    });
    expect(statusRes.status).toBe(200);
    const { job } = await statusRes.json();
    expect(job.status).toBe('failed');
    expect(job.attempts).toBe(1);
    expect(job.lastError).toContain('simulated blob backend outage');

    const bobStatusRes = await app.request(`/api/v1/user/deletion-jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${bobMasterToken}` }
    });
    expect(bobStatusRes.status).toBe(403);

    // Vault metadata is already gone → clients can no longer sync it
    const vaultList = await app.request('/api/v1/user/vaults', {
      headers: { Authorization: `Bearer ${aliceMasterToken}` }
    });
    const listData = await vaultList.json();
    expect(listData.vaults.find((v: any) => v.id === doomedVaultId)).toBeUndefined();

    // Retry after the backend recovers → job completes
    flakyBlobs.failing = false;
    const retry = await app.request(`/api/v1/user/deletion-jobs/${jobId}/retry`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${aliceMasterToken}` }
    });
    expect(retry.status).toBe(200);
    const retryData = await retry.json();
    expect(retryData.job.status).toBe('completed');

    const after = await app.request(`/api/v1/user/deletion-jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${aliceMasterToken}` }
    });
    expect((await after.json()).job.status).toBe('completed');
  });

  it('stores token secrets hash-only (plaintext never persisted)', async () => {
    const db = new Database(dbPath);
    try {
      const legacy = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_tokens'").get();
      expect(legacy).toBeUndefined();

      const rows = db.prepare('SELECT token_id, token_hash FROM auth_tokens').all() as Array<{
        token_id: string;
        token_hash: string;
      }>;
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.token_hash).toMatch(/^[a-f0-9]{64}$/);
        expect(row.token_hash).not.toContain('ost_');
      }
      expect(JSON.stringify(rows)).not.toContain(aliceDeviceToken);
      expect(JSON.stringify(rows)).not.toContain(bobDeviceToken);
    } finally {
      db.close();
    }
  });

  it('rejects tokens that are expired or revoked', async () => {
    // Expired-on-arrival device token (negative lifetime is a test affordance)
    const expiredToken = await metadata.createToken(aliceUserId, aliceVaultId, 'Ancient Device', {
      expiresInDays: -1
    });
    const expiredRes = await app.request('/api/v1/session', {
      headers: { Authorization: `Bearer ${expiredToken}` }
    });
    expect(expiredRes.status).toBe(401);

    // Revocation by tokenId takes effect immediately
    const revokeRes = await app.request(`/api/v1/user/tokens/${aliceTokenId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${aliceMasterToken}` }
    });
    expect(revokeRes.status).toBe(200);

    const revokedRes = await app.request('/api/v1/session', {
      headers: { Authorization: `Bearer ${aliceDeviceToken}` }
    });
    expect(revokedRes.status).toBe(401);
  });

  it('rotating a token revokes the old secret and issues one with a fresh lifetime', async () => {
    // Re-create a device token for Alice's vault (previous one was revoked above)
    const tokenRes = await app.request(`/api/v1/user/vaults/${aliceVaultId}/tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceMasterToken}`
      },
      body: JSON.stringify({ deviceName: 'MacBook Air' })
    });
    const tokenData = await tokenRes.json();
    const currentToken = tokenData.token;

    const listBefore = await app.request('/api/v1/user/vaults', {
      headers: { Authorization: `Bearer ${aliceMasterToken}` }
    });
    const beforeData = await listBefore.json();
    const vaultBefore = beforeData.vaults.find((v: any) => v.id === aliceVaultId);
    const freshTokenId = vaultBefore.tokens.find((t: any) => t.deviceName === 'MacBook Air').tokenId;

    const rotateRes = await app.request(`/api/v1/user/tokens/${freshTokenId}/rotate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${aliceMasterToken}` }
    });
    expect(rotateRes.status).toBe(200);
    const rotated = await rotateRes.json();
    expect(rotated.token).toMatch(/^ost_/);
    expect(rotated.token).not.toBe(currentToken);

    // Old secret is dead, new secret works
    const oldRes = await app.request('/api/v1/session', {
      headers: { Authorization: `Bearer ${currentToken}` }
    });
    expect(oldRes.status).toBe(401);

    const newRes = await app.request('/api/v1/session', {
      headers: { Authorization: `Bearer ${rotated.token}` }
    });
    expect(newRes.status).toBe(200);

    // The rotated row keeps its type and receives a fresh, future expiry
    const listRes = await app.request('/api/v1/user/vaults', {
      headers: { Authorization: `Bearer ${aliceMasterToken}` }
    });
    const listData = await listRes.json();
    const vault = listData.vaults.find((v: any) => v.id === aliceVaultId);
    const tokenInfo = vault.tokens.find((t: any) => t.tokenId === freshTokenId);
    expect(tokenInfo.deviceName).toBe('MacBook Air');
    expect(tokenInfo.tokenType).toBe('device');
    expect(tokenInfo.expiresAt).toBeGreaterThan(Date.now());
    expect(tokenInfo.revokedAt).toBeNull();
  });
});

describe('Legacy database migration (pre-lifecycle schema)', () => {
  it('upgrades plaintext user_tokens without lifecycle columns and keeps credentials usable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'obsidian-sync-legacy-'));
    const dbPath = join(dir, 'legacy.db');
    const plaintextToken = 'ost_legacy0000000000000000000000000000000000000000000000000001';

    // Emulate the oldest schema: no token_hash/token_type/expires_at/revoked_* columns
    const raw = new Database(dbPath);
    raw.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE vaults (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, salt TEXT NOT NULL, latest_version INTEGER DEFAULT 0, created_at INTEGER NOT NULL);
      CREATE TABLE user_tokens (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, vault_id TEXT DEFAULT '', device_name TEXT NOT NULL, created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL);
      CREATE TABLE devices (id TEXT PRIMARY KEY, vault_id TEXT NOT NULL, device_name TEXT NOT NULL, last_seen INTEGER NOT NULL);
      CREATE TABLE file_records (id TEXT PRIMARY KEY, vault_id TEXT NOT NULL, encrypted_path TEXT NOT NULL, content_hash TEXT NOT NULL, size INTEGER NOT NULL, version INTEGER NOT NULL, is_deleted INTEGER DEFAULT 0, mtime INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    `);
    raw.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?)').run('u1', 'legacy', 'x', 'y', Date.now());
    raw.prepare('INSERT INTO vaults VALUES (?, ?, ?, ?, 0, ?)').run('v1', 'u1', 'Legacy Vault', 's', Date.now());
    raw
      .prepare('INSERT INTO user_tokens VALUES (?, ?, ?, ?, ?, ?)')
      .run(plaintextToken, 'u1', 'v1', 'Old Device', Date.now(), Date.now());
    raw.close();

    const store = new SqliteMetadataStore(dbPath);
    await store.init();

    // The legacy token still authenticates against its stored hash
    const session = await store.verifyToken(plaintextToken);
    expect(session).not.toBeNull();
    expect(session!.vault.id).toBe('v1');
    expect(session!.tokenInfo.deviceName).toBe('Old Device');
    expect(session!.tokenInfo.expiresAt).toBeGreaterThan(Date.now());
    expect(session!.tokenInfo.tokenType).toBe('device');

    // Plaintext is gone: the legacy table is dropped and only hashes remain
    const check = new Database(dbPath, { readonly: true });
    const leftover = check
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_tokens'")
      .get();
    expect(leftover).toBeUndefined();
    const hashes = check.prepare('SELECT token_hash FROM auth_tokens').all() as Array<{ token_hash: string }>;
    expect(hashes).toHaveLength(1);
    expect(hashes[0].token_hash).toMatch(/^[a-f0-9]{64}$/);
    check.close();

    store.close();
    await rm(dir, { recursive: true, force: true });
  });
});

function testHashOfLength64(): string {
  return 'f'.repeat(64);
}

describe('Admin bootstrap is init-only (no .env backdoor)', () => {
  it('creates once; later boots never overwrite the password', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'obsidian-sync-adminboot-'));
    const store = new SqliteMetadataStore(join(dir, 'admin.db'));
    await store.init();
    const blobs = new LocalFsBlobStore(join(dir, 'blobs'));
    await blobs.init();
    const bootApp = createApp({ metadata: store, blobs });

    const login = (password: string) =>
      bootApp.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'root', password })
      });

    expect(await ensureAdminFromEnv(store, {})).toBe('skipped');
    expect(await ensureAdminFromEnv(store, { adminUsername: 'root' })).toBe('skipped');

    expect(
      await ensureAdminFromEnv(store, { adminUsername: 'root', adminPassword: 'first-secret-1' })
    ).toBe('created');
    expect((await login('first-secret-1')).status).toBe(200);

    // A leaked/rotated .env must NOT take over the existing account
    expect(
      await ensureAdminFromEnv(store, { adminUsername: 'root', adminPassword: 'attacker-secret-2' })
    ).toBe('already-exists');
    expect((await login('attacker-secret-2')).status).toBe(401);
    expect((await login('first-secret-1')).status).toBe(200);

    const kept = await store.getUserByUsername('root');
    expect(kept?.role).toBe('admin');

    store.close();
    await rm(dir, { recursive: true, force: true });
  });
});

describe('Admin password reset (console path)', () => {
  it('lets admins reset passwords without touching roles; non-admins are rejected', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'obsidian-sync-adminreset-'));
    const store = new SqliteMetadataStore(join(dir, 'reset.db'));
    await store.init();
    const blobs = new LocalFsBlobStore(join(dir, 'blobs'));
    await blobs.init();
    const resetApp = createApp({ metadata: store, blobs });

    const post = (path: string, token: string | null, body: unknown) =>
      resetApp.request(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(body)
      });

    // First registered user becomes admin
    const reg = await post('/api/v1/auth/register', null, { username: 'boss', password: 'boss-secret-1' });
    expect(reg.status).toBe(201);
    const adminToken = (await reg.json() as { token: string }).token;

    const created = await post('/api/v1/admin/users', adminToken, {
      username: 'carol',
      password: 'carol-secret-1',
      role: 'user'
    });
    expect(created.status).toBe(201);
    const carolId = (await created.json() as { user: { id: string } }).user.id;

    const loginCarol = (password: string) =>
      post('/api/v1/auth/login', null, { username: 'carol', password });

    // Weak password is rejected before anything changes
    expect((await post(`/api/v1/admin/users/${carolId}/password`, adminToken, { password: 'x' })).status).toBe(400);
    expect((await loginCarol('carol-secret-1')).status).toBe(200);

    // Unknown user
    expect((await post('/api/v1/admin/users/does-not-exist/password', adminToken, { password: 'carol-secret-2' })).status).toBe(404);

    // Non-admin cannot reset anyone (carol logs in to get a master token first)
    const carolLogin = await loginCarol('carol-secret-1');
    const carolToken = (await carolLogin.json() as { token: string }).token;
    expect((await post(`/api/v1/admin/users/${carolId}/password`, carolToken, { password: 'carol-secret-2' })).status).toBe(403);
    expect((await loginCarol('carol-secret-1')).status).toBe(200);

    // Admin reset works; old password dies, role is untouched
    expect((await post(`/api/v1/admin/users/${carolId}/password`, adminToken, { password: 'carol-secret-2' })).status).toBe(200);
    expect((await loginCarol('carol-secret-1')).status).toBe(401);
    expect((await loginCarol('carol-secret-2')).status).toBe(200);
    expect((await store.getUserByUsername('carol'))?.role).toBe('user');

    store.close();
    await rm(dir, { recursive: true, force: true });
  });
});

describe('Structured logger', () => {
  it('formats text/json lines and filters below-level output', () => {
    const lines: string[] = [];
    setLogSink((level, line) => lines.push(`${level}:${line}`));
    try {
      setLogLevel('warn');
      setLogFormat('text');
      logger.debug('hidden');
      logger.info('hidden too');
      logger.warn('shown', { attempts: 3 });
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/\[warn\] shown attempts=3/);
      expect(formatLogLine('error', 'boom', { error: new Error('kaput') }, 'T')).toBe(
        'T [error] boom error="kaput"'
      );
      setLogFormat('json');
      expect(JSON.parse(formatLogLine('info', 'hi', { n: 2 }, 'T'))).toEqual({
        time: 'T',
        level: 'info',
        msg: 'hi',
        n: 2
      });
    } finally {
      setLogSink(null);
      setLogLevel(null);
      setLogFormat(null);
    }
  });
});

describe('Readiness probe', () => {
  it('reports per-dependency checks and 503s when any check fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'obsidian-sync-readyz-'));
    const store = new SqliteMetadataStore(join(dir, 'readyz.db'));
    await store.init();
    const blobs = new LocalFsBlobStore(join(dir, 'blobs'));
    await blobs.init();

    const healthy = createApp({ metadata: store, blobs });
    const res = await healthy.request('/api/v1/readyz');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      checks: Record<string, { status: string }>;
    };
    expect(body.status).toBe('ready');
    expect(body.checks.metadata).toEqual({ status: 'ok' });
    expect(body.checks.blobs).toEqual({ status: 'ok' });

    const failing = createApp({
      metadata: store,
      blobs,
      extraHealthChecks: [
        {
          name: 'disk',
          check: async () => {
            throw new Error('no space left');
          }
        }
      ]
    });
    const resBad = await failing.request('/api/v1/readyz');
    expect(resBad.status).toBe(503);
    const bodyBad = (await resBad.json()) as {
      status: string;
      checks: Record<string, { status: string; error?: string }>;
    };
    expect(bodyBad.status).toBe('not_ready');
    expect(bodyBad.checks.disk.status).toBe('error');
    expect(bodyBad.checks.disk.error).toBe('no space left');

    store.close();
    await rm(dir, { recursive: true, force: true });
  });
});

describe('Graceful shutdown', () => {
  it('drains in order, runs once, and exits non-zero on failure', async () => {
    const events: string[] = [];
    let code = -1;
    const handler = createShutdownHandler({
      log: (message) => events.push(message),
      closeServer: async () => {
        events.push('server');
      },
      closeSockets: () => {
        events.push('sockets');
      },
      checkpointAndClose: () => {
        events.push('db');
      },
      timeoutMs: 1000,
      exit: (c) => {
        code = c;
      }
    });
    handler();
    handler(); // second signal is a no-op
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(events).toEqual([
      '[Shutdown] Signal received, draining connections...',
      'server',
      'sockets',
      'db',
      '[Shutdown] Clean exit'
    ]);
    expect(code).toBe(0);

    const failingEvents: string[] = [];
    let failingCode = -1;
    const failing = createShutdownHandler({
      log: (message) => failingEvents.push(message),
      closeServer: async () => {
        throw new Error('stuck connection');
      },
      closeSockets: () => undefined,
      checkpointAndClose: () => undefined,
      timeoutMs: 1000,
      exit: (c) => {
        failingCode = c;
      }
    });
    failing();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(failingCode).toBe(1);
    expect(failingEvents.some((line) => line.includes('stuck connection'))).toBe(true);
  });
});

describe('admin-cli recovery helpers', () => {
  it('parses argv and env sources, rejecting missing/weak input', () => {
    expect(parseAdminResetArgs(['--username', 'root', '--password', 's3cret-12'])).toEqual({
      username: 'root',
      password: 's3cret-12'
    });
    expect(parseAdminResetArgs(['--username=root', '--password=s3cret-12'])).toEqual({
      username: 'root',
      password: 's3cret-12'
    });
    expect(parseAdminResetArgs(['-u', ' root '], { ONYX_RESET_PASSWORD: 'env-secret-1' })).toEqual({
      username: 'root',
      password: 'env-secret-1'
    });
    expect(() => parseAdminResetArgs(['--password', 's3cret-12'], {})).toThrow(/username/i);
    expect(() => parseAdminResetArgs(['--username', 'root', '--password', 'x'], {})).toThrow();
    expect(parsePasswordArg(['-p', 'pw-secret-1'], {})).toBe('pw-secret-1');
    expect(parsePasswordArg([], { ONYX_RESET_PASSWORD: 'env-secret-2' })).toBe('env-secret-2');
    expect(parseUsernameArg(['-u', 'root'])).toBe('root');
    expect(parseUsernameArg([])).toBe('<username>');
  });

  it('splits D1 wrapper flags, escapes SQL literals, and drives wrangler', async () => {
    expect(splitD1Args(['--username', 'root', '--password', 'x', '--db', 'mydb', '--local'])).toEqual({
      db: 'mydb',
      local: true,
      rest: ['--username', 'root', '--password', 'x']
    });
    expect(splitD1Args(['--db=other', '--remote', '-u', 'root'])).toEqual({
      db: 'other',
      local: false,
      rest: ['-u', 'root']
    });
    expect(buildResetSql("o'brien", 'salt1', 'hash1')).toBe(
      "UPDATE users SET password_hash = 'hash1', salt = 'salt1' WHERE username = 'o''brien';"
    );

    const calls: string[][] = [];
    const result = await resetD1Password(['--username', 'root', '--password', 'd1-secret-1'], {}, async (args) => {
      calls.push(args);
      return { stdout: 'ok', stderr: '' };
    });
    expect(result).toEqual({ db: 'onyx-db', local: false, username: 'root' });
    expect(calls).toHaveLength(1);
    expect(calls[0].slice(0, 4)).toEqual(['d1', 'execute', 'onyx-db', '--remote']);
    expect(calls[0][5]).toMatch(/^UPDATE users SET password_hash = '[a-f0-9]{64}', salt = '[a-f0-9]+' WHERE username = 'root';$/);
  });

  it('resets in-store passwords without escalating roles; unknown users fail', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'obsidian-sync-admincli-'));
    const store = new SqliteMetadataStore(join(dir, 'cli.db'));
    await store.init();

    await expect(resetUserPassword(store, { username: 'ghost', password: 'ghost-secret-1' })).rejects.toThrow(/does not exist/);

    const salt = newSalt();
    const user = await store.createUser('dave', await hashPassword('dave-secret-1', salt), salt, 'user');
    const reset = await resetUserPassword(store, { username: 'dave', password: 'dave-secret-2' });
    expect(reset.userId).toBe(user.id);

    const after = await store.getUserByUsername('dave');
    expect(after?.role).toBe('user');
    expect(await hashPassword('dave-secret-2', after!.salt)).toBe(after!.passwordHash);

    const manual = await hashPasswordForManualSql('manual-secret-1');
    expect(manual.salt).toMatch(/^[a-f0-9]+$/);
    expect(manual.passwordHash).toMatch(/^[a-f0-9]{64}$/);

    store.close();
    await rm(dir, { recursive: true, force: true });
  });
});
