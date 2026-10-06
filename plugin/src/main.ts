import { Plugin, Notice } from 'obsidian';
import { DEFAULT_SETTINGS, type SyncPluginSettings, type SyncState } from './types';
import { SyncEngine } from './sync-engine';
import { CloudSyncSettingTab } from './ui/settings';
import { t } from './i18n';
import { encryptDeviceSecret, decryptDeviceSecret } from './security';

export default class CloudSyncPlugin extends Plugin {
  settings: SyncPluginSettings = DEFAULT_SETTINGS;
  syncEngine: SyncEngine | null = null;
  private statusBarEl: HTMLElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Add Status Bar Item
    this.statusBarEl = this.addStatusBarItem();
    this.updateStatusBar('idle');

    // Add Ribbon Icon for one-click manual sync
    this.addRibbonIcon('refresh-cw', t('syncNowRibbon'), async () => {
      new Notice(t('syncingNotice'));
      await this.triggerSync({ force: true, fullScan: true });
    });

    // Add Command Palette Action
    this.addCommand({
      id: 'cloud-sync-now',
      name: t('syncNowCommand'),
      callback: async () => {
        await this.triggerSync({ force: true, fullScan: true });
      }
    });

    // Add Settings Tab
    this.addSettingTab(new CloudSyncSettingTab(this.app, this));

    // Initialize Sync Engine
    this.syncEngine = new SyncEngine(this.app, this.settings, (state: SyncState) => {
      this.updateStatusBar(state);
    });

    await this.syncEngine.start();
  }

  onunload(): void {
    if (this.syncEngine) {
      this.syncEngine.stop();
      this.syncEngine = null;
    }
  }

  async loadSettings(): Promise<void> {
    const rawData = (await this.loadData()) || {};

    const tokenSource = rawData.encDeviceToken || rawData.deviceToken || '';
    const passSource = rawData.encPassphrase || rawData.passphrase || '';

    const decryptedToken = await decryptDeviceSecret(tokenSource);
    const decryptedPass = await decryptDeviceSecret(passSource);

    this.settings = Object.assign({}, DEFAULT_SETTINGS, rawData, {
      deviceToken: decryptedToken,
      passphrase: decryptedPass
    });

    // If legacy plaintext existed on disk, auto-encrypt and re-save
    if (rawData.deviceToken || rawData.passphrase) {
      await this.saveSettings();
    }
  }

  async saveSettings(): Promise<void> {
    // Encrypt sensitive secrets at rest with hardware/device binding
    const encToken = await encryptDeviceSecret(this.settings.deviceToken);
    const encPass = await encryptDeviceSecret(this.settings.passphrase);

    const toStore = {
      serverUrl: this.settings.serverUrl,
      encDeviceToken: encToken,
      encPassphrase: encPass,
      autoSync: this.settings.autoSync,
      syncInterval: this.settings.syncInterval,
      conflictStrategy: this.settings.conflictStrategy,
      cachedVaultId: this.settings.cachedVaultId,
      cachedVaultName: this.settings.cachedVaultName,
      cachedDeviceName: this.settings.cachedDeviceName
    };

    await this.saveData(toStore);

    if (this.syncEngine) {
      this.syncEngine.updateSettings(this.settings);
    }
  }

  async triggerSync(options: { force?: boolean; fullScan?: boolean } = {}): Promise<void> {
    if (this.syncEngine) {
      await this.syncEngine.sync(options);
    }
  }

  private updateStatusBar(state: SyncState): void {
    if (!this.statusBarEl) return;

    switch (state) {
      case 'syncing':
        this.statusBarEl.setText(t('syncInProgress'));
        break;
      case 'idle':
        this.statusBarEl.setText(t('syncReady'));
        break;
      case 'error':
        this.statusBarEl.setText(t('syncError'));
        break;
      case 'offline':
        this.statusBarEl.setText(t('syncOffline'));
        break;
    }
  }
}
