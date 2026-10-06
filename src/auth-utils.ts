import { bytesToHex, hexToBytes, generateSalt } from '@onyx/shared';

const textEncoder = new TextEncoder();

export async function hashPassword(password: string, saltHex: string): Promise<string> {
  const salt = hexToBytes(saltHex);
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    key,
    256
  );

  return bytesToHex(new Uint8Array(bits));
}

export function newSalt(): string {
  return bytesToHex(generateSalt());
}
