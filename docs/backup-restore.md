# Backup & Restore Runbook

Single-node deployment: the server keeps **two** things on disk, and you need
both for a restore.

| What | Default location | Contents |
| :--- | :--- | :--- |
| Metadata (SQLite, WAL mode) | `./data/sync.db` (+ `-wal` / `-shm` while running) | users, vaults, tokens (hash-only), version clock, change log |
| Ciphertext blobs | `./data/blobs/<vault_id>/…` | AES-256-GCM file contents; useless without the DB + passphrase |

The passphrase is **never** on the server. A backup restores *access to
ciphertext*; clients still need their passphrase to read anything.

## Backup (online-safe, no downtime)

SQLite in WAL mode cannot be copied naively while the server writes. Use one
of these instead:

```bash
# Option A — point-in-time snapshot into the backup dir (preferred).
# VACUUM INTO writes a consistent, compacted copy without stopping the server.
sqlite3 /data/sync.db "VACUUM INTO '/backup/sync-2026-10-08.db'"

# Option B — filesystem snapshot (LVM/ZFS/R2 sync) AFTER a checkpoint.
# Checkpoint first so the -wal content is inside the main file:
sqlite3 /data/sync.db "PRAGMA wal_checkpoint(TRUNCATE);"
rsync -a --delete /data/blobs/ /backup/blobs/
cp /data/sync.db /backup/sync-2026-10-08.db
```

Suggested schedule: nightly `VACUUM INTO` + `rsync` (cron or systemd timer),
kept 7 daily + 4 weekly copies, plus one off-site copy. Verify **every**
backup immediately:

```bash
sqlite3 /backup/sync-2026-10-08.db "PRAGMA integrity_check;"  # must print: ok
sqlite3 /backup/sync-2026-10-08.db "SELECT count(*) FROM vaults;"
ls /backup/blobs | wc -l   # vault dirs present
```

An unverified backup is not a backup.

## Restore

1. Stop the server (`docker compose stop onyx`, or `SIGTERM` and wait for
   `[Shutdown] Clean exit` in the logs).
2. Move the broken data aside — never delete before the restore is proven:
   `mv /data /data.broken-2026-10-08`.
3. Put the backup in place:
   ```bash
   mkdir -p /data
   cp /backup/sync-2026-10-08.db /data/sync.db
   rsync -a /backup/blobs/ /data/blobs/
   chown -R <server-user> /data   # match the container/service user
   ```
4. Start the server and check the subdivided readiness probe —
   `GET /api/v1/readyz` must report `metadata: ok, blobs: ok, disk: ok`.
5. Log in to the console, spot-check one vault, and run a sync from one
   client. Only then delete `/data.broken-*`.

Clients need no re-pairing after a restore: tokens, salts and the version
clock all live in `sync.db`. If the backup is older than the clients'
state, the next sync simply pulls/pushes the delta.

## Cloudflare Worker (D1 + R2) notes

- D1: `wrangler d1 backup create onyx-db` on a schedule (or Time Travel for
  point-in-time restore within the retention window).
- R2: enable object versioning on the bucket; GC (`POST …/gc`) only deletes
  unreferenced blobs older than the grace period, so a short R2 retention
  still covers accidents.
- Restore = `wrangler d1 backup restore` + point R2 versioning back; the
  Worker itself is stateless, just redeploy.

## What NOT to back up

- `.env` secrets as-is: store them in your password manager; a backup that
  contains `ADMIN_PASSWORD` next to `sync.db` defeats the init-only admin
  provisioning (see README "Account recovery").
- Server logs: ship `[AUDIT]` lines to Loki/ELK separately; they are evidence,
  not state.
