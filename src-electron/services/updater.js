const { autoUpdater } = require('electron-updater');
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let updateWindow = null;
let updateFoundVersion = null;

/**
 * Check for updates on app startup.
 * Shows a small window if an update is found, downloads, installs, and restarts.
 * Returns a promise: resolves true if no update (continue app), or never resolves if updating.
 */
function checkForUpdatesOnStartup() {
  return new Promise((resolve) => {
    // Configure auto-updater
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;

    autoUpdater.logger = {
      info: (msg) => console.log('[Updater]', msg),
      warn: (msg) => console.warn('[Updater]', msg),
      error: (msg) => console.error('[Updater]', msg),
      debug: () => {}
    };

    // Set feed URL - GitHub Releases
    try {
      autoUpdater.setFeedURL({
        provider: 'github',
        owner: 'laurayazzzy-ux',
        repo: 'aprendeofm-releases'
      });
    } catch (e) {
      console.error('[Updater] Failed to set feed URL:', e.message);
      resolve(true);
      return;
    }

    let updateCheckTimeout = setTimeout(() => {
      // If check takes more than 10 seconds, skip
      closeUpdateWindow();
      resolve(true);
    }, 10000);

    autoUpdater.on('update-available', (info) => {
      updateFoundVersion = info.version;
      // Show update window and start download
      createUpdateWindow();
      sendStatus('downloading', { version: info.version });
      autoUpdater.downloadUpdate().catch((err) => {
        console.error('[Updater] Download error:', err.message);
        clearTimeout(updateCheckTimeout);
        closeUpdateWindow();
        resolve(true);
      });
    });

    autoUpdater.on('update-not-available', () => {
      clearTimeout(updateCheckTimeout);
      closeUpdateWindow();
      resolve(true);
    });

    autoUpdater.on('download-progress', (progress) => {
      sendStatus('progress', { percent: Math.round(progress.percent) });
    });

    autoUpdater.on('update-downloaded', () => {
      clearTimeout(updateCheckTimeout);
      sendStatus('downloaded', { version: updateFoundVersion });
      // Wait a moment so user sees "Instalando...", then quit and install
      setTimeout(() => {
        autoUpdater.quitAndInstall(false, true);
      }, 1500);
    });

    autoUpdater.on('error', (err) => {
      console.error('[Updater] Error:', err.message);
      clearTimeout(updateCheckTimeout);
      closeUpdateWindow();
      resolve(true);
    });

    // Start the check
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[Updater] Check error:', err.message);
      clearTimeout(updateCheckTimeout);
      resolve(true);
    });
  });
}

function createUpdateWindow() {
  if (updateWindow) return;

  updateWindow = new BrowserWindow({
    width: 380,
    height: 340,
    resizable: false,
    frame: false,
    transparent: false,
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload-update.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    icon: path.join(__dirname, '..', '..', 'app', 'assets', 'logo.png')
  });

  updateWindow.loadFile(path.join(__dirname, '..', 'update.html'));
  updateWindow.on('closed', () => { updateWindow = null; });
}

function closeUpdateWindow() {
  if (updateWindow && !updateWindow.isDestroyed()) {
    updateWindow.close();
  }
  updateWindow = null;
}

function sendStatus(status, extra = {}) {
  if (updateWindow && !updateWindow.isDestroyed()) {
    updateWindow.webContents.send('update:status', { status, ...extra });
  }
}

// IPC handlers for manual update check from main window
function registerUpdateIPC(mainWindow) {
  if (!ipcMain.listenerCount || true) {
    ipcMain.handle('update:check', async () => {
      try {
        const result = await autoUpdater.checkForUpdates();
        return { success: true, version: result?.updateInfo?.version };
      } catch (err) {
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle('update:getVersion', () => {
      return app.getVersion();
    });
  }
}

module.exports = { checkForUpdatesOnStartup, registerUpdateIPC };
