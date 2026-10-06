export interface SyncPluginSettings {
  serverUrl: string;
  deviceToken: string; // Generated on web dashboard
  passphrase: string; // Master password for end-to-end encryption
  autoSync: boolean;
  syncInterval: number; // in seconds
  conflictStrategy: 'merge' | 'conflict_file';

  // Cached metadata received automatically from session handshake
  cachedVaultId?: string;
  cachedVaultName?: string;
  cachedDeviceName?: string;
}

export const DEFAULT_SETTINGS: SyncPluginSettings = {
  serverUrl: 'http://localhost:8080',
  deviceToken: '',
  passphrase: '',
  autoSync: true,
  syncInterval: 5,
  conflictStrategy: 'merge'
};

export type SyncState = 'idle' | 'syncing' | 'error' | 'offline';
