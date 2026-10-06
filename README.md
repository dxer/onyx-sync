<div align="center">

<img src="docs/onyx-logo.svg" width="120" alt="Onyx" />

# Onyx

**Self-hosted, Zero-Knowledge End-to-End Encrypted Sync for [Obsidian](https://obsidian.md)**

[**简体中文**](README.zh-CN.md) · English

[![License: MIT](https://img.shields.io/badge/License-MIT-000000.svg?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20iOS%20%7C%20Android-000000?style=flat-square)](https://obsidian.md)
[![Node](https://img.shields.io/badge/Node-%3E%3D18-000000?style=flat-square)](package.json)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-000000?style=flat-square)](https://github.com/dxer/onyx/pulls)

**Onyx Server** runs on a free [Cloudflare Workers](https://workers.cloudflare.com/) tier — or any cheap VPS with Docker. **Onyx Sync** is the Obsidian plugin that talks to it.

</div>

---

## Why Onyx?

The server **never sees your plaintext**. It stores only AES-256-GCM ciphertext blobs, encrypted paths, and HMAC content hashes. Lose the server, lose nothing — your passphrase is the key.

Onyx ships as a complete **product**: a lightweight multi-user server with a management console, plus a polished cross-platform client plugin — not just a sync script.

---

## Comparison with mainstream Obsidian sync solutions

| | **Onyx** | Obsidian Sync (official) | [Remotely Save](https://github.com/remotely-save/remotely-save) | [Self-hosted LiveSync](https://github.com/vrtmrz/obsidian-livesync) |
| :--- | :--- | :--- | :--- | :--- |
| **Cost** | ✅ Free (Workers tier) or ~$1/mo VPS | 💰 $4–8 / month | ✅ Free (cloud free tiers) | ✅ Free (self-hosted CouchDB) |
| **Data ownership** | 🏠 100% your server | ☁️ Obsidian's cloud | 🏠 your cloud bucket | 🏠 your CouchDB |
| **Server software included** | ✅ Purpose-built lightweight server (Hono, single binary/container) | ❌ closed service | ⚠️ none needed — client talks to cloud storage directly | ⚠️ generic CouchDB (heavier, ops on you) |
| **Free Cloudflare deploy** | ✅ Workers + D1 + R2 | ❌ | ❌ | ❌ |
| **Zero-knowledge E2EE** | ✅ always on (AES-256-GCM + PBKDF2/HKDF) | ✅ optional per vault | ⚠️ optional, S3/WebDAV only | ⚠️ optional |
| **Encrypted file paths** | ✅ server never sees file names | ❌ paths in metadata | ❌ paths are object keys | ❌ |
| **Multi-user & teams** | ✅ admin console, per-user isolation, closed registration | ⚠️ per-account seats | ❌ single-user per setup | ❌ per-database, no user mgmt UI |
| **Device credential lifecycle** | ✅ generate / rename / rotate / revoke per device | ⚠️ unlink device | ❌ shared key per cloud | ❌ DB credentials |
| **At-rest credential sealing** | ✅ DPAPI / Keychain / mobile sandbox key — stolen `data.json` is useless | ✅ | ❌ plaintext in plugin data | ⚠️ DB password in settings |
| **Physical storage isolation** | ✅ `/blobs/<vault>/…` per-vault partition | ❌ | ⚠️ per bucket/prefix config | ⚠️ per database |
| **Conflict resolution** | ✅ 3-way merge (Markdown) + conflict copies; scans never infer deletions | ✅ versioning | ⚠️ last-write-wins | ✅ Conflict resolution via CouchDB replication |
| **Realtime push** | ✅ WebSocket notify + smart background sync | ✅ | ❌ manual/interval | ✅ near-live replication |
| **Management console** | ✅ Vercel-style dashboard: users, vaults, devices, storage, 365-day activity heatmap | ⚠️ basic web settings | ❌ | ❌ |
| **Setup complexity** | 🟡 run one server + paste 3 fields in plugin | 🟢 easiest | 🟡 create cloud bucket + keys | 🔴 configure CouchDB properly |
| **Maturity** | 🌱 young project | 🏆 official, battle-tested | 🏆 mature, popular | 🏆 mature, popular |

**Choose Onyx if** you want official-Sync-grade UX (multi-device pairing, token management, activity insights) on infrastructure you own, at zero or near-zero cost, with strict zero-knowledge guarantees — including for file names.

**Consider alternatives if** you want zero server at all (Remotely Save), real-time collaborative editing streams (LiveSync), or fully managed convenience (official Sync).

---

## Architecture

<img src="docs/onyx-architecture.svg" alt="Onyx architecture — clients hold keys, server stores only ciphertext" width="880"/>

### Zero-knowledge encryption pipeline

<img src="docs/onyx-encryption.svg" alt="Onyx encryption pipeline — PBKDF2 to HKDF to AES-GCM and HMAC keys" width="880"/>

### Conflict resolution

Markdown notes use **three-way merge** (base vs. local vs. remote via `diff-match-patch`); binary files fall back to last-write-wins with conflict copies. Deletions are only propagated from explicit filesystem events — a fresh install never wipes your vault.

---

## Feature Highlights

- 🔐 **Zero-knowledge E2EE** — AES-256-GCM content, encrypted paths, HMAC-based content addressing; the server is a dumb encrypted blob store
- 👥 **Multi-user & multi-vault** — physical storage isolation per vault (`/data/blobs/<vault_id>/…`), admin-managed accounts, no public registration
- 🪙 **Device tokens** — generate / rename / rotate / revoke per-device credentials from the web console; tokens are bound to a single vault
- 🛡️ **At-rest secret protection** — plugin credentials sealed with Windows DPAPI / macOS Keychain on desktop, sandbox keys on mobile; a stolen `data.json` is useless
- 📊 **Activity heatmap** — GitHub-style 365-day sync activity per vault
- 🌐 **Bilingual console** — Vercel-style dashboard, one-click 中文 / English
- ⚡ **Realtime push** — WebSocket notify + background interval sync + silent change detection
- 📱 **Cross-platform** — one codebase for Windows, macOS, Linux, iOS, Android

---

## Quick Start

### 1. Run the server

**Option A — VPS / local machine (Node.js ≥ 18):**

```bash
git clone https://github.com/dxer/onyx.git
cd onyx
cp .env.example .env          # edit ADMIN_USERNAME / ADMIN_PASSWORD
pnpm install
pnpm build
pnpm start
```

Console is now live at `http://localhost:8080`.

**Option B — Docker (prebuilt Alpine image, auto-built by CI):**

```bash
# uses ghcr.io/dxer/onyx:latest (multi-arch: amd64 + arm64)
docker compose up -d
```

**Option C — Cloudflare Workers (100% free tier):**

```bash
# create D1 database + R2 bucket, fill wrangler.toml
wrangler d1 create onyx-db
wrangler deploy
```

### 2. Create a vault & device token

1. Open the console, sign in with your admin account
2. **New Vault** → name it
3. **Authorize Device** → copy the generated `ost_…` token

### 3. Install the Obsidian plugin

1. Copy `plugin/main.js` + `plugin/manifest.json` into `<vault>/.obsidian/plugins/onyx-sync/`
2. Enable **Onyx Sync** in Obsidian settings
3. Fill in:

| Field | Value |
| :--- | :--- |
| Server URL | `http://your-server:8080` |
| Device Token | `ost_…` from the console |
| Passphrase | your E2EE master password — **must match on every device** |

Done. Edit a note and watch it appear on your other devices.

---

## Configuration

Server config lives in `.env` (see [.env.example](.env.example)):

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `8080` | HTTP port |
| `ADMIN_USERNAME` | `admin` | Auto-provisioned super administrator |
| `ADMIN_PASSWORD` | — | Synced into the DB on every boot |
| `DB_PATH` | `./data/sync.db` | SQLite metadata file |
| `STORAGE_TYPE` | `local` | `local` or `s3` (S3 / MinIO / R2) |
| `STORAGE_LOCAL_DIR` | `./data/blobs` | Blob root (one subfolder per vault) |
| `S3_*` | — | Endpoint / bucket / keys when `STORAGE_TYPE=s3` |

---

## API Surface (v1)

```
GET    /api/v1/session                    # token handshake: vault, salt, device
GET    /api/v1/sync/status                # latest version clock
GET    /api/v1/sync/changes?since=N       # incremental change log
POST   /api/v1/sync/commit                # push encrypted changes
POST   /api/v1/sync/blobs/check           # CAS dedup check
PUT    /api/v1/sync/blobs/:hash           # upload ciphertext blob
GET    /api/v1/sync/blobs/:hash           # download ciphertext blob
GET    /api/v1/user/vaults/:id/activity   # 365-day heatmap data
PATCH  /api/v1/user/tokens/:token         # rename device
POST   /api/v1/user/tokens/:token/rotate  # rotate credential
```

All sync endpoints are automatically scoped to the token's bound vault — cross-vault access is structurally impossible.

---

## Security Model

- **Server knows**: ciphertext, opaque path ciphertext, HMAC hashes, vault version clock, device names
- **Server never knows**: passphrase, encryption keys, plaintext content, plaintext file names
- **At rest on clients**: token + passphrase sealed via DPAPI / Keychain (desktop) or app-sandbox keys (mobile)
- **Registration**: closed by default — the first account becomes admin; all later accounts are provisioned by an admin

---

## Project Layout

```
onyx/
├── src/           # Onyx Server — Hono app, storage drivers, console
├── plugin/        # Onyx Sync — Obsidian plugin (all platforms)
├── shared/        # @onyx/shared — crypto, 3-way merge, protocol types
├── docs/          # logos & diagrams
├── Dockerfile
├── docker-compose.yml
└── wrangler.toml  # Cloudflare Workers deployment
```

## Development

```bash
pnpm install
pnpm dev            # server with hot reload
pnpm build          # everything: shared + server + plugin
pnpm build:plugin   # plugin only
pnpm test           # unit tests
```

## License

[MIT](LICENSE)

---

<div align="center">

**Onyx** — your notes, your server, your keys.

<img src="docs/onyx-logo.svg" width="48" alt="Onyx" />

</div>
