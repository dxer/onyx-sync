import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type CloudSyncPlugin from '../main';
import { SyncApiClient } from '../client';
import { t } from '../i18n';

const SAVE_DEBOUNCE_MS = 600;

export class CloudSyncSettingTab extends PluginSettingTab {
  plugin: CloudSyncPlugin;
  private saveTimer: number | null = null;

  constructor(app: App, plugin: CloudSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * Settings changes are debounced: typing a long token must not trigger a
   * save + engine re-init on every keystroke.
   */
  private scheduleSettingsSave(): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
    }
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.plugin.saveSettings();
    }, SAVE_DEBOUNCE_MS);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: t('settingsTitle') });

    // 1. Connection Status Card — rendered immediately from cached info, then
    // refreshed asynchronously so a slow server never blanks the settings tab.
    const cached = this.plugin.settings;
    const statusDesc = new Setting(containerEl).setName(t('connectionStatusHeader'));
    const statusEl = statusDesc.descEl;
    if (cached.cachedVaultName && cached.cachedDeviceName) {
      statusEl.setText(
        t('statusConnected', {
          vaultName: cached.cachedVaultName,
          deviceName: cached.cachedDeviceName,
          version: '…'
        })
      );
    } else {
      statusEl.setText(t('statusDisconnected'));
    }
    if (cached.serverUrl && cached.deviceToken) {
      void this.refreshSessionStatus(statusEl);
    }

    // 2. Server URL
    new Setting(containerEl)
      .setName(t('serverUrlName'))
      .setDesc(t('serverUrlDesc'))
      .addText((text) =>
        text
          .setPlaceholder('http://localhost:8080')
          .setValue(this.plugin.settings.serverUrl)
          .onChange((value) => {
            this.plugin.settings.serverUrl = value.trim();
            this.scheduleSettingsSave();
          })
      );

    // 3. Device Access Token
    new Setting(containerEl)
      .setName(t('deviceTokenName'))
      .setDesc(t('deviceTokenDesc'))
      .addText((text) =>
        text
          .setPlaceholder(t('deviceTokenPlaceholder'))
          .setValue(this.plugin.settings.deviceToken)
          .onChange((value) => {
            this.plugin.settings.deviceToken = value.trim();
            this.scheduleSettingsSave();
          })
      );

    // 4. Passphrase (E2EE)
    new Setting(containerEl)
      .setName(t('passphraseName'))
      .setDesc(t('passphraseDesc'))
      .addText((text) => {
        text.inputEl.type = 'password';
        text
          .setPlaceholder(t('passphrasePlaceholder'))
          .setValue(this.plugin.settings.passphrase)
          .onChange((value) => {
            this.plugin.settings.passphrase = value;
            this.scheduleSettingsSave();
          });
      });

    // 5. Conflict Resolution Strategy
    new Setting(containerEl)
      .setName(t('conflictStrategyName'))
      .setDesc(t('conflictStrategyDesc'))
      .addDropdown((dropdown) =>
        dropdown
          .addOption('merge', t('conflictMergeOption'))
          .addOption('conflict_file', t('conflictCopyOption'))
          .setValue(this.plugin.settings.conflictStrategy)
          .onChange((value) => {
            if (value !== 'merge' && value !== 'conflict_file') return;
            this.plugin.settings.conflictStrategy = value;
            this.scheduleSettingsSave();
          })
      );

    // 6. Auto Sync
    new Setting(containerEl)
      .setName(t('autoSyncName'))
      .setDesc(t('autoSyncDesc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoSync)
          .onChange((value) => {
            this.plugin.settings.autoSync = value;
            this.scheduleSettingsSave();
          })
      );

    // 7. Sync Interval
    new Setting(containerEl)
      .setName(t('syncIntervalName'))
      .setDesc(t('syncIntervalDesc'))
      .addText((text) => {
        text.inputEl.type = 'number';
        text.setPlaceholder('30').setValue(String(this.plugin.settings.syncInterval));
        text.onChange((value) => {
          const seconds = Number(value);
          if (!Number.isFinite(seconds) || seconds < 0) return;
          this.plugin.settings.syncInterval = Math.floor(seconds);
          this.scheduleSettingsSave();
        });
      });

    // Actions Header
    containerEl.createEl('h3', { text: t('actionsHeader') });

    // Test Connection — builds the client from the CURRENT settings so edits
    // made in this tab are what gets tested.
    new Setting(containerEl)
      .setName(t('testConnectBtn'))
      .addButton((button) =>
        button.setButtonText(t('testConnectBtn')).onClick(async () => {
          const settings = this.plugin.settings;
          if (!settings.serverUrl || !settings.deviceToken) {
            new Notice(t('pleaseEnterRequiredFields'));
            return;
          }
          const client = new SyncApiClient(settings.serverUrl, settings.deviceToken);

          button.setDisabled(true);
          button.setButtonText(t('testingBtn'));

          try {
            const isHealthy = await client.checkHealth();
            if (!isHealthy) {
              new Notice(t('serverUnreachable'));
              return;
            }

            const session = await client.getSession();
            new Notice(
              t('connectedSuccessNotice', {
                vaultName: session.vaultName,
                deviceName: session.deviceName
              })
            );
            this.display();
          } catch (err: any) {
            new Notice(t('serverUnreachable') + ` ${err.message || String(err)}`);
          } finally {
            button.setDisabled(false);
            button.setButtonText(t('testConnectBtn'));
          }
        })
      );

    // Sync Now
    new Setting(containerEl)
      .setName(t('syncNowBtn'))
      .addButton((button) =>
        button
          .setButtonText(t('syncNowBtn'))
          .setCta()
          .onClick(async () => {
            new Notice(t('syncingNotice'));
            await this.plugin.triggerSync({ force: true, fullScan: true });
          })
      );
  }

  private async refreshSessionStatus(statusEl: HTMLElement): Promise<void> {
    try {
      const settings = this.plugin.settings;
      const client = new SyncApiClient(settings.serverUrl, settings.deviceToken);
      const session = await client.getSession();
      statusEl.setText(
        t('statusConnected', {
          vaultName: session.vaultName,
          deviceName: session.deviceName,
          version: session.latestVersion
        })
      );
      settings.cachedVaultId = session.vaultId;
      settings.cachedVaultName = session.vaultName;
      settings.cachedDeviceName = session.deviceName;
      await this.plugin.saveSettings();
    } catch {
      statusEl.setText(t('statusDisconnected'));
    }
  }
}
