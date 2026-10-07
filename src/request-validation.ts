import type { CommitChangeItem } from '@onyx/shared';

export const DEFAULT_MAX_BLOB_BYTES = 50 * 1024 * 1024;
export const DEFAULT_MAX_COMMIT_CHANGES = 500;
export const DEFAULT_MAX_BLOB_CHECKS = 1000;
export const MAX_HASH_LENGTH = 64;
export const MAX_PATH_LENGTH = 16 * 1024;
export const MAX_ID_LENGTH = 128;
export const MAX_NAME_LENGTH = 200;
export const MAX_USERNAME_LENGTH = 100;
export const MAX_PASSWORD_LENGTH = 1024;
export const MIN_USERNAME_LENGTH = 3;
export const MIN_PASSWORD_LENGTH = 6;

export class RequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestValidationError';
  }
}

export function isValidHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

export function assertHash(value: unknown, field = 'hash'): asserts value is string {
  if (!isValidHash(value)) {
    throw new RequestValidationError(`${field} must be a 64-character hexadecimal hash`);
  }
}

export function assertOptionalId(value: unknown, field = 'id'): asserts value is string | undefined {
  if (value !== undefined && (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_LENGTH)) {
    throw new RequestValidationError(`${field} is invalid`);
  }
}

export function assertNonEmptyString(value: unknown, field: string, maxLength: number): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new RequestValidationError(`${field} is required and must be at most ${maxLength} characters`);
  }
}

/** Password acceptable for account creation: bounded length, minimum strength. */
export function assertNewPassword(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length < MIN_PASSWORD_LENGTH ||
    value.length > MAX_PASSWORD_LENGTH
  ) {
    throw new RequestValidationError(`password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters`);
  }
}

/** Password shape acceptable for a login attempt: non-empty and bounded. */
export function assertLoginPassword(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PASSWORD_LENGTH) {
    throw new RequestValidationError('password is invalid');
  }
}

export function assertFiniteNonNegativeInteger(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new RequestValidationError(`${field} must be a non-negative integer`);
  }
}

export function assertRequestId(value: unknown): asserts value is string | undefined {
  if (value !== undefined && (typeof value !== 'string' || !/^[a-f0-9-]{16,128}$/i.test(value))) {
    throw new RequestValidationError('requestId is invalid');
  }
}

export function assertCommitChange(value: unknown): asserts value is CommitChangeItem {
  if (!value || typeof value !== 'object') {
    throw new RequestValidationError('Each change must be an object');
  }
  const change = value as Partial<CommitChangeItem>;
  assertOptionalId(change.id);
  assertNonEmptyString(change.encryptedPath, 'encryptedPath', MAX_PATH_LENGTH);
  if (change.isDeleted) {
    if (change.contentHash !== '' || change.size !== 0) {
      throw new RequestValidationError('Deleted changes must have an empty contentHash and zero size');
    }
  } else {
    assertHash(change.contentHash, 'contentHash');
  }
  assertFiniteNonNegativeInteger(change.size, 'size');
  if (typeof change.isDeleted !== 'boolean') {
    throw new RequestValidationError('isDeleted must be boolean');
  }
  if (typeof change.mtime !== 'number' || !Number.isSafeInteger(change.mtime) || change.mtime < 0) {
    throw new RequestValidationError('mtime must be a non-negative integer');
  }
}

export function parseNonNegativeInteger(value: string | undefined, field: string): number {
  if (value === undefined || !/^\d+$/.test(value)) {
    throw new RequestValidationError(`${field} must be a non-negative integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new RequestValidationError(`${field} is out of range`);
  }
  return parsed;
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return await request.json<T>();
  } catch {
    throw new RequestValidationError('Invalid JSON request body');
  }
}

export async function readBodyWithLimit(request: Request, maxBytes: number): Promise<Uint8Array> {
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null) {
    const parsed = Number(contentLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new RequestValidationError('Invalid Content-Length');
    }
    if (parsed > maxBytes) {
      throw new RequestValidationError('Request body exceeds the maximum size');
    }
  }

  if (!request.body) {
    return new Uint8Array();
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new RequestValidationError('Request body exceeds the maximum size');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
