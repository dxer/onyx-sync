/**
 * Stateless short-lived WebSocket tickets.
 *
 * A ticket is `base64url(payloadJson).base64url(hmacSha256(payloadJson))`, signed
 * with a server-side secret. It carries the tokenId (not the token secret), so a
 * leaked ticket grants at most one WebSocket connection within its TTL, and a
 * revoked/expired token can still be rejected at upgrade time and on the
 * periodic re-check by looking the tokenId up.
 */

const textEncoder = new TextEncoder();

export interface WsTicketPayload {
  jti: string;
  tokenId: string;
  userId: string;
  vaultId: string;
  exp: number;
}

export const WS_TICKET_TTL_SECONDS = 60;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  let base64 = value.replace(/-/g, '+').replace(/_/g, '/');
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

async function hmacSign(secret: string, data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, data);
  return new Uint8Array(signature);
}

export async function mintWsTicket(secret: string, payload: WsTicketPayload): Promise<string> {
  const body = toBase64Url(textEncoder.encode(JSON.stringify(payload)));
  const signature = await hmacSign(secret, textEncoder.encode(body));
  return `${body}.${toBase64Url(signature)}`;
}

export async function verifyWsTicket(secret: string, ticket: string): Promise<WsTicketPayload | null> {
  const dotIndex = ticket.indexOf('.');
  if (dotIndex <= 0 || dotIndex === ticket.length - 1) return null;

  const body = ticket.slice(0, dotIndex);
  const signature = ticket.slice(dotIndex + 1);

  let expected: Uint8Array;
  try {
    expected = await hmacSign(secret, textEncoder.encode(body));
  } catch {
    return null;
  }
  let provided: Uint8Array;
  try {
    provided = fromBase64Url(signature);
  } catch {
    return null;
  }
  if (provided.byteLength !== expected.byteLength) return null;
  let diff = 0;
  for (let i = 0; i < expected.byteLength; i++) {
    diff |= expected[i] ^ provided[i];
  }
  if (diff !== 0) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as WsTicketPayload;
    if (
      typeof payload.exp !== 'number' ||
      payload.exp < Date.now() ||
      typeof payload.tokenId !== 'string' ||
      typeof payload.userId !== 'string' ||
      typeof payload.vaultId !== 'string'
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
