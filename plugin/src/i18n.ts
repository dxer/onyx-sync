export type Locale = 'en' | 'zh';

const en = {
  // General & Status
  pluginName: 'Onyx Sync (E2EE)',
  syncReady: 'Sync: Ready',
  syncInProgress: 'Sync: In progress...',
  syncError: 'Sync: Error',
  syncOffline: 'Sync: Disconnected',
  syncNowCommand: 'Sync Now',
  syncNowRibbon: 'Sync Now',
  syncingNotice: 'Synchronizing vault...',
  syncSuccessNotice: 'Sync completed successfully.',
  syncFailedNotice: 'Sync failed: {error}',

  // Connection & Settings
  settingsTitle: 'Onyx Sync (E2EE) — for Obsidian',
  connectionStatusHeader: 'Connection Status',
  statusConnected: 'Connected: {vaultName} ({deviceName}, v{version})',
  statusDisconnected: 'Disconnected (Please configure Server URL and Device Token)',
  serverUrlName: 'Server URL',
  serverUrlDesc: 'Sync server endpoint address (e.g. http://localhost:8080 or https://sync.example.com)',
  deviceTokenName: 'Device Access Token',
  deviceTokenDesc: 'Dedicated token generated on the management console for this device and vault',
  deviceTokenPlaceholder: 'ost_xxxxxx',
  passphraseName: 'Encryption Passphrase',
  passphraseDesc: 'Zero-knowledge end-to-end encryption master key. Never sent to server; must match across all paired devices.',
  passphrasePlaceholder: 'Enter master encryption passphrase',
  conflictStrategyName: 'Conflict Resolution',
  conflictStrategyDesc: 'Strategy for resolving concurrent edits on Markdown notes',
  conflictMergeOption: 'Automatic 3-Way Merge',
  conflictCopyOption: 'Create Conflict Copy',
  autoSyncName: 'Automatic Synchronization',
  autoSyncDesc: 'Synchronize on file modification, window focus, and background interval',
  syncIntervalName: 'Background Sync Interval (seconds)',
  syncIntervalDesc: 'How often to poll the server when no changes are detected (0 disables interval sync)',

  // Actions
  actionsHeader: 'Connection & Operations',
  testConnectBtn: 'Test Connection',
  testingBtn: 'Connecting...',
  syncNowBtn: 'Sync Now',
  serverUnreachable: 'Server unreachable or returned invalid response.',
  connectedSuccessNotice: 'Connected to vault [{vaultName}] as [{deviceName}].',
  pleaseEnterRequiredFields: 'Please configure Server URL, Device Token, and Passphrase.'
};

const zh: typeof en = {
  // General & Status
  pluginName: 'Onyx 同步 (E2EE)',
  syncReady: '同步状态：就绪',
  syncInProgress: '同步状态：同步中...',
  syncError: '同步状态：连接异常',
  syncOffline: '同步状态：未连接',
  syncNowCommand: '立即执行同步',
  syncNowRibbon: 'Onyx 同步：立即执行同步',
  syncingNotice: '正在同步知识库...',
  syncSuccessNotice: '同步已完成。',
  syncFailedNotice: '同步失败: {error}',

  // Connection & Settings
  settingsTitle: 'Onyx 同步设置 (端到端加密)',
  connectionStatusHeader: '连接状态',
  statusConnected: '已连接: {vaultName} (设备: {deviceName}, 协议时钟: v{version})',
  statusDisconnected: '未连接 (请在下方配置服务端地址与设备访问令牌)',
  serverUrlName: '服务端地址 (Server URL)',
  serverUrlDesc: '同步服务器地址 (如 http://localhost:8080 或 https://sync.example.com)',
  deviceTokenName: '设备访问令牌 (Device Token)',
  deviceTokenDesc: '在管理控制台中为当前设备和知识库生成的专用访问令牌',
  deviceTokenPlaceholder: 'ost_xxxxxx',
  passphraseName: '端到端加密主密码 (Passphrase)',
  passphraseDesc: '零知识加密的核心密钥，仅在本地内存派生，不上传服务端；所有多端设备需保持一致。',
  passphrasePlaceholder: '请输入加密主密码',
  conflictStrategyName: '并发冲突策略',
  conflictStrategyDesc: '当 Markdown 笔记发生多端并发编辑冲突时的处理方式',
  conflictMergeOption: '自动三路合并 (3-Way Merge)',
  conflictCopyOption: '生成冲突副本文件',
  autoSyncName: '后台自动同步',
  autoSyncDesc: '笔记保存、窗口聚焦及定时在后台自动执行静默增量同步',
  syncIntervalName: '后台同步间隔 (秒)',
  syncIntervalDesc: '无变更时轮询服务端的间隔（设为 0 关闭定时轮询，仅保留事件触发同步）',

  // Actions
  actionsHeader: '连接与操作',
  testConnectBtn: '测试连接',
  testingBtn: '正在连接...',
  syncNowBtn: '立即同步',
  serverUnreachable: '无法连接到服务端或服务端返回异常。',
  connectedSuccessNotice: '已成功建立连接：知识库 [{vaultName}] (授权设备: {deviceName})。',
  pleaseEnterRequiredFields: '请完整配置服务端地址、设备令牌与加密主密码。'
};

const translations = { en, zh };

export function getCurrentLocale(): Locale {
  const lang = (window.localStorage.getItem('language') || document.documentElement.lang || navigator.language || '').toLowerCase();
  if (lang.startsWith('zh')) {
    return 'zh';
  }
  return 'en';
}

export function t(key: keyof typeof en, params: Record<string, string | number> = {}): string {
  const locale = getCurrentLocale();
  const dict = translations[locale] || translations.en;
  let text = dict[key] || translations.en[key] || key;

  for (const [paramKey, paramVal] of Object.entries(params)) {
    text = text.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(paramVal));
  }

  return text;
}
