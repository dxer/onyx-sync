// Dashboard application script, served at /assets/app.js (kept out of the HTML
// so the page CSP can forbid inline scripts).
export const DASHBOARD_APP_JS = `const I18N = {
      zh: {
        brandTitle: 'Onyx Sync',
        brandBadge: 'Serverless Node',
        roleAdmin: 'Administrator',
        roleUser: 'User',
        logout: '退出登录',
        langToggle: 'English',
        checkingAuth: '正在校验安全凭据...',
        loginTitle: '登录同步平台',
        loginSub: '私有云存储节点 · 请输入凭据登录',
        setupTitle: '系统初始化 · 创建管理员',
        setupBanner: '检测到系统尚未配置管理员账户。请设置首位超级管理员账户以完成初始化。',
        usernameLabel: '用户名',
        usernamePlaceholder: '至少 3 位字母或数字',
        passwordLabel: '密码',
        passwordPlaceholder: '至少 6 位字符',
        signInBtn: '登 录',
        initAdminBtn: '创建超级管理员并登录',
        processing: '正在处理...',
        authFootnote: '私有存储节点 · 新账户请联系系统管理员在控制台中开通',
        statVaults: '知识库总数',
        statDevices: '已授权设备',
        statStorage: '密文存储占用',
        statUsers: '全站注册用户',
        tabVaults: '知识库与设备 (Vaults)',
        tabAdmin: '系统运维与管理 (Admin)',
        vaultsTitle: '同步知识库 (Vaults)',
        vaultsDesc: '基于客户端端到端零知识加密（E2EE），服务端仅持久化密文块与版本时钟。设备需通过绑定的令牌建立专属同步通道。',
        newVaultBtn: '新建知识库',
        clockVersion: '时钟版本',
        fileCount: '文件数',
        cipherStorage: '密文存储',
        createdAt: '创建时间',
        authorizeDevice: '授权新设备',
        deleteVault: '删除知识库',
        emptyVaultsTitle: '暂无同步知识库',
        emptyVaultsDesc: '创建您的第一个同步知识库，随后为 PC 或移动设备生成专属访问令牌。',
        emptyVaultsBtn: '立即创建知识库',
        heatmapTitle: '同步活动历史 (近 365 天)',
        heatmapCommits: '近一年累计提交更新 {count} 次',
        heatmapLess: '少',
        heatmapMore: '多',
        daysMon: '一',
        daysWed: '三',
        daysFri: '五',
        noActivity: '无文件更新',
        activityCount: '次文件修改同步',
        devicesHeader: '已授权设备与访问令牌:',
        lastSynced: '最后同步:',
        copyToken: '复制',
        rotateToken: '轮转令牌',
        revokeDevice: '吊销凭据',
        noDevices: '当前知识库尚未绑定任何设备。点击上方“授权新设备”生成专属访问凭据。',
        adminOverview: '全局运维指标',
        totalUsers: '总用户数',
        totalVaults: '总知识库数',
        totalFiles: '全站文件块数',
        totalStorage: '总密文占用',
        userMgmtTitle: '用户与访问控制',
        userMgmtDesc: '公开注册已禁用。系统管理员可在此开通新成员账户并配置访问权限。',
        createUserBtn: '创建新用户',
        refreshUsersBtn: '刷新列表',
        thUsername: '用户名',
        thRole: '角色',
        thVaultCount: '知识库数',
        thStorageUsed: '存储消耗',
        thRegisteredAt: '开通时间',
        thActions: '操作',
        deleteUserBtn: '删除用户',
        resetPasswordBtn: '重置密码',
        resetPasswordPrompt: '请输入用户“{username}”的新密码（至少 6 位）：',
        resetPasswordDone: '用户“{username}”的密码已重置。',
        currentAccountBadge: '当前登录',
        modalNewVaultTitle: '新建同步知识库',
        modalNewVaultDesc: '系统将为该知识库分配独立物理存储分区与随机密码派生盐。',
        vaultNameInput: '知识库名称',
        vaultNamePlaceholder: '例如: 核心笔记, 工作知识库',
        cancel: '取消',
        confirmCreate: '确认创建',
        modalAuthDeviceTitle: '授权新设备凭据',
        modalAuthDeviceSub: '为知识库 “{vault}” 生成专属的客户端设备同步凭据。',
        deviceNameInput: '设备标识名称 (Device Name)',
        deviceNamePlaceholder: '例如: MacBook Pro, 工作站 PC, 个人手机',
        generateTokenBtn: '生成令牌凭据',
        authSuccessBanner: '设备凭据生成成功。请将下方设备令牌填入 Obsidian 插件设置。',
        deviceTokenInput: '设备访问令牌 (Device Access Token)',
        done: '完成',
        modalRenameTitle: '修改设备标识名称',
        newDeviceNameInput: '新设备名称',
        saveChanges: '保存修改',
        modalRotateTitle: '访问令牌已轮转',
        rotateSuccessBanner: '原访问令牌已立即作废。请将下方新生成的令牌更新至设备 “{device}” 的 Obsidian 插件设置中。',
        newDeviceTokenInput: '新设备访问令牌 (一键复制)',
        acknowledge: '我知道了',
        modalCreateUserTitle: '开通新系统用户',
        modalCreateUserDesc: '为新成员开通独立同步账户，其知识库与文件块享受物理级隔离保护。',
        newUserUsername: '用户名',
        newUserPassword: '初始密码',
        randomPassword: '随机密码',
        newUserRole: '账户角色',
        roleOptionUser: '普通用户 (仅管理个人知识库与设备)',
        roleOptionAdmin: '系统管理员 (可管理全站用户与系统配置)',
        confirmCreateUser: '确认开通',
        alertCopied: '令牌已复制到剪贴板！',
        confirmRevokeDevice: '确定吊销该设备的访问令牌吗？吊销后该设备将立即断开与服务端的同步连接。',
        confirmRotateToken: '警告：轮转令牌将立即废弃当前凭据并生成新令牌，现有客户端连接将中断直至填入新令牌。确定继续？',
        confirmDeleteVault: '警告：确定永久删除知识库吗？该知识库所有设备令牌及服务端物理存储密文块将被彻底销毁。此操作不可恢复。',
        confirmDeleteUser: '确定永久删除用户 “{username}” 及其所有关联知识库和数据吗？',
        rememberMe: '记住我（30 天内保持登录）',
        sessionExpired: '登录已过期，请重新登录。',
        copyFailed: '复制失败，请手动选择文本复制。',
        tokenRevoked: '已吊销',
        tokenExpired: '已过期',
        gcBtn: '清理',
        gcBtnTitle: '回收该知识库中不再被引用的密文块',
        gcConfirm: '扫描知识库 “{vault}” 并删除不再被任何文件引用的密文块？为保护进行中的同步，7 天内新增的孤儿块会被保留。',
        gcDone: '扫描 {scanned} 个密文块：删除 {deleted} 个，保留 {kept} 个。',
        deletionJobBanner: '知识库 “{vault}” 的密文清理未完成（任务 {jobId}），元数据已删除，可点击重试完成清理。',
        retryBtn: '重试',
        dismissBtn: '忽略',
        deletionRetryDone: '密文清理任务已完成。',
        deletionRetryPending: '清理仍在进行中，请稍后重试。'
      },
      en: {
        brandTitle: 'Onyx Sync',
        brandBadge: 'Serverless Node',
        roleAdmin: 'Administrator',
        roleUser: 'User',
        logout: 'Sign Out',
        langToggle: '中文',
        checkingAuth: 'Verifying credentials...',
        loginTitle: 'Sign in to Sync Console',
        loginSub: 'Private storage node · Sign in with your credentials',
        setupTitle: 'Initial Setup · Create Administrator',
        setupBanner: 'No administrator configured. Create the primary super administrator to complete initial setup.',
        usernameLabel: 'Username',
        usernamePlaceholder: 'At least 3 characters',
        passwordLabel: 'Password',
        passwordPlaceholder: 'At least 6 characters',
        signInBtn: 'Sign In',
        initAdminBtn: 'Create Administrator & Sign In',
        processing: 'Processing...',
        authFootnote: 'Private storage node · Contact system administrator for account provisioning',
        statVaults: 'Total Vaults',
        statDevices: 'Active Devices',
        statStorage: 'Ciphertext Storage',
        statUsers: 'Total Users',
        tabVaults: 'Vaults & Devices',
        tabAdmin: 'Administration',
        vaultsTitle: 'Sync Vaults',
        vaultsDesc: 'End-to-end zero-knowledge encrypted storage. The server only holds ciphertext blobs and version clocks. Clients connect via scoped device tokens.',
        newVaultBtn: 'New Vault',
        clockVersion: 'Version',
        fileCount: 'Files',
        cipherStorage: 'Ciphertext',
        createdAt: 'Created',
        authorizeDevice: 'Authorize Device',
        deleteVault: 'Delete Vault',
        emptyVaultsTitle: 'No sync vaults found',
        emptyVaultsDesc: 'Create your first sync vault to begin pairing desktop and mobile clients.',
        emptyVaultsBtn: 'Create a Vault',
        heatmapTitle: 'Sync Activity History (Past 365 Days)',
        heatmapCommits: '{count} sync commits in the past year',
        heatmapLess: 'Less',
        heatmapMore: 'More',
        daysMon: 'Mon',
        daysWed: 'Wed',
        daysFri: 'Fri',
        noActivity: 'No sync commits',
        activityCount: 'files modified',
        devicesHeader: 'Authorized Devices & Access Tokens:',
        lastSynced: 'Last active:',
        copyToken: 'Copy',
        rotateToken: 'Rotate Token',
        revokeDevice: 'Revoke',
        noDevices: 'No devices authorized for this vault yet. Click "Authorize Device" to provision credentials.',
        adminOverview: 'System Overview',
        totalUsers: 'Total Users',
        totalVaults: 'Total Vaults',
        totalFiles: 'Ciphertext Blobs',
        totalStorage: 'Total Storage',
        userMgmtTitle: 'User Management',
        userMgmtDesc: 'Public registration is disabled. Administrators can provision accounts and configure roles.',
        createUserBtn: 'New User',
        refreshUsersBtn: 'Refresh',
        thUsername: 'Username',
        thRole: 'Role',
        thVaultCount: 'Vaults',
        thStorageUsed: 'Storage',
        thRegisteredAt: 'Provisioned',
        thActions: 'Actions',
        deleteUserBtn: 'Delete',
        resetPasswordBtn: 'Reset password',
        resetPasswordPrompt: 'Enter a new password for "{username}" (min 6 chars):',
        resetPasswordDone: 'Password for "{username}" has been reset.',
        currentAccountBadge: 'Current',
        modalNewVaultTitle: 'Create New Sync Vault',
        modalNewVaultDesc: 'A dedicated storage partition and random password derivation salt will be provisioned.',
        vaultNameInput: 'Vault Name',
        vaultNamePlaceholder: 'e.g. Core Notes, Research Vault',
        cancel: 'Cancel',
        confirmCreate: 'Create Vault',
        modalAuthDeviceTitle: 'Authorize Device Credential',
        modalAuthDeviceSub: 'Provision a dedicated device access credential for vault "{vault}".',
        deviceNameInput: 'Device Name',
        deviceNamePlaceholder: 'e.g. MacBook Pro, Workstation, Mobile',
        generateTokenBtn: 'Generate Credential',
        authSuccessBanner: 'Device credential generated successfully. Paste the token below into your Obsidian plugin settings.',
        deviceTokenInput: 'Device Access Token',
        done: 'Done',
        modalRenameTitle: 'Rename Device',
        newDeviceNameInput: 'New Device Name',
        saveChanges: 'Save Changes',
        modalRotateTitle: 'Access Token Rotated',
        rotateSuccessBanner: 'The previous access token was revoked immediately. Update device "{device}" with the new token below.',
        newDeviceTokenInput: 'New Device Access Token',
        acknowledge: 'Acknowledge',
        modalCreateUserTitle: 'Provision User Account',
        modalCreateUserDesc: 'Create an isolated sync account. Vaults and storage partitions are physically separated.',
        newUserUsername: 'Username',
        newUserPassword: 'Password',
        randomPassword: 'Generate Random',
        newUserRole: 'Role',
        roleOptionUser: 'Standard User (Personal vaults & devices only)',
        roleOptionAdmin: 'System Administrator (Full access & user management)',
        confirmCreateUser: 'Create User',
        alertCopied: 'Token copied to clipboard!',
        confirmRevokeDevice: 'Are you sure you want to revoke this device token? The client will immediately be disconnected.',
        confirmRotateToken: 'Warning: Rotating the token will immediately invalidate the current credential. Client connections will be severed until reconfigured. Continue?',
        confirmDeleteVault: 'Warning: Are you sure you want to permanently delete this vault and all stored ciphertext blobs? This action cannot be undone.',
        confirmDeleteUser: 'Are you sure you want to permanently delete user "{username}" and all associated vaults and data?',
        rememberMe: 'Remember me (stay signed in for 30 days)',
        sessionExpired: 'Session expired, please sign in again.',
        copyFailed: 'Copy failed — please select the text manually.',
        tokenRevoked: 'Revoked',
        tokenExpired: 'Expired',
        gcBtn: 'Clean',
        gcBtnTitle: 'Reclaim ciphertext blobs no longer referenced by this vault',
        gcConfirm: 'Scan vault "{vault}" and delete ciphertext blobs that are no longer referenced by any file? Orphans younger than 7 days are kept to protect in-flight syncs.',
        gcDone: 'Scanned {scanned} blobs: deleted {deleted}, kept {kept}.',
        deletionJobBanner: 'Blob cleanup for vault "{vault}" is unfinished (job {jobId}). Metadata is already deleted — retry to finish cleanup.',
        retryBtn: 'Retry',
        dismissBtn: 'Dismiss',
        deletionRetryDone: 'Blob cleanup job completed.',
        deletionRetryPending: 'Cleanup is still in progress, please retry later.'
      }
    };

    function dashboardApp() {
      return {
        lang: localStorage.getItem('obsidian_sync_lang') || 'zh',
        isCheckingAuth: true,
        isLoggedIn: false,
        currentUser: null,
        needsSetup: false,

        currentTab: 'vaults',
        authLoading: false,
        authError: '',
        rememberMe: false,
        authForm: {
          username: '',
          password: ''
        },
        // Session token lives in sessionStorage by default; only persisted to
        // localStorage when the user opts in via "remember me".
        token: sessionStorage.getItem('obsidian_sync_session_token') || localStorage.getItem('obsidian_sync_token') || '',

        myVaults: [],
        myTotalStorage: 0,
        totalDevicesCount: 0,
        vaultHeatmaps: {},
        failedDeletionJobs: [],

        adminStats: null,
        adminUsers: [],

        showCreateVaultModal: false,
        newVaultName: '',

        showAddDeviceModal: false,
        targetVault: null,
        newDeviceName: '',
        generatedToken: '',

        showRenameModal: false,
        editingToken: null,
        editingDeviceName: '',

        showRotatedTokenModal: false,
        rotatedToken: '',
        rotatedDeviceName: '',

        showCreateUserModal: false,
        newUserData: {
          username: '',
          password: '',
          role: 'user'
        },

        t(key, params = {}) {
          const dict = I18N[this.lang] || I18N['zh'];
          let str = dict[key] || I18N['zh'][key] || key;
          for (const [k, v] of Object.entries(params)) {
            str = str.replace(new RegExp('\\\\{' + k + '\\\\}', 'g'), () => v);
          }
          return str;
        },

        toggleLang() {
          this.lang = this.lang === 'zh' ? 'en' : 'zh';
          localStorage.setItem('obsidian_sync_lang', this.lang);
        },

        async init() {
          try {
            await this.checkSetupStatus();
            if (this.token) {
              await this.checkAuth();
            } else {
              this.isCheckingAuth = false;
            }
          } catch {
            this.isCheckingAuth = false;
          }
        },

        async checkSetupStatus() {
          try {
            const res = await fetch('/api/v1/auth/setup-status');
            if (res.ok) {
              const data = await res.json();
              this.needsSetup = !!data.needsSetup;
            }
          } catch {}
        },

        async checkAuth() {
          try {
            const res = await fetch('/api/v1/auth/me', {
              headers: { 'Authorization': 'Bearer ' + this.token }
            });
            if (res.ok) {
              const data = await res.json();
              this.currentUser = data.user;
              this.isLoggedIn = true;
              this.isCheckingAuth = false;
              await this.loadData();
            } else {
              this.logout();
              this.isCheckingAuth = false;
            }
          } catch {
            this.logout();
            this.isCheckingAuth = false;
          }
        },

        async handleAuth() {
          this.authLoading = true;
          this.authError = '';
          const endpoint = this.needsSetup ? '/api/v1/auth/register' : '/api/v1/auth/login';

          try {
            const res = await fetch(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                username: this.authForm.username,
                password: this.authForm.password
              })
            });

            const data = await res.json();
            if (!res.ok) {
              throw new Error(data.error || '请求失败');
            }

            this.token = data.token;
            if (this.rememberMe) {
              localStorage.setItem('obsidian_sync_token', data.token);
            } else {
              sessionStorage.setItem('obsidian_sync_session_token', data.token);
              localStorage.removeItem('obsidian_sync_token');
            }
            this.currentUser = data.user;
            this.isLoggedIn = true;
            this.needsSetup = false;
            this.authForm.password = '';
            await this.loadData();
          } catch (err) {
            this.authError = err.message;
          } finally {
            this.authLoading = false;
          }
        },

        logout() {
          sessionStorage.removeItem('obsidian_sync_session_token');
          localStorage.removeItem('obsidian_sync_token');
          this.token = '';
          this.currentUser = null;
          this.isLoggedIn = false;
        },

        // Authenticated fetch: any 401 (expired/revoked token) drops the stale
        // session immediately instead of leaving a blank "logged-in" console.
        async api(path, options = {}) {
          const headers = Object.assign({}, options.headers || {}, { 'Authorization': 'Bearer ' + this.token });
          const res = await fetch(path, Object.assign({}, options, { headers }));
          if (res.status === 401) {
            this.logout();
            throw new Error(this.t('sessionExpired'));
          }
          return res;
        },

        async loadData() {
          if (!this.token) return;

          try {
            const res = await this.api('/api/v1/user/vaults');
            if (res.ok) {
              const data = await res.json();
              this.myVaults = data.vaults || [];
              this.myTotalStorage = this.myVaults.reduce((sum, v) => sum + (v.totalSize || 0), 0);
              const now = Date.now();
              const isActive = (token) => !token.revokedAt && (!token.expiresAt || token.expiresAt > now);
              this.totalDevicesCount = this.myVaults.reduce(
                (sum, v) => sum + ((v.tokens || []).filter(isActive).length),
                0
              );

              for (const v of this.myVaults) {
                this.loadVaultHeatmap(v.id);
              }
            }
          } catch {}

          if (this.currentUser?.role === 'admin' && this.isLoggedIn) {
            await this.loadAdminStats();
            await this.loadAdminUsers();
          }
        },

        async loadVaultHeatmap(vaultId) {
          try {
            const res = await this.api('/api/v1/user/vaults/' + vaultId + '/activity');
            if (res.ok) {
              const data = await res.json();
              this.vaultHeatmaps[vaultId] = this.buildHeatmapGrid(data.activity || []);
            }
          } catch {}
        },

        buildHeatmapGrid(activityList) {
          const activityMap = {};
          let totalCount = 0;
          for (const item of activityList) {
            activityMap[item.day] = item.count;
            totalCount += item.count;
          }

          // Server activity keys are UTC dates; walk the grid in UTC too so the
          // keys line up and "today" is the last cell regardless of timezone.
          const now = new Date();
          const oneDayMs = 24 * 60 * 60 * 1000;
          const endTs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
          const dayOfWeek = new Date(endTs).getUTCDay();
          const startTs = endTs - (52 * 7 + dayOfWeek) * oneDayMs;

          const weeks = [];
          let currentWeek = [];
          let prevMonth = -1;

          for (let ts = startTs; ts <= endTs; ts += oneDayMs) {
            const d = new Date(ts);
            const y = d.getUTCFullYear();
            const m = String(d.getUTCMonth() + 1).padStart(2, '0');
            const dayNum = String(d.getUTCDate()).padStart(2, '0');
            const dayStr = \`\${y}-\${m}-\${dayNum}\`;
            const count = activityMap[dayStr] || 0;

            let level = 0;
            if (count > 0) {
              if (count <= 2) level = 1;
              else if (count <= 6) level = 2;
              else if (count <= 15) level = 3;
              else level = 4;
            }

            let monthLabel = '';
            const curMonth = d.getUTCMonth();
            if (curMonth !== prevMonth && currentWeek.length === 0) {
              const monthNamesZh = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
              const monthNamesEn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
              const monthNames = this.lang === 'zh' ? monthNamesZh : monthNamesEn;
              monthLabel = monthNames[curMonth];
              prevMonth = curMonth;
            }

            currentWeek.push({
              date: dayStr,
              count,
              level,
              monthLabel
            });

            if (currentWeek.length === 7) {
              weeks.push(currentWeek);
              currentWeek = [];
            }
          }

          if (currentWeek.length > 0) {
            weeks.push(currentWeek);
          }

          return { weeks, totalCount };
        },

        getHeatmapCellClass(level) {
          switch (level) {
            case 1: return 'bg-[#bae6fd]';
            case 2: return 'bg-[#60a5fa]';
            case 3: return 'bg-[#0070f3]';
            case 4: return 'bg-black';
            default: return 'bg-[#ebebeb] border border-[#dddddd]/40';
          }
        },

        async createVault() {
          if (!this.newVaultName) return;
          try {
            const res = await this.api('/api/v1/user/vaults', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: this.newVaultName })
            });

            if (res.ok) {
              this.showCreateVaultModal = false;
              this.newVaultName = '';
              await this.loadData();
            } else {
              const data = await res.json();
              alert(data.error || 'Unknown error');
            }
          } catch (err) {
            alert(err.message);
          }
        },

        openAddDeviceModal(vault) {
          this.targetVault = vault;
          this.newDeviceName = '';
          this.generatedToken = '';
          this.showAddDeviceModal = true;
        },

        closeAddDeviceModal() {
          this.showAddDeviceModal = false;
          this.targetVault = null;
          this.newDeviceName = '';
          this.generatedToken = '';
          this.loadData();
        },

        async generateDeviceToken() {
          if (!this.targetVault || !this.newDeviceName) return;
          try {
            const res = await this.api('/api/v1/user/vaults/' + this.targetVault.id + '/tokens', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ deviceName: this.newDeviceName })
            });

            if (res.ok) {
              const data = await res.json();
              this.generatedToken = data.token;
            } else {
              const data = await res.json();
              alert(data.error || 'Unknown error');
            }
          } catch (err) {
            alert(err.message);
          }
        },

        openRenameModal(tokenObj) {
          this.editingToken = tokenObj;
          this.editingDeviceName = tokenObj.deviceName;
          this.showRenameModal = true;
        },

        async saveDeviceRename() {
          if (!this.editingToken || !this.editingDeviceName.trim()) return;
          try {
            const res = await this.api('/api/v1/user/tokens/' + this.editingToken.tokenId, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ deviceName: this.editingDeviceName.trim() })
            });

            if (res.ok) {
              this.showRenameModal = false;
              this.editingToken = null;
              await this.loadData();
            } else {
              const data = await res.json();
              alert(data.error || 'Unknown error');
            }
          } catch (err) {
            alert(err.message);
          }
        },

        async rotateToken(tokenObj) {
          if (!confirm(this.t('confirmRotateToken'))) {
            return;
          }
          try {
            const res = await this.api('/api/v1/user/tokens/' + tokenObj.tokenId + '/rotate', {
              method: 'POST'
            });

            if (res.ok) {
              const data = await res.json();
              this.rotatedToken = data.token;
              this.rotatedDeviceName = data.deviceName;
              this.showRotatedTokenModal = true;
              await this.loadData();
            } else {
              const data = await res.json();
              alert(data.error || 'Unknown error');
            }
          } catch (err) {
            alert(err.message);
          }
        },

        async revokeToken(tokenToRevoke) {
          if (!confirm(this.t('confirmRevokeDevice'))) return;
          try {
            const res = await this.api('/api/v1/user/tokens/' + tokenToRevoke, { method: 'DELETE' });
            if (!res.ok) {
              const data = await res.json();
              alert(data.error || 'Unknown error');
              return;
            }
            await this.loadData();
          } catch (err) {
            alert(err.message);
          }
        },

        async gcVault(vault) {
          if (!confirm(this.t('gcConfirm', { vault: vault.name }))) return;
          try {
            const res = await this.api('/api/v1/user/vaults/' + vault.id + '/gc', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ graceDays: 7 })
            });
            if (res.ok) {
              const data = await res.json();
              alert(this.t('gcDone', { scanned: data.scanned, deleted: data.deleted, kept: data.kept }));
              await this.loadData();
            } else {
              const data = await res.json();
              alert(data.error || 'Unknown error');
            }
          } catch (err) {
            alert(err.message);
          }
        },

        async deleteVault(vaultId) {
          const vault = this.myVaults.find((v) => v.id === vaultId);
          if (!confirm(this.t('confirmDeleteVault'))) return;
          try {
            const res = await this.api('/api/v1/user/vaults/' + vaultId, { method: 'DELETE' });
            if (res.ok && res.status !== 202) {
              await this.loadData();
            } else if (res.status === 202) {
              // Metadata is gone but blob cleanup failed; surface the retryable job.
              const data = await res.json();
              this.failedDeletionJobs.push({
                jobId: data.jobId,
                vaultName: (vault && vault.name) || vaultId
              });
              alert(this.t('deletionJobBanner', { vault: (vault && vault.name) || vaultId, jobId: String(data.jobId).slice(0, 8) }));
              await this.loadData();
            } else {
              const data = await res.json();
              alert(data.error || 'Unknown error');
            }
          } catch (err) {
            alert(err.message);
          }
        },

        async retryDeletionJob(job) {
          try {
            const res = await this.api('/api/v1/user/deletion-jobs/' + job.jobId + '/retry', { method: 'POST' });
            if (res.ok) {
              const data = await res.json();
              if (data.job && data.job.status === 'completed') {
                this.failedDeletionJobs = this.failedDeletionJobs.filter((j) => j.jobId !== job.jobId);
                alert(this.t('deletionRetryDone'));
              } else {
                alert(this.t('deletionRetryPending'));
              }
            } else {
              const data = await res.json();
              alert(data.error || 'Unknown error');
            }
          } catch (err) {
            alert(err.message);
          }
        },

        dismissDeletionJob(jobId) {
          this.failedDeletionJobs = this.failedDeletionJobs.filter((j) => j.jobId !== jobId);
        },

        async loadAdminStats() {
          try {
            const res = await this.api('/api/v1/admin/stats');
            if (res.ok) {
              const data = await res.json();
              this.adminStats = data.stats;
            }
          } catch {}
        },

        async loadAdminUsers() {
          try {
            const res = await this.api('/api/v1/admin/users');
            if (res.ok) {
              const data = await res.json();
              this.adminUsers = data.users || [];
            }
          } catch {}
        },

        generateRandomPassword() {
          const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
          const random = new Uint32Array(14);
          crypto.getRandomValues(random);
          let pwd = '';
          for (let i = 0; i < random.length; i++) {
            pwd += chars.charAt(random[i] % chars.length);
          }
          this.newUserData.password = pwd;
        },

        async adminCreateUser() {
          if (!this.newUserData.username || !this.newUserData.password) return;
          try {
            const res = await this.api('/api/v1/admin/users', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(this.newUserData)
            });

            if (res.ok) {
              this.showCreateUserModal = false;
              this.newUserData = { username: '', password: '', role: 'user' };
              await this.loadAdminUsers();
              await this.loadAdminStats();
            } else {
              const data = await res.json();
              alert(data.error || 'Unknown error');
            }
          } catch (err) {
            alert(err.message);
          }
        },

        async resetUserPassword(userId, username) {
          const next = prompt(this.t('resetPasswordPrompt', { username }));
          if (!next) return;
          try {
            const res = await this.api('/api/v1/admin/users/' + userId + '/password', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ password: next })
            });
            if (!res.ok) {
              const data = await res.json();
              alert(data.error || 'Unknown error');
              return;
            }
            alert(this.t('resetPasswordDone', { username }));
          } catch (err) {
            alert(err.message);
          }
        },

        async deleteUser(userId, username) {
          if (!confirm(this.t('confirmDeleteUser', { username }))) return;
          try {
            const res = await this.api('/api/v1/admin/users/' + userId, { method: 'DELETE' });
            if (!res.ok) {
              const data = await res.json();
              alert(data.error || 'Unknown error');
              return;
            }
            const data = await res.json();
            for (const job of data.jobs || []) {
              if (job.status !== 'completed') {
                this.failedDeletionJobs.push({ jobId: job.jobId, vaultName: job.vaultId });
              }
            }
            await this.loadData();
          } catch (err) {
            alert(err.message);
          }
        },

        async copy(text) {
          try {
            await navigator.clipboard.writeText(text);
            alert(this.t('alertCopied'));
          } catch {
            // clipboard API unavailable (e.g. plain http) — legacy fallback
            try {
              const ta = document.createElement('textarea');
              ta.value = text;
              ta.style.position = 'fixed';
              ta.style.opacity = '0';
              document.body.appendChild(ta);
              ta.select();
              document.execCommand('copy');
              ta.remove();
              alert(this.t('alertCopied'));
            } catch {
              alert(this.t('copyFailed'));
            }
          }
        },

        formatBytes(bytes) {
          if (!bytes || bytes === 0) return '0 B';
          const k = 1024;
          const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
          const i = Math.floor(Math.log(bytes) / Math.log(k));
          return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        }
      }
    }`;

