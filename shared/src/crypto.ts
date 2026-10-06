/**
 * E2EE Cryptographic Module for Obsidian Sync
 * Built entirely on standard Web Crypto API (SubtleCrypto)
 * Fully compatible with Node.js 18+, Modern Browsers, Electron, and Mobile (Capacitor/iOS/Android)
 */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// Helper to get crypto implementation
function getSubtleCrypto(): SubtleCrypto {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    return globalThis.crypto.subtle;
  }
  throw new Error('Web Crypto API (crypto.subtle) is not available in this environment');
}

/**
 * Generate cryptographically secure random bytes
 */
export function getRandomBytes(byteLength: number): Uint8Array {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Generate 32-byte random salt for password derivation
 */
export function generateSalt(): Uint8Array {
  return getRandomBytes(32);
}

/**
 * Hex conversion utilities
 */
export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error('Invalid hex string length');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Base64URL conversion utilities (safe for URLs, filenames, and JSON)
 */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(base64url: string): Uint8Array {
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Derive Master Key from user passphrase and salt using PBKDF2
 * Returns an HKDF CryptoKey that can derive multiple specialized subkeys
 */
export async function deriveMasterKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const subtle = getSubtleCrypto();
  const passwordKey = await subtle.importKey(
    'raw',
    textEncoder.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  // 100,000 iterations PBKDF2-HMAC-SHA256
  const derivedBits = await subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    passwordKey,
    256 // 32 bytes
  );

  // Import derived 256 bits as HKDF Master Key
  return subtle.importKey(
    'raw',
    derivedBits,
    { name: 'HKDF' },
    false,
    ['deriveKey']
  );
}

export interface DerivedKeys {
  dataKey: CryptoKey; // AES-256-GCM for content and path encryption
  hmacKey: CryptoKey; // HMAC-SHA256 for deterministic content hash calculation
}

/**
 * Derive specialized sub-keys from Master Key using HKDF
 */
export async function deriveSubKeys(masterKey: CryptoKey): Promise<DerivedKeys> {
  const subtle = getSubtleCrypto();

  // 1. Data Encryption Key (AES-GCM 256)
  const dataKey = await subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(),
      info: textEncoder.encode('obsidian-sync-aes-gcm-data-v1')
    },
    masterKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  // 2. Deterministic Hash Key (HMAC-SHA256)
  const hmacKey = await subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(),
      info: textEncoder.encode('obsidian-sync-hmac-hash-v1')
    },
    masterKey,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign']
  );

  return { dataKey, hmacKey };
}

/**
 * Encrypt data (text or binary) using AES-256-GCM
 * Output format: [12 bytes IV] + [Ciphertext + 16 bytes Auth Tag]
 */
export async function encryptData(data: Uint8Array | string, dataKey: CryptoKey): Promise<Uint8Array> {
  const subtle = getSubtleCrypto();
  const rawBytes = typeof data === 'string' ? textEncoder.encode(data) : data;
  const iv = getRandomBytes(12);

  const encryptedBuffer = await subtle.encrypt(
    {
      name: 'AES-GCM',
      iv
    },
    dataKey,
    rawBytes
  );

  const ciphertextWithTag = new Uint8Array(encryptedBuffer);
  const combined = new Uint8Array(iv.length + ciphertextWithTag.length);
  combined.set(iv, 0);
  combined.set(ciphertextWithTag, iv.length);

  return combined;
}

/**
 * Decrypt data using AES-256-GCM
 * Input format: [12 bytes IV] + [Ciphertext + 16 bytes Auth Tag]
 */
export async function decryptData(encryptedBytes: Uint8Array, dataKey: CryptoKey): Promise<Uint8Array> {
  const subtle = getSubtleCrypto();
  if (encryptedBytes.length < 12 + 16) {
    throw new Error('Encrypted data too short to contain IV and Auth Tag');
  }

  const iv = encryptedBytes.slice(0, 12);
  const ciphertextWithTag = encryptedBytes.slice(12);

  const decryptedBuffer = await subtle.decrypt(
    {
      name: 'AES-GCM',
      iv
    },
    dataKey,
    ciphertextWithTag
  );

  return new Uint8Array(decryptedBuffer);
}

/**
 * Decrypt data and decode as UTF-8 string
 */
export async function decryptText(encryptedBytes: Uint8Array, dataKey: CryptoKey): Promise<string> {
  const decryptedBytes = await decryptData(encryptedBytes, dataKey);
  return textDecoder.decode(decryptedBytes);
}

/**
 * Compute deterministic content HMAC-SHA256 hash (in hex)
 * Server uses this hash for deduplication and CAS (Content Addressed Storage)
 * Zero knowledge: Server cannot reverse this hash to plaintext without HMAC key
 */
export async function calculateContentHmac(data: Uint8Array | string, hmacKey: CryptoKey): Promise<string> {
  const subtle = getSubtleCrypto();
  const rawBytes = typeof data === 'string' ? textEncoder.encode(data) : data;

  const signatureBuffer = await subtle.sign(
    'HMAC',
    hmacKey,
    rawBytes
  );

  return bytesToHex(new Uint8Array(signatureBuffer));
}

/**
 * Encrypt relative file path to Base64URL string
 */
export async function encryptPath(plainPath: string, dataKey: CryptoKey): Promise<string> {
  const encrypted = await encryptData(plainPath, dataKey);
  return bytesToBase64Url(encrypted);
}

/**
 * Decrypt Base64URL encrypted file path to plaintext string
 */
export async function decryptPath(encryptedPath: string, dataKey: CryptoKey): Promise<string> {
  const bytes = base64UrlToBytes(encryptedPath);
  return decryptText(bytes, dataKey);
}
