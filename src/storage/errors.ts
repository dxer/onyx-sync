/**
 * Typed storage errors so HTTP layers can map status codes without matching
 * human-readable message strings.
 */
export type StorageConflictCode =
  | 'identity-conflict'
  | 'request-id-reuse'
  | 'version-conflict'
  | 'initial-sync-in-progress';

export class StorageConflictError extends Error {
  constructor(
    public readonly code: StorageConflictCode,
    message: string
  ) {
    super(message);
    this.name = 'StorageConflictError';
  }
}

export class StorageNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageNotFoundError';
  }
}