export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="zh-CN" class="h-full bg-white text-[#111111]">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Onyx Sync Console</title>
  <style>
    [x-cloak] { display: none !important; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      letter-spacing: -0.01em;
    }
  </style>
  <!-- Self-hosted vendor scripts (no external CDN dependency) -->
  <script src="/assets/tailwind.js"></script>
  <script defer src="/assets/app.js"></script>
  <script defer src="/assets/alpine.min.js"></script>
</head>
<body class="h-full antialiased bg-[#fafafa] text-[#111111] selection:bg-black selection:text-white" x-data="dashboardApp()" x-init="init()">

  <!-- 0. 认证校验中 Loading 画面 (Vercel Geist Style) -->
  <div x-show="isCheckingAuth" class="min-h-full flex flex-col items-center justify-center py-12 px-4 bg-[#fafafa] space-y-4">
    <div class="flex items-center justify-center">
      <svg class="w-8 h-7 fill-current text-black animate-pulse" viewBox="0 0 76 65">
        <path d="M37.5274 0L75.0548 65H0L37.5274 0Z" />
      </svg>
    </div>
    <div class="text-xs text-[#888888] flex items-center space-x-2 font-mono">
      <svg class="animate-spin h-3.5 w-3.5 text-black" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
      </svg>
      <span x-text="t('checkingAuth')"></span>
    </div>
  </div>

  <!-- 1. 登录 / 系统首次初始化 浮层 (Vercel Auth Style) -->
  <div x-cloak x-show="!isCheckingAuth && !isLoggedIn" class="min-h-full flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 bg-[#fafafa]">
    <div class="max-w-sm w-full space-y-6 bg-white p-8 rounded-xl shadow-xl border border-[#eaeaea]">
      <div class="text-center">
        <!-- Vercel Triangle -->
        <svg class="w-8 h-7 mx-auto fill-current text-black mb-3" viewBox="0 0 76 65">
          <path d="M37.5274 0L75.0548 65H0L37.5274 0Z" />
        </svg>
        <h2 class="text-lg font-semibold text-black tracking-tight" x-text="needsSetup ? t('setupTitle') : t('loginTitle')"></h2>
        <p class="text-xs text-[#666666] mt-1" x-text="needsSetup ? t('setupBanner') : t('loginSub')"></p>
      </div>

      <div class="flex justify-end">
        <!-- 语言切换 -->
        <button @click="toggleLang()" class="text-[11px] text-[#666666] hover:text-black px-2 py-1 rounded border border-[#eaeaea] bg-white hover:bg-[#fafafa] flex items-center space-x-1 transition-colors">
          <svg class="w-3 h-3 stroke-current" viewBox="0 0 24 24" fill="none" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          <span x-text="t('langToggle')"></span>
        </button>
      </div>

      <form class="space-y-4" @submit.prevent="handleAuth()">
        <div>
          <label class="block text-xs font-medium text-[#444444] mb-1" x-text="t('usernameLabel')"></label>
          <input type="text" x-model="authForm.username" required :placeholder="t('usernamePlaceholder')" class="w-full rounded-md bg-white border border-[#eaeaea] hover:border-[#999999] px-3 py-2 text-xs text-black placeholder-[#aaaaaa] focus:border-black focus:outline-none transition-colors">
        </div>

        <div>
          <label class="block text-xs font-medium text-[#444444] mb-1" x-text="t('passwordLabel')"></label>
          <input type="password" x-model="authForm.password" required :placeholder="t('passwordPlaceholder')" class="w-full rounded-md bg-white border border-[#eaeaea] hover:border-[#999999] px-3 py-2 text-xs text-black placeholder-[#aaaaaa] focus:border-black focus:outline-none transition-colors">
        </div>

        <label class="flex items-center space-x-2 cursor-pointer select-none">
          <input type="checkbox" x-model="rememberMe" class="rounded border-[#cccccc] text-black focus:ring-black w-3.5 h-3.5">
          <span class="text-[11px] text-[#666666]" x-text="t('rememberMe')"></span>
        </label>

        <div x-show="authError" class="text-[#ee0000] text-xs font-medium" x-text="authError"></div>

        <button type="submit" :disabled="authLoading" class="w-full flex justify-center py-2 px-4 rounded-md bg-black hover:bg-[#222222] text-white font-medium text-xs shadow-xs transition-colors focus:outline-none disabled:opacity-50">
          <span x-show="!authLoading" x-text="needsSetup ? t('initAdminBtn') : t('signInBtn')"></span>
          <span x-show="authLoading" x-text="t('processing')"></span>
        </button>

        <div x-show="!needsSetup" class="text-center text-[11px] text-[#888888] pt-1" x-text="t('authFootnote')"></div>
      </form>
    </div>
  </div>

  <!-- 2. 主控制台 (Vercel Dashboard Style) -->
  <div x-cloak x-show="!isCheckingAuth && isLoggedIn" class="min-h-full flex flex-col">
    <!-- 顶部导航 (Vercel Style Navbar) -->
    <header class="bg-white border-b border-[#eaeaea] sticky top-0 z-40">
      <div class="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        <div class="flex items-center space-x-3">
          <!-- Vercel Triangle Logo -->
          <div class="flex items-center space-x-2.5 text-black">
            <svg class="w-5 h-4 fill-current" viewBox="0 0 76 65">
              <path d="M37.5274 0L75.0548 65H0L37.5274 0Z" />
            </svg>
            <span class="text-[#eaeaea] text-sm font-light">/</span>
            <span class="font-semibold text-sm text-black tracking-tight" x-text="t('brandTitle')"></span>
            <span class="text-[10px] font-mono px-2 py-0.5 rounded-full border border-[#eaeaea] bg-[#fafafa] text-[#666666]" x-text="t('brandBadge')"></span>
          </div>
        </div>

        <div class="flex items-center space-x-3">
          <!-- 语言切换 -->
          <button @click="toggleLang()" class="text-xs text-[#666666] hover:text-black px-2.5 py-1 rounded-md border border-[#eaeaea] bg-white hover:bg-[#fafafa] flex items-center space-x-1.5 transition-colors font-medium">
            <svg class="w-3.5 h-3.5 stroke-current" viewBox="0 0 24 24" fill="none" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            <span x-text="t('langToggle')"></span>
          </button>

          <div class="h-4 w-px bg-[#eaeaea]"></div>

          <div class="text-right">
            <span class="text-xs font-semibold text-black block leading-tight" x-text="currentUser?.username"></span>
            <span class="text-[10px] text-[#888888] font-mono" x-text="currentUser?.role === 'admin' ? t('roleAdmin') : t('roleUser')"></span>
          </div>

          <button @click="logout()" class="text-xs px-2.5 py-1 rounded-md bg-white hover:bg-[#fafafa] text-[#666666] hover:text-[#ee0000] border border-[#eaeaea] hover:border-[#ffcccc] font-medium transition-colors flex items-center space-x-1">
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            <span x-text="t('logout')"></span>
          </button>
        </div>
      </div>

      <!-- Vercel Nav Tabs Bar -->
      <div class="max-w-6xl mx-auto px-4 sm:px-6 flex space-x-6 text-xs -mb-px">
        <button @click="currentTab = 'vaults'" :class="currentTab === 'vaults' ? 'border-black text-black font-semibold' : 'border-transparent text-[#666666] hover:text-black font-normal'" class="pb-2.5 pt-1 border-b-2 flex items-center space-x-1.5 transition-colors">
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          <span x-text="t('tabVaults')"></span>
        </button>
        <template x-if="currentUser?.role === 'admin'">
          <button @click="currentTab = 'admin'" :class="currentTab === 'admin' ? 'border-black text-black font-semibold' : 'border-transparent text-[#666666] hover:text-black font-normal'" class="pb-2.5 pt-1 border-b-2 flex items-center space-x-1.5 transition-colors">
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            <span x-text="t('tabAdmin')"></span>
          </button>
        </template>
      </div>
    </header>

    <!-- 删除任务异常横幅：vault 密文清理失败时可在此重试 -->
    <div x-cloak x-show="failedDeletionJobs.length > 0" class="bg-[#fffbe6] border-b border-[#ffe58f]">
      <div class="max-w-6xl mx-auto px-4 sm:px-6 py-2.5 space-y-1.5">
        <template x-for="job in failedDeletionJobs" :key="job.jobId">
          <div class="flex items-center justify-between gap-3 text-xs text-[#d48806]">
            <span class="flex items-center space-x-1.5">
              <svg class="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <span x-text="t('deletionJobBanner', { vault: job.vaultName, jobId: job.jobId.slice(0, 8) })"></span>
            </span>
            <span class="flex items-center space-x-2 flex-shrink-0">
              <button @click="retryDeletionJob(job)" class="px-2.5 py-1 rounded bg-white hover:bg-[#fff8e0] text-[#d48806] border border-[#ffe58f] font-medium transition-colors" x-text="t('retryBtn')"></button>
              <button @click="dismissDeletionJob(job.jobId)" class="px-2 py-1 rounded text-[#d48806]/70 hover:text-[#d48806] font-medium transition-colors" x-text="t('dismissBtn')"></button>
            </span>
          </div>
        </template>
      </div>
    </div>

    <!-- 主体区域 -->
    <main class="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">

      <!-- 概览指标卡片 (Vercel Stat Grid) -->
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div class="bg-white border border-[#eaeaea] rounded-lg p-5 shadow-xs hover:border-[#cccccc] transition-colors">
          <div class="text-[#888888] text-[11px] font-medium uppercase tracking-wider font-mono" x-text="t('statVaults')"></div>
          <div class="mt-2 flex items-baseline justify-between">
            <div class="text-2xl font-bold text-black tracking-tight" x-text="myVaults.length"></div>
            <div class="text-xs font-mono text-[#888888]">Vaults</div>
          </div>
        </div>

        <div class="bg-white border border-[#eaeaea] rounded-lg p-5 shadow-xs hover:border-[#cccccc] transition-colors">
          <div class="text-[#888888] text-[11px] font-medium uppercase tracking-wider font-mono" x-text="t('statDevices')"></div>
          <div class="mt-2 flex items-baseline justify-between">
            <div class="text-2xl font-bold text-black tracking-tight" x-text="totalDevicesCount"></div>
            <div class="text-xs font-mono text-[#0070f3]">Active</div>
          </div>
        </div>

        <div class="bg-white border border-[#eaeaea] rounded-lg p-5 shadow-xs hover:border-[#cccccc] transition-colors">
          <div class="text-[#888888] text-[11px] font-medium uppercase tracking-wider font-mono" x-text="t('statStorage')"></div>
          <div class="mt-2 flex items-baseline justify-between">
            <div class="text-2xl font-bold text-black tracking-tight" x-text="formatBytes(myTotalStorage)"></div>
            <div class="text-xs font-mono text-[#888888]">Blobs</div>
          </div>
        </div>

        <template x-if="currentUser?.role === 'admin'">
          <div class="bg-white border border-[#eaeaea] rounded-lg p-5 shadow-xs hover:border-[#cccccc] transition-colors">
            <div class="text-[#888888] text-[11px] font-medium uppercase tracking-wider font-mono" x-text="t('statUsers')"></div>
            <div class="mt-2 flex items-baseline justify-between">
              <div class="text-2xl font-bold text-black tracking-tight" x-text="adminStats?.totalUsers || 0"></div>
              <div class="text-[10px] font-mono bg-[#fafafa] text-black px-1.5 py-0.5 rounded border border-[#eaeaea]" x-text="t('roleAdmin')"></div>
            </div>
          </div>
        </template>
      </div>

      <!-- 视图 1: 知识库与设备授权卡片 (Vercel Project Cards) -->
      <div x-show="currentTab === 'vaults'" class="space-y-5">
        <div class="flex justify-between items-center">
          <div>
            <h3 class="text-sm font-semibold text-black tracking-tight" x-text="t('vaultsTitle')"></h3>
            <p class="text-xs text-[#666666]" x-text="t('vaultsDesc')"></p>
          </div>
          <button @click="showCreateVaultModal = true" class="px-3.5 py-1.5 rounded-md bg-black hover:bg-[#222222] text-white font-medium text-xs shadow-xs transition-colors flex items-center space-x-1.5">
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            <span x-text="t('newVaultBtn')"></span>
          </button>
        </div>

        <!-- 知识库卡片列表 -->
        <div class="space-y-5">
          <template x-for="v in myVaults" :key="v.id">
            <div class="bg-white border border-[#eaeaea] rounded-lg p-6 shadow-xs space-y-5 hover:border-[#cccccc] transition-colors">
              <!-- 仓库卡片顶部 -->
              <div class="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-[#eaeaea] gap-3">
                <div class="space-y-1.5">
                  <div class="flex items-center space-x-2.5">
                    <h4 class="text-base font-semibold text-black tracking-tight" x-text="v.name"></h4>
                    <span class="text-[10px] font-mono text-[#666666] bg-[#fafafa] px-2 py-0.5 rounded border border-[#eaeaea]" x-text="'ID: ' + v.id"></span>
                    <span class="inline-flex items-center space-x-1 text-[11px] font-mono text-[#0070f3] bg-[#f0f7ff] border border-[#d0e5ff] px-2 py-0.5 rounded-full">
                      <span class="w-1.5 h-1.5 rounded-full bg-[#0070f3]"></span>
                      <span x-text="'v' + v.latestVersion"></span>
                    </span>
                  </div>
                  <div class="text-xs text-[#888888] flex items-center space-x-4 font-mono">
                    <span><span x-text="t('fileCount')"></span>: <strong class="text-black" x-text="v.fileCount"></strong></span>
                    <span><span x-text="t('cipherStorage')"></span>: <strong class="text-black" x-text="formatBytes(v.totalSize)"></strong></span>
                    <span><span x-text="t('createdAt')"></span>: <span x-text="new Date(v.createdAt).toLocaleDateString()"></span></span>
                  </div>
                </div>

                <div class="flex items-center space-x-2">
                  <button @click="openAddDeviceModal(v)" class="text-xs px-3 py-1.5 rounded-md bg-white hover:bg-[#fafafa] text-black border border-[#eaeaea] font-medium transition-colors flex items-center space-x-1.5 shadow-xs">
                    <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="2" y1="20" x2="22" y2="20"/></svg>
                    <span x-text="t('authorizeDevice')"></span>
                  </button>
                  <button @click="gcVault(v)" :title="t('gcBtnTitle')" class="text-xs px-2.5 py-1.5 rounded-md bg-white hover:bg-[#fafafa] text-[#666666] hover:text-black border border-[#eaeaea] font-medium transition-colors flex items-center space-x-1">
                    <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
                    <span x-text="t('gcBtn')"></span>
                  </button>
                  <button @click="deleteVault(v.id)" class="text-xs px-2.5 py-1.5 rounded-md bg-white hover:bg-[#fff0f0] text-[#888888] hover:text-[#ee0000] border border-[#eaeaea] hover:border-[#ffcccc] font-medium transition-colors flex items-center space-x-1">
                    <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    <span x-text="t('deleteVault')"></span>
                  </button>
                </div>
              </div>

              <!-- Vercel 风格 365 天同步活跃度图谱 (Vercel Signature Blue Palette) -->
              <div class="p-4 bg-[#fafafa] rounded-md border border-[#eaeaea] space-y-2.5">
                <div class="flex items-center justify-between">
                  <div class="flex items-center space-x-2">
                    <svg class="w-3.5 h-3.5 text-[#666666]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                    <span class="text-xs font-semibold text-black" x-text="t('heatmapTitle')"></span>
                    <span class="text-[11px] text-[#666666] bg-white border border-[#eaeaea] px-2 py-0.5 rounded-full font-mono" x-text="t('heatmapCommits', { count: vaultHeatmaps[v.id]?.totalCount || 0 })"></span>
                  </div>
                  <div class="flex items-center space-x-1 text-[10px] text-[#888888] font-mono">
                    <span x-text="t('heatmapLess')"></span>
                    <span class="w-[10px] h-[10px] rounded-[2px] bg-[#ebebeb] border border-[#dddddd] inline-block"></span>
                    <span class="w-[10px] h-[10px] rounded-[2px] bg-[#bae6fd] inline-block"></span>
                    <span class="w-[10px] h-[10px] rounded-[2px] bg-[#60a5fa] inline-block"></span>
                    <span class="w-[10px] h-[10px] rounded-[2px] bg-[#0070f3] inline-block"></span>
                    <span class="w-[10px] h-[10px] rounded-[2px] bg-black inline-block"></span>
                    <span x-text="t('heatmapMore')"></span>
                  </div>
                </div>

                <div class="overflow-x-auto pb-1">
                  <div class="inline-flex flex-col select-none min-w-[700px]">
                    <!-- 月份标注行 -->
                    <div class="flex text-[10px] text-[#888888] mb-1 h-3.5 pl-6 font-mono">
                      <template x-for="(col, cIdx) in (vaultHeatmaps[v.id]?.weeks || [])" :key="cIdx">
                        <div class="w-3 text-left overflow-visible whitespace-nowrap text-[9px]" x-text="col[0]?.monthLabel || ''"></div>
                      </template>
                    </div>

                    <!-- 热力图主体: 7天行与52周列 -->
                    <div class="flex items-start">
                      <!-- 星期标注 -->
                      <div class="flex flex-col gap-[3px] text-[9px] text-[#888888] pr-2 pt-[1px] select-none font-mono">
                        <span class="h-2.5 leading-[10px]"></span>
                        <span class="h-2.5 leading-[10px]" x-text="t('daysMon')"></span>
                        <span class="h-2.5 leading-[10px]"></span>
                        <span class="h-2.5 leading-[10px]" x-text="t('daysWed')"></span>
                        <span class="h-2.5 leading-[10px]"></span>
                        <span class="h-2.5 leading-[10px]" x-text="t('daysFri')"></span>
                        <span class="h-2.5 leading-[10px]"></span>
                      </div>

                      <!-- 52 周的方块列 -->
                      <div class="flex gap-[3px]">
                        <template x-for="(week, wIdx) in (vaultHeatmaps[v.id]?.weeks || [])" :key="wIdx">
                          <div class="flex flex-col gap-[3px]">
                            <template x-for="day in week" :key="day.date">
                              <div
                                class="w-2.5 h-2.5 rounded-[2px] transition-transform hover:scale-125 cursor-pointer"
                                :class="getHeatmapCellClass(day.level)"
                                :title="day.date + (day.count > 0 ? ': ' + day.count + ' ' + t('activityCount', { count: day.count }) : ': ' + t('noActivity'))"
                              ></div>
                            </template>
                          </div>
                        </template>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 该仓库绑定的设备列表 -->
              <div class="space-y-2.5">
                <div class="text-xs font-semibold text-[#888888] uppercase tracking-wider font-mono text-[11px]" x-text="t('devicesHeader')"></div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <template x-for="tInfo in (v.tokens || [])" :key="tInfo.tokenId">
                    <div class="bg-[#fafafa] border border-[#eaeaea] rounded-lg p-3.5 flex flex-col justify-between space-y-3 hover:border-[#cccccc] transition-colors">
                      <div class="flex items-start justify-between">
                        <div class="space-y-0.5">
                          <div class="flex items-center space-x-1.5">
                            <svg class="w-3.5 h-3.5 text-[#666666]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="2" y1="20" x2="22" y2="20"/></svg>
                            <span class="font-semibold text-xs text-black" x-text="tInfo.deviceName"></span>
                            <span x-show="tInfo.revokedAt" class="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-[#fff0f0] text-[#ee0000] border border-[#ffcccc]" x-text="t('tokenRevoked')"></span>
                            <span x-show="!tInfo.revokedAt && tInfo.expiresAt && tInfo.expiresAt <= Date.now()" class="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-[#fffbe6] text-[#d48806] border border-[#ffe58f]" x-text="t('tokenExpired')"></span>
                            <button x-show="!tInfo.revokedAt" @click="openRenameModal(tInfo)" class="text-[#888888] hover:text-black p-0.5 rounded transition-colors" :title="t('modalRenameTitle')">
                              <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            </button>
                          </div>
                          <div class="text-[11px] text-[#888888] font-mono">
                            <span x-text="t('lastSynced')"></span> <span x-text="new Date(tInfo.lastUsedAt).toLocaleString()"></span>
                          </div>
                        </div>

                        <button x-show="!tInfo.revokedAt" @click="revokeToken(tInfo.tokenId)" class="text-[11px] px-2 py-0.5 rounded bg-white hover:bg-[#fff0f0] text-[#888888] hover:text-[#ee0000] border border-[#eaeaea] hover:border-[#ffcccc] transition-colors font-medium">
                          <span x-text="t('revokeDevice')"></span>
                        </button>
                      </div>

                      <div class="bg-white border border-[#eaeaea] rounded px-2.5 py-1.5 flex items-center justify-between">
                        <div class="font-mono text-[11px] text-[#666666] truncate pr-2" :title="tInfo.tokenId">
                          <span x-text="'🔑 ' + tInfo.tokenId.slice(0, 8) + '••••'"></span>
                        </div>
                        <div class="flex items-center space-x-1.5 flex-shrink-0">
                          <button x-show="!tInfo.revokedAt" @click="rotateToken(tInfo)" class="text-[11px] px-2 py-0.5 rounded bg-white hover:bg-[#f0f7ff] text-[#0070f3] border border-[#eaeaea] hover:border-[#0070f3]/40 font-medium transition-colors flex items-center space-x-1">
                            <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                            <span x-text="t('rotateToken')"></span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </template>

                  <div x-show="!v.tokens || v.tokens.length === 0" class="col-span-2 py-6 text-center text-xs text-[#888888] bg-[#fafafa] rounded-lg border border-dashed border-[#eaeaea]" x-text="t('noDevices')">
                  </div>
                </div>
              </div>
            </div>
          </template>

          <div x-show="myVaults.length === 0" class="py-16 text-center bg-white rounded-lg border border-dashed border-[#eaeaea] space-y-3">
            <div class="w-10 h-10 mx-auto rounded-full bg-[#fafafa] border border-[#eaeaea] flex items-center justify-center text-[#888888]">
              <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            </div>
            <div class="text-black font-semibold text-sm" x-text="t('emptyVaultsTitle')"></div>
            <p class="text-xs text-[#666666] max-w-sm mx-auto" x-text="t('emptyVaultsDesc')"></p>
            <button @click="showCreateVaultModal = true" class="mt-1 px-3.5 py-1.5 rounded-md bg-black hover:bg-[#222222] text-white font-medium text-xs shadow-xs transition-colors">
              <span x-text="t('emptyVaultsBtn')"></span>
            </button>
          </div>
        </div>
      </div>

      <!-- 视图 2: 系统管理控制台 (管理员) -->
      <template x-if="currentUser?.role === 'admin'">
        <div x-show="currentTab === 'admin'" class="space-y-5">
          <div class="bg-white border border-[#eaeaea] rounded-lg p-5 shadow-xs space-y-3">
            <h3 class="text-sm font-semibold text-black flex items-center space-x-2 tracking-tight">
              <svg class="w-4 h-4 text-[#666666]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              <span x-text="t('adminOverview')"></span>
            </h3>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div class="bg-[#fafafa] p-3 rounded-md border border-[#eaeaea]">
                <div class="text-[11px] text-[#888888] font-mono" x-text="t('totalUsers')"></div>
                <div class="text-xl font-bold text-black mt-1" x-text="adminStats?.totalUsers || 0"></div>
              </div>
              <div class="bg-[#fafafa] p-3 rounded-md border border-[#eaeaea]">
                <div class="text-[11px] text-[#888888] font-mono" x-text="t('totalVaults')"></div>
                <div class="text-xl font-bold text-black mt-1" x-text="adminStats?.totalVaults || 0"></div>
              </div>
              <div class="bg-[#fafafa] p-3 rounded-md border border-[#eaeaea]">
                <div class="text-[11px] text-[#888888] font-mono" x-text="t('totalFiles')"></div>
                <div class="text-xl font-bold text-black mt-1" x-text="adminStats?.totalFiles || 0"></div>
              </div>
              <div class="bg-[#fafafa] p-3 rounded-md border border-[#eaeaea]">
                <div class="text-[11px] text-[#888888] font-mono" x-text="t('totalStorage')"></div>
                <div class="text-xl font-bold text-black mt-1" x-text="formatBytes(adminStats?.totalStorageBytes || 0)"></div>
              </div>
            </div>
          </div>

          <div class="bg-white border border-[#eaeaea] rounded-lg overflow-hidden shadow-xs">
            <div class="px-5 py-3 border-b border-[#eaeaea] flex justify-between items-center bg-[#fafafa]">
              <div>
                <h4 class="font-semibold text-xs text-black" x-text="t('userMgmtTitle')"></h4>
                <p class="text-[11px] text-[#888888]" x-text="t('userMgmtDesc')"></p>
              </div>
              <div class="flex items-center space-x-2">
                <button @click="showCreateUserModal = true" class="text-xs px-3 py-1.5 rounded-md bg-black hover:bg-[#222222] text-white font-medium shadow-xs transition-colors flex items-center space-x-1">
                  <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  <span x-text="t('createUserBtn')"></span>
                </button>
                <button @click="loadAdminUsers()" class="text-xs px-3 py-1.5 rounded-md bg-white hover:bg-[#fafafa] text-black border border-[#eaeaea] font-medium transition-colors">
                  <span x-text="t('refreshUsersBtn')"></span>
                </button>
              </div>
            </div>
            <table class="min-w-full divide-y divide-[#eaeaea] text-left text-xs">
              <thead class="bg-[#fafafa] text-[#888888] uppercase font-semibold text-[10px] font-mono">
                <tr>
                  <th class="px-5 py-3" x-text="t('thUsername')"></th>
                  <th class="px-5 py-3" x-text="t('thRole')"></th>
                  <th class="px-5 py-3" x-text="t('thVaultCount')"></th>
                  <th class="px-5 py-3" x-text="t('thStorageUsed')"></th>
                  <th class="px-5 py-3" x-text="t('thRegisteredAt')"></th>
                  <th class="px-5 py-3 text-right" x-text="t('thActions')"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-[#eaeaea] text-black">
                <template x-for="u in adminUsers" :key="u.id">
                  <tr class="hover:bg-[#fafafa] transition-colors">
                    <td class="px-5 py-3 font-semibold text-black" x-text="u.username"></td>
                    <td class="px-5 py-3">
                      <span :class="u.role === 'admin' ? 'bg-[#f0f7ff] text-[#0070f3] border-[#d0e5ff]' : 'bg-[#fafafa] text-[#666666] border-[#eaeaea]'" class="px-2 py-0.5 rounded-full text-[10px] border font-mono" x-text="u.role === 'admin' ? t('roleAdmin') : t('roleUser')"></span>
                    </td>
                    <td class="px-5 py-3 font-mono text-black" x-text="u.vaultCount"></td>
                    <td class="px-5 py-3 font-mono text-black" x-text="formatBytes(u.totalStorageBytes)"></td>
                    <td class="px-5 py-3 text-[#888888] text-[11px] font-mono" x-text="new Date(u.createdAt).toLocaleString()"></td>
                    <td class="px-5 py-3 text-right">
                      <button @click="resetUserPassword(u.id, u.username)" class="text-[11px] text-[#0070f3] hover:underline font-medium mr-3" x-text="t('resetPasswordBtn')"></button>
                      <button x-show="u.username !== currentUser?.username" @click="deleteUser(u.id, u.username)" class="text-[11px] text-[#ee0000] hover:underline font-medium" x-text="t('deleteUserBtn')"></button>
                      <span x-show="u.username === currentUser?.username" class="text-[11px] text-[#888888] font-mono" x-text="t('currentAccountBadge')"></span>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </div>
      </template>

    </main>

    <!-- 弹窗 1: 新建知识库 Modal (Vercel Modal Style) -->
    <div x-show="showCreateVaultModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-xs" style="display: none;">
      <div class="bg-white border border-[#eaeaea] rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
        <h3 class="text-sm font-semibold text-black tracking-tight" x-text="t('modalNewVaultTitle')"></h3>
        <p class="text-xs text-[#666666]" x-text="t('modalNewVaultDesc')"></p>
        <div>
          <label class="block text-xs font-medium text-[#444444] mb-1" x-text="t('vaultNameInput')"></label>
          <input type="text" x-model="newVaultName" :placeholder="t('vaultNamePlaceholder')" class="w-full rounded-md bg-white border border-[#eaeaea] hover:border-[#999999] px-3 py-2 text-xs text-black focus:border-black focus:outline-none transition-colors">
        </div>
        <div class="flex justify-end space-x-2 pt-2">
          <button @click="showCreateVaultModal = false" class="px-3.5 py-1.5 rounded-md bg-white hover:bg-[#fafafa] text-[#666666] border border-[#eaeaea] text-xs font-medium transition-colors" x-text="t('cancel')"></button>
          <button @click="createVault()" :disabled="!newVaultName" class="px-3.5 py-1.5 rounded-md bg-black hover:bg-[#222222] text-white font-medium text-xs shadow-xs transition-colors disabled:opacity-50" x-text="t('confirmCreate')"></button>
        </div>
      </div>
    </div>

    <!-- 弹窗 2: 绑定新设备 / 生成 Token Modal -->
    <div x-show="showAddDeviceModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-xs" style="display: none;">
      <div class="bg-white border border-[#eaeaea] rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
        <h3 class="text-sm font-semibold text-black flex items-center space-x-2 tracking-tight">
          <svg class="w-4 h-4 text-[#666666]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="2" y1="20" x2="22" y2="20"/></svg>
          <span x-text="t('modalAuthDeviceTitle')"></span>
        </h3>
        <div x-show="!generatedToken">
          <p class="text-xs text-[#666666] mb-3" x-text="t('modalAuthDeviceSub', { vault: targetVault?.name })"></p>
          <label class="block text-xs font-medium text-[#444444] mb-1" x-text="t('deviceNameInput')"></label>
          <input type="text" x-model="newDeviceName" :placeholder="t('deviceNamePlaceholder')" class="w-full rounded-md bg-white border border-[#eaeaea] hover:border-[#999999] px-3 py-2 text-xs text-black focus:border-black focus:outline-none transition-colors">
          <div class="flex justify-end space-x-2 pt-3">
            <button @click="showAddDeviceModal = false" class="px-3.5 py-1.5 rounded-md bg-white hover:bg-[#fafafa] text-[#666666] border border-[#eaeaea] text-xs font-medium transition-colors" x-text="t('cancel')"></button>
            <button @click="generateDeviceToken()" :disabled="!newDeviceName" class="px-3.5 py-1.5 rounded-md bg-black hover:bg-[#222222] text-white font-medium text-xs shadow-xs transition-colors disabled:opacity-50" x-text="t('generateTokenBtn')"></button>
          </div>
        </div>

        <div x-show="generatedToken" class="space-y-3">
          <div class="p-3 bg-[#f0f7ff] border border-[#d0e5ff] rounded-md text-xs text-[#0070f3] font-medium leading-relaxed" x-text="t('authSuccessBanner')"></div>
          <div>
            <label class="block text-xs font-medium text-[#666666] mb-1" x-text="t('deviceTokenInput')"></label>
            <div class="flex items-center space-x-1.5">
              <input type="text" readonly :value="generatedToken" class="w-full rounded-md bg-[#fafafa] border border-[#eaeaea] px-3 py-1.5 font-mono text-xs text-black focus:outline-none select-all">
              <button @click="copy(generatedToken)" class="px-3 py-1.5 rounded-md bg-black hover:bg-[#222222] text-white text-xs font-medium whitespace-nowrap shadow-xs transition-colors" x-text="t('copyToken')"></button>
            </div>
          </div>
          <div class="flex justify-end pt-2">
            <button @click="closeAddDeviceModal()" class="px-3.5 py-1.5 rounded-md bg-white hover:bg-[#fafafa] text-black border border-[#eaeaea] text-xs font-medium transition-colors" x-text="t('done')"></button>
          </div>
        </div>
      </div>
    </div>

    <!-- 弹窗 3: 重命名设备 Modal -->
    <div x-show="showRenameModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-xs" style="display: none;">
      <div class="bg-white border border-[#eaeaea] rounded-xl max-w-sm w-full p-5 space-y-4 shadow-2xl">
        <h3 class="text-sm font-semibold text-black tracking-tight" x-text="t('modalRenameTitle')"></h3>
        <div>
          <label class="block text-xs font-medium text-[#444444] mb-1" x-text="t('newDeviceNameInput')"></label>
          <input type="text" x-model="editingDeviceName" class="w-full rounded-md bg-white border border-[#eaeaea] hover:border-[#999999] px-3 py-2 text-xs text-black focus:border-black focus:outline-none transition-colors">
        </div>
        <div class="flex justify-end space-x-2 pt-2">
          <button @click="showRenameModal = false" class="px-3.5 py-1.5 rounded-md bg-white hover:bg-[#fafafa] text-[#666666] border border-[#eaeaea] text-xs font-medium transition-colors" x-text="t('cancel')"></button>
          <button @click="saveDeviceRename()" :disabled="!editingDeviceName" class="px-3.5 py-1.5 rounded-md bg-black hover:bg-[#222222] text-white font-medium text-xs shadow-xs transition-colors disabled:opacity-50" x-text="t('saveChanges')"></button>
        </div>
      </div>
    </div>

    <!-- 弹窗 4: Token 轮转成功展示 Modal -->
    <div x-show="showRotatedTokenModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-xs" style="display: none;">
      <div class="bg-white border border-[#eaeaea] rounded-xl max-w-md w-full p-6 space-y-3.5 shadow-2xl">
        <h3 class="text-sm font-semibold text-black tracking-tight" x-text="t('modalRotateTitle')"></h3>
        <div class="p-3 bg-[#fffbe6] border border-[#ffe58f] rounded-md text-xs text-[#d48806]" x-text="t('rotateSuccessBanner', { device: rotatedDeviceName })"></div>
        <div>
          <label class="block text-xs font-medium text-[#666666] mb-1" x-text="t('newDeviceTokenInput')"></label>
          <div class="flex items-center space-x-1.5">
            <input type="text" readonly :value="rotatedToken" class="w-full rounded-md bg-[#fafafa] border border-[#eaeaea] px-3 py-1.5 font-mono text-xs text-black focus:outline-none select-all">
            <button @click="copy(rotatedToken)" class="px-3 py-1.5 rounded-md bg-black hover:bg-[#222222] text-white text-xs font-medium whitespace-nowrap shadow-xs transition-colors" x-text="t('copyToken')"></button>
          </div>
        </div>
        <div class="flex justify-end pt-2">
          <button @click="showRotatedTokenModal = false" class="px-3.5 py-1.5 rounded-md bg-white hover:bg-[#fafafa] text-black border border-[#eaeaea] text-xs font-medium transition-colors" x-text="t('acknowledge')"></button>
        </div>
      </div>
    </div>

    <!-- 弹窗 5: 管理员创建新用户 Modal -->
    <div x-show="showCreateUserModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-xs" style="display: none;">
      <div class="bg-white border border-[#eaeaea] rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
        <h3 class="text-sm font-semibold text-black flex items-center space-x-2 tracking-tight">
          <svg class="w-4 h-4 text-[#666666]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
          <span x-text="t('modalCreateUserTitle')"></span>
        </h3>
        <p class="text-xs text-[#666666]" x-text="t('modalCreateUserDesc')"></p>

        <div class="space-y-3">
          <div>
            <label class="block text-xs font-medium text-[#444444] mb-1" x-text="t('newUserUsername')"></label>
            <input type="text" x-model="newUserData.username" :placeholder="t('usernamePlaceholder')" class="w-full rounded-md bg-white border border-[#eaeaea] hover:border-[#999999] px-3 py-2 text-xs text-black focus:border-black focus:outline-none transition-colors">
          </div>

          <div>
            <div class="flex justify-between items-center mb-1">
              <label class="block text-xs font-medium text-[#444444]" x-text="t('newUserPassword')"></label>
              <button type="button" @click="generateRandomPassword()" class="text-[11px] text-[#0070f3] hover:underline" x-text="t('randomPassword')"></button>
            </div>
            <input type="text" x-model="newUserData.password" :placeholder="t('passwordPlaceholder')" class="w-full rounded-md bg-white border border-[#eaeaea] hover:border-[#999999] px-3 py-2 text-xs text-black focus:border-black focus:outline-none transition-colors font-mono">
          </div>

          <div>
            <label class="block text-xs font-medium text-[#444444] mb-1" x-text="t('newUserRole')"></label>
            <select x-model="newUserData.role" class="w-full rounded-md bg-white border border-[#eaeaea] hover:border-[#999999] px-3 py-2 text-xs text-black focus:border-black focus:outline-none transition-colors">
              <option value="user" x-text="t('roleOptionUser')"></option>
              <option value="admin" x-text="t('roleOptionAdmin')"></option>
            </select>
          </div>
        </div>

        <div class="flex justify-end space-x-2 pt-3">
          <button @click="showCreateUserModal = false" class="px-3.5 py-1.5 rounded-md bg-white hover:bg-[#fafafa] text-[#666666] border border-[#eaeaea] text-xs font-medium transition-colors" x-text="t('cancel')"></button>
          <button @click="adminCreateUser()" :disabled="!newUserData.username || !newUserData.password" class="px-3.5 py-1.5 rounded-md bg-black hover:bg-[#222222] text-white font-medium text-xs shadow-xs transition-colors disabled:opacity-50" x-text="t('confirmCreateUser')"></button>
        </div>
      </div>
    </div>

  </div>


</body>
</html>`;
