import { describe, it, expect } from 'vitest';
import {
  generateSalt,
  deriveMasterKey,
  deriveSubKeys,
  encryptData,
  decryptData,
  decryptText,
  calculateContentHmac,
  encryptPath,
  decryptPath,
  bytesToHex,
  hexToBytes,
  bytesToBase64Url,
  base64UrlToBytes
} from '../crypto';

describe('Web Crypto E2EE Engine', () => {
  it('converts between hex and bytes properly', () => {
    const original = new Uint8Array([0x00, 0x12, 0xab, 0xff]);
    const hex = bytesToHex(original);
    expect(hex).toBe('0012abff');
    const restored = hexToBytes(hex);
    expect(restored).toEqual(original);
  });

  it('converts between base64url and bytes properly', () => {
    const original = new Uint8Array([10, 20, 30, 40, 50, 255]);
    const b64 = bytesToBase64Url(original);
    expect(b64).not.toContain('+');
    expect(b64).not.toContain('/');
    expect(b64).not.toContain('=');
    const restored = base64UrlToBytes(b64);
    expect(restored).toEqual(original);
  });

  it('generates 32-byte salt', () => {
    const salt1 = generateSalt();
    const salt2 = generateSalt();
    expect(salt1.length).toBe(32);
    expect(salt2.length).toBe(32);
    expect(bytesToHex(salt1)).not.toBe(bytesToHex(salt2));
  });

  it('derives keys and performs encryption/decryption roundtrip for text', async () => {
    const password = 'my-super-secret-vault-password!';
    const salt = generateSalt();

    const masterKey = await deriveMasterKey(password, salt);
    const { dataKey, hmacKey } = await deriveSubKeys(masterKey);

    const plainText = '# My Private Obsidian Note\n\nSecret knowledge that nobody should see!';
    const ciphertext = await encryptData(plainText, dataKey);

    // Ciphertext must contain 12 bytes IV + encrypted bytes
    expect(ciphertext.length).toBeGreaterThan(12 + 16);

    const decrypted = await decryptText(ciphertext, dataKey);
    expect(decrypted).toBe(plainText);
  });

  it('performs encryption/decryption roundtrip for binary data', async () => {
    const password = 'binary-password';
    const salt = generateSalt();

    const masterKey = await deriveMasterKey(password, salt);
    const { dataKey } = await deriveSubKeys(masterKey);

    const binaryData = new Uint8Array([1, 2, 3, 4, 5, 255, 128, 64, 0, 99]);
    const ciphertext = await encryptData(binaryData, dataKey);
    const decrypted = await decryptData(ciphertext, dataKey);

    expect(decrypted).toEqual(binaryData);
  });

  it('fails decryption when ciphertext is tampered with', async () => {
    const password = 'password';
    const salt = generateSalt();
    const masterKey = await deriveMasterKey(password, salt);
    const { dataKey } = await deriveSubKeys(masterKey);

    const ciphertext = await encryptData('Valid Note', dataKey);
    // Tamper with one byte in the ciphertext body
    ciphertext[ciphertext.length - 1] ^= 0x01;

    await expect(decryptData(ciphertext, dataKey)).rejects.toThrow();
  });

  it('calculates deterministic content HMAC hash', async () => {
    const password = 'hash-password';
    const salt = generateSalt();
    const masterKey = await deriveMasterKey(password, salt);
    const { hmacKey } = await deriveSubKeys(masterKey);

    const content1 = 'Identical Content';
    const content2 = 'Identical Content';
    const content3 = 'Different Content';

    const hash1 = await calculateContentHmac(content1, hmacKey);
    const hash2 = await calculateContentHmac(content2, hmacKey);
    const hash3 = await calculateContentHmac(content3, hmacKey);

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash1.length).toBe(64); // SHA-256 hex is 64 chars
  });

  it('encrypts and decrypts relative file paths', async () => {
    const password = 'path-password';
    const salt = generateSalt();
    const masterKey = await deriveMasterKey(password, salt);
    const { dataKey } = await deriveSubKeys(masterKey);

    const path = 'Personal/Finance/2026 Monthly Budget.md';
    const encryptedPath = await encryptPath(path, dataKey);

    expect(encryptedPath).not.toContain('/');
    expect(encryptedPath).not.toContain('Personal');

    const decryptedPath = await decryptPath(encryptedPath, dataKey);
    expect(decryptedPath).toBe(path);
  });
});
