const { autoUpdater } = require('electron-updater');
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let updateWindow = null;
let mainWindowRef = null;

/**
 * Check for updates silently in the background.
 * If an update is found, notify the main window so it shows a popup.
 */
function checkForUpdatesSilent() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;

  autoUpdater.logger = {
    info: (msg) => console.log('[Updater]', msg),
    warn: (msg) => console.warn('[Updater]', msg),
    error: (msg) => console.error('[Updater]', msg),
    debug: () => {}
  };

  try {
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: 'laurayazzzy-ux',
      repo: 'aprendeofm-releases'
    });
  } catch (e) {
    console.error('[Updater] Failed to set feed URL:', e.message);
    return;
  }

  autoUpdater.on('update-available', (info) => {
    // Notify the main window that an update is available
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.webContents.send('update:available', {
        version: info.version,
        releaseNotes: info.releaseNotes || ''
      });
    }
  });

  autoUpdater.on('update-not-available', () => {
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.webContents.send('update:not-available');
    }
  });

  autoUpdater.on('download-progress', (progress) => {
    sendToUpdateWindow('progress', { percent: Math.round(progress.percent) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendToUpdateWindow('downloaded', { version: info.version });
    setTimeout(() => {
      autoUpdater.quitAndInstall(false, true);
    }, 1500);
  });

  autoUpdater.on('error', (err) => {
    console.error('[Updater] Error:', err.message);
    closeUpdateWindow();
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.webContents.send('update:error', err.message);
    }
  });

  // Start silent check
  autoUpdater.checkForUpdates().catch((err) => {
    console.error('[Updater] Check error:', err.message);
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
    alwaysOnTop: true,
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

function sendToUpdateWindow(status, extra = {}) {
  if (updateWindow && !updateWindow.isDestroyed()) {
    updateWindow.webContents.send('update:status', { status, ...extra });
  }
}

// Register IPC handlers for update actions from the renderer
function registerUpdateIPC(mainWindow) {
  mainWindowRef = mainWindow;

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

  // User accepted the update -> start downloading
  ipcMain.handle('update:accept', async () => {
    try {
      createUpdateWindow();
      sendToUpdateWindow('downloading', {});
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (err) {
      closeUpdateWindow();
      return { success: false, error: err.message };
    }
  });

  // Check silently after a short delay
  setTimeout(() => {
    if (app.isPackaged) {
      checkForUpdatesSilent();
    }
  }, 3000);
}

module.exports = { checkForUpdatesSilent, registerUpdateIPC };
