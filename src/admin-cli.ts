import { hashPassword, newSalt } from './auth-utils';
import { assertNewPassword } from './request-validation';
import type { IMetadataStore } from './storage/types';

export interface AdminResetArgs {
  username: string;
  password: string;
}

export interface HashPasswordResult {
  salt: string;
  passwordHash: string;
}

/**
 * Parses `admin:reset-password --username <name> --password <secret>` style
 * argv. The password may also arrive via `ONYX_RESET_PASSWORD` so it never
 * has to appear in shell history.
 */
export function parseAdminResetArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env
): AdminResetArgs {
  let username = '';
  let password = '';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === '--username' || arg === '-u') && i + 1 < argv.length) {
      username = argv[++i].trim();
    } else if ((arg === '--password' || arg === '-p') && i + 1 < argv.length) {
      password = argv[++i];
    } else if (arg.startsWith('--username=')) {
      username = arg.slice('--username='.length).trim();
    } else if (arg.startsWith('--password=')) {
      password = arg.slice('--password='.length);
    }
  }

  if (!password && env.ONYX_RESET_PASSWORD) {
    password = env.ONYX_RESET_PASSWORD;
  }

  if (!username) {
    throw new Error('Missing --username <name> (the account to reset)');
  }
  assertNewPassword(password);
  return { username, password };
}

/**
 * Last-resort recovery: resets an account password straight in the metadata
 * store. Requires shell/filesystem access to the server, which already
 * implies full control — that is what makes this safe to offer while
 * `.env`-driven resets are not.
 */
export async function resetUserPassword(
  metadataStore: IMetadataStore,
  args: AdminResetArgs
): Promise<{ userId: string; username: string }> {
  const existing = await metadataStore.getUserByUsername(args.username);
  if (!existing) {
    throw new Error(`User "${args.username}" does not exist`);
  }
  const salt = newSalt();
  const passwordHash = await hashPassword(args.password, salt);
  // Role is intentionally preserved: recovery must never escalate privileges.
  await metadataStore.updateUserPassword(existing.id, passwordHash, salt);
  console.log(
    `[AUDIT] action=admin-password-reset-cli username="${existing.username}" userId=${existing.id}`
  );
  return { userId: existing.id, username: existing.username };
}

/** Username-only parsing (used for the manual-SQL hint of `admin:hash-password`). */
export function parseUsernameArg(argv: string[]): string {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === '--username' || arg === '-u') && i + 1 < argv.length) {
      return argv[i + 1].trim();
    }
    if (arg.startsWith('--username=')) {
      return arg.slice('--username='.length).trim();
    }
  }
  return '<username>';
}

/** Password-only parsing for `admin:hash-password` (D1/manual-SQL recovery). */
export function parsePasswordArg(argv: string[], env: NodeJS.ProcessEnv = process.env): string {
  let password = '';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === '--password' || arg === '-p') && i + 1 < argv.length) {
      password = argv[++i];
    } else if (arg.startsWith('--password=')) {
      password = arg.slice('--password='.length);
    }
  }
  if (!password && env.ONYX_RESET_PASSWORD) {
    password = env.ONYX_RESET_PASSWORD;
  }
  assertNewPassword(password);
  return password;
}

/** Prints a salt+hash pair for manual recovery on deployments without shell DB access (e.g. D1 via `wrangler d1 execute`). */
export async function hashPasswordForManualSql(password: string): Promise<HashPasswordResult> {
  assertNewPassword(password);
  const salt = newSalt();
  const passwordHash = await hashPassword(password, salt);
  return { salt, passwordHash };
}
