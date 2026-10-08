import { execFile } from 'node:child_process';
import { hashPasswordForManualSql, parseAdminResetArgs } from './admin-cli';

export interface D1ResetOptions {
  db: string;
  local: boolean;
  username: string;
}

/** Splits wrapper-only flags (`--db`, `--local`/`--remote`) from credential args. */
export function splitD1Args(argv: string[]): { db: string; local: boolean; rest: string[] } {
  let db = 'onyx-db';
  let local = false;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--db' && i + 1 < argv.length) {
      db = argv[++i];
    } else if (arg.startsWith('--db=')) {
      db = arg.slice('--db='.length);
    } else if (arg === '--local') {
      local = true;
    } else if (arg === '--remote') {
      local = false;
    } else {
      rest.push(arg);
    }
  }
  return { db, local, rest };
}

/** Single-quoted SQL literal escaping (salt/hash are hex; username is not). */
export function buildResetSql(username: string, salt: string, passwordHash: string): string {
  const safeUsername = username.replace(/'/g, "''");
  return `UPDATE users SET password_hash = '${passwordHash}', salt = '${salt}' WHERE username = '${safeUsername}';`;
}

function execWrangler(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile('npx', ['wrangler', ...args], { timeout: 120_000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`wrangler failed: ${stderr || error.message}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

/**
 * Last-resort recovery for the Cloudflare Worker deployment (D1, no shell):
 * hashes the new password locally, then applies it with
 * `wrangler d1 execute`. Running wrangler needs Cloudflare API access to the
 * account — which already implies full control over the data, the same trust
 * basis as the SQLite shell command.
 */
export async function resetD1Password(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  runWrangler: (args: string[]) => Promise<{ stdout: string; stderr: string }> = execWrangler
): Promise<D1ResetOptions> {
  const { db, local, rest } = splitD1Args(argv);
  if (!db.trim()) {
    throw new Error('Missing D1 database name (pass --db <name>)');
  }
  const { username, password } = parseAdminResetArgs(rest, env);
  const { salt, passwordHash } = await hashPasswordForManualSql(password);
  const sql = buildResetSql(username, salt, passwordHash);
  await runWrangler(['d1', 'execute', db, local ? '--local' : '--remote', '--command', sql]);
  console.log(
    `[AUDIT] action=admin-password-reset-d1 username="${username}" db=${db} target=${local ? 'local' : 'remote'}`
  );
  return { db, local, username };
}

async function main(): Promise<void> {
  const result = await resetD1Password(process.argv.slice(2));
  console.log(
    `[Auth] Password for "${result.username}" has been reset on D1 database "${result.db}" (${result.local ? 'local' : 'remote'}).`
  );
}

// Only auto-run as a CLI entry point (importable for tests without side effects).
const invokedAsCli = process.argv[1]?.endsWith('admin-reset-d1.ts') || process.argv[1]?.endsWith('admin-reset-d1.js');
if (invokedAsCli) {
  main().then(
    () => process.exit(0),
    (err) => {
      console.error('[Auth] admin:reset-password:d1 failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  );
}
