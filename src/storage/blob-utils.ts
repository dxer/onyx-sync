import { assertHash } from '../request-validation';

/** Validates a content hash and normalizes it to the on-disk/object key form. */
export function normalizeBlobHash(hash: string): string {
  assertHash(hash);
  return hash.toLowerCase();
}

export function isValidBlobFileName(name: string): boolean {
  return /^[a-f0-9]{64}$/.test(name);
}
