import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type CloudSyncPlugin from '../main';
import { SyncApiClient } from '../client';
import { t } from '../i18n';

export class CloudSyncSettingTab extends PluginSettingTab {
  plugin: CloudSyncPlugin;

  constructor(app: App, plugin: CloudSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  async display(): Promise<void> {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: t('settingsTitle') });

    // 1. Connection Status Card
    const client = new SyncApiClient(
      this.plugin.settings.serverUrl,
      this.plugin.settings.deviceToken
    );

    let sessionStatusDesc = t('statusDisconnected');
    if (this.plugin.settings.serverUrl && this.plugin.settings.deviceToken) {
      try {
        const session = await client.getSession();
        sessionStatusDesc = t('statusConnected', {
          vaultName: session.vaultName,
          deviceName: session.deviceName,
          version: session.latestVersion
        });
        this.plugin.settings.cachedVaultId = session.vaultId;
        this.plugin.settings.cachedVaultName = session.vaultName;
        this.plugin.settings.cachedDeviceName = session.deviceName;
        await this.plugin.saveSettings();
      } catch {
        sessionStatusDesc = t('statusDisconnected');
      }
    }

    new Setting(containerEl)
      .setName(t('connectionStatusHeader'))
      .setDesc(sessionStatusDesc);

    // 2. Server URL
    new Setting(containerEl)
      .setName(t('serverUrlName'))
      .setDesc(t('serverUrlDesc'))
      .addText((text) =>
        text
          .setPlaceholder('http://localhost:8080')
          .setValue(this.plugin.settings.serverUrl)
          .onChange(async (value) => {
            this.plugin.settings.serverUrl = value.trim();
            await this.plugin.saveSettings();
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
          .onChange(async (value) => {
            this.plugin.settings.deviceToken = value.trim();
            await this.plugin.saveSettings();
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
          .onChange(async (value) => {
            this.plugin.settings.passphrase = value;
            await this.plugin.saveSettings();
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
          .onChange(async (value: 'merge' | 'conflict_file') => {
            this.plugin.settings.conflictStrategy = value;
            await this.plugin.saveSettings();
          })
      );

    // 6. Auto Sync
    new Setting(containerEl)
      .setName(t('autoSyncName'))
      .setDesc(t('autoSyncDesc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoSync)
          .onChange(async (value) => {
            this.plugin.settings.autoSync = value;
            await this.plugin.saveSettings();
          })
      );

    // Actions Header
    containerEl.createEl('h3', { text: t('actionsHeader') });

    // Test Connection
    new Setting(containerEl)
      .setName(t('testConnectBtn'))
      .addButton((button) =>
        button.setButtonText(t('testConnectBtn')).onClick(async () => {
          if (!this.plugin.settings.serverUrl || !this.plugin.settings.deviceToken) {
            new Notice(t('pleaseEnterRequiredFields'));
            return;
          }

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
            await this.display();
          } catch (err: any) {
            new Notice(t('operationFailed', { error: err.message || String(err) }));
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
}
