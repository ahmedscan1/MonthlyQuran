// ===============================
// Main Application Logic
// ===============================

const App = {
  deferredPrompt: null,
  backButtonLastPress: 0,
  initialized: false, // 🔹 حماية من init المكرر

  // Initialize the application
  async init() {
    if (this.initialized) return;
    this.initialized = true;

    Logger.info('App initialization started');

    // 1. Version Handshake (Metadata Cache Invalidation)
    await this.checkVersion();

    // Initialize DOM cache early
    if (typeof UI !== 'undefined' && UI.initDOMCache) {
      UI.initDOMCache();
    }

    // Load config
    const config = await Storage.getConfig();

    // Fetch Quran metadata in background
    if (typeof QuranAPI !== 'undefined' && typeof StorageAdapter !== 'undefined') {
      const cachedMeta = await StorageAdapter.get(QuranAPI.STORAGE_KEY);

      if (!cachedMeta && UI?.showToast) {
        UI.showToast('Downloading Quran data...', 'info');
      }

      QuranAPI.fetchSurahMetadata()
        .then(() => {
          if (!cachedMeta && UI?.showToast) {
            UI.showToast('Quran data downloaded successfully', 'success');
          }
        })
        .catch(err => {
          Logger.error('Error fetching surah metadata:', err);
          if (!cachedMeta && UI?.showToast) {
            UI.showToast('Failed to download Quran data', 'error');
          }
        });
    }

    if (typeof UI === 'undefined') {
      Logger.error('UI is not defined – ui.js must be loaded before app.js');
      return;
    }

    // ===============================
    // App bootstrap
    // ===============================
    if (config) {
      i18n.init(config.language);
      await Theme.init();

      if (typeof HapticsService !== 'undefined') {
        HapticsService.init(config);
      }

      UI.initTabNavigation();

      const savedView = await Storage.getCurrentView() || 'today-view';
      UI.showView(savedView);

      if (savedView === 'today-view') {
        const today = new Date();
        UI.currentDate = today;
        await UI.renderTodayView(today);
      } else if (savedView === 'progress-view') {
        await UI.renderProgressView();
      } else if (savedView === 'calendar-view' && typeof Calendar !== 'undefined') {
        await Calendar.initAsView();
      } else if (savedView === 'settings-view') {
        await UI.renderSettingsView();
      }
    } else {
      await Theme.init();
      i18n.init(DEFAULT_CONFIG.LANGUAGE);
      UI.showView('setup-view');
      await UI.renderSetupView();
    }

    // ===============================
    // Global initializations
    // ===============================
    UI.initEventListeners();
    UI.updateLanguageToggles();
    i18n.translatePage();

    window.UI = UI;
    window.App = this;

    if (typeof Notifications !== 'undefined') {
      Notifications.init();
    }

    this.initInstallPrompt();
    this.initBackButton();
    this.initNotificationListeners();

    Logger.info('App initialization completed');
  },

  // ===============================
  // Version & Cache Control
  // ===============================
  async checkVersion() {
    if (typeof env === 'undefined' || typeof StorageAdapter === 'undefined') return;

    const lastVersion = await StorageAdapter.get('last_app_version');
    const currentVersion = env.version;

    if (lastVersion !== currentVersion) {
      Logger.info(`Version changed: ${lastVersion} → ${currentVersion}`);

      await StorageAdapter.remove('quran_surah_metadata');

      if (typeof QuranAPI !== 'undefined') {
        await StorageAdapter.remove(QuranAPI.STORAGE_KEY);
      }

      await StorageAdapter.set('last_app_version', currentVersion);
    }
  },

  // ===============================
  // PWA Install Prompt
  // ===============================
  initInstallPrompt() {
    window.addEventListener('beforeinstallprompt', async (e) => {
      e.preventDefault();
      this.deferredPrompt = e;

      const shown = await Storage.hasInstallPromptBeenShown();
      if (!shown) {
        setTimeout(() => {
          Dialog?.showInstallPrompt(this.deferredPrompt);
        }, 1000);
      }
    });

    window.addEventListener('appinstalled', async () => {
      this.deferredPrompt = null;
      document.getElementById('install-prompt-banner')?.remove();
      document.getElementById('bottom-nav')?.style.removeProperty('padding-bottom');
      await Storage.markInstallPromptShown();
    });
  },

  // ===============================
  // Hardware Back Button
  // ===============================
  initBackButton() {
    if (!window.Capacitor?.Plugins?.App) return;

    window.Capacitor.Plugins.App.removeAllListeners('backButton').then(() => {
      window.Capacitor.Plugins.App.addListener('backButton', async () => {
        const now = Date.now();

        if (now - this.backButtonLastPress < 400) {
          window.Capacitor.Plugins.App.exitApp();
          return;
        }

        this.backButtonLastPress = now;

        if (Dialog?.closeLast?.()) return;
        if (await UI?.goBack?.()) return;

        if (UI?.currentView !== 'today-view') {
          UI.showView('today-view');
          return;
        }

        UI?.showToast?.(
          i18n.t('common.pressAgainToExit') || 'Press back again to exit',
          'info'
        );
      });
    });
  },

  // ===============================
  // Notification Clicks
  // ===============================
  initNotificationListeners() {
    if (!window.Capacitor?.Plugins?.LocalNotifications) return;

    window.Capacitor.Plugins.LocalNotifications.addListener(
      'localNotificationActionPerformed',
      () => {
        setTimeout(() => UI?.showView('today-view'), 300);
      }
    );
  }
};

// ===============================
// Safe Boot
// ===============================
window.addEventListener('load', () => {
  App.init().catch(err => Logger.error('App init failed:', err));
});
