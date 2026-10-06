import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { createApp, type AppContext } from '../app';
import { SqliteMetadataStore } from '../storage/sqlite';
import { LocalFsBlobStore } from '../storage/fs-blob';

describe('Token Capability Session & Partitioned Sync Tests', () => {
  let tempDir: string;
  let blobsDir: string;
  let metadata: SqliteMetadataStore;
  let blobs: LocalFsBlobStore;
  let app: Hono<AppContext>;

  let aliceMasterToken: string;
  let aliceVaultId: string;
  let aliceDeviceToken: string;

  let bobMasterToken: string;
  let bobVaultId: string;
  let bobDeviceToken: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'obsidian-sync-capability-'));
    const dbPath = join(tempDir, 'test.db');
    blobsDir = join(tempDir, 'blobs');

    metadata = new SqliteMetadataStore(dbPath);
    blobs = new LocalFsBlobStore(blobsDir);

    await metadata.init();
    await blobs.init();

    app = createApp({
      metadata,
      blobs
    });
  });

  afterAll(async () => {
    metadata.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('registers Alice and Bob on platform', async () => {
    // 1. Register Alice
    const resAlice = await app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'password123' })
    });
    expect(resAlice.status).toBe(201);
    const dataAlice = await resAlice.json();
    aliceMasterToken = dataAlice.token;

    // 2. Register Bob
    const resBob = await app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'bob', password: 'password456' })
    });
    expect(resBob.status).toBe(201);
    const dataBob = await resBob.json();
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
});
