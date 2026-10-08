import { hashPassword, newSalt } from './auth-utils';
import type { IMetadataStore } from './storage/types';

export type AdminBootstrapResult = 'created' | 'already-exists' | 'skipped';

export interface AdminBootstrapOptions {
  adminUsername?: string;
  adminPassword?: string;
  log?: (message: string) => void;
}

/**
 * First-boot admin provisioning ONLY.
 *
 * `ADMIN_PASSWORD` is honored exactly once: when the named account does not
 * exist yet. On every later boot the value is ignored (with a warning), so a
 * leaked `.env` can never silently re-take the account. Day-to-day password
 * changes go through the console (`POST /api/v1/admin/users/:id/password`);
 * a lost last-admin password is recovered with the server-shell command
 * `admin:reset-password` (see `src/admin-cli.ts` + README "Account recovery").
 */
export async function ensureAdminFromEnv(
  metadataStore: IMetadataStore,
  options: AdminBootstrapOptions = {}
): Promise<AdminBootstrapResult> {
  const log = options.log || console.log;
  const adminUsername = options.adminUsername?.trim();
  const adminPassword = options.adminPassword;

  if (!adminUsername || !adminPassword) {
    return 'skipped';
  }

  const existingUser = await metadataStore.getUserByUsername(adminUsername);
  if (!existingUser) {
    const salt = newSalt();
    const passwordHash = await hashPassword(adminPassword, salt);
    const user = await metadataStore.createUser(adminUsername, passwordHash, salt, 'admin');
    log(`[AUDIT] action=admin-bootstrap-created username="${adminUsername}" userId=${user.id}`);
    return 'created';
  }

  log(
    `[Auth] Administrator "${adminUsername}" already exists; ADMIN_PASSWORD from .env is ignored. ` +
      `Change passwords in the console or with the admin:reset-password server command.`
  );
  return 'already-exists';
}
