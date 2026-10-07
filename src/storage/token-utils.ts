import type { CreateTokenOptions } from './types';

export const MASTER_TOKEN_TTL_DAYS = 30;
export const DEVICE_TOKEN_TTL_DAYS = 180;

export function newTokenSecret(): string {
  return `ost_${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`;
}

export function tokenExpiry(tokenType: 'master' | 'device', options?: CreateTokenOptions): number {
  const days = options?.expiresInDays ?? (tokenType === 'master' ? MASTER_TOKEN_TTL_DAYS : DEVICE_TOKEN_TTL_DAYS);
  return Date.now() + days * 86400000;
}
