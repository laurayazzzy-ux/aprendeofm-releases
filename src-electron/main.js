const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

// Debug logging to file
const logFile = path.join(require('os').tmpdir(), 'aura-debug.log');
function debugLog(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(logFile, line);
}
debugLog('=== App starting ===');
debugLog('process.type: ' + process.type);
debugLog('app version: ' + app.getVersion());
debugLog('__dirname: ' + __dirname);

// Security: disable remote debugging and GPU process debugging
app.commandLine.appendSwitch('--disable-remote-debugging');
app.commandLine.appendSwitch('--disable-gpu-sandbox');
app.commandLine.appendSwitch('--js-flags', '--noexpose_wasm');

debugLog('Loading electron-store...');
const Store = require('electron-store');
debugLog('Loading fingerprint...');
const { getFingerprint, getHardwareInfo } = require('./services/fingerprint');
debugLog('Loading heartbeat...');
const { startHeartbeat, stopHeartbeat } = require('./services/heartbeat');
debugLog('Loading updater...');
const { registerUpdateIPC } = require('./services/updater');
debugLog('All modules loaded');

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
debugLog('gotLock: ' + gotLock);
if (!gotLock) {
  debugLog('Another instance running, quitting');
  app.quit();
}
debugLog('app.isReady: ' + app.isReady());
debugLog('Registering whenReady...');
process.on('uncaughtException', (err) => {
  debugLog('UNCAUGHT EXCEPTION: ' + err.message + '\n' + err.stack);
});
process.on('unhandledRejection', (err) => {
  debugLog('UNHANDLED REJECTION: ' + (err && err.message || err));
});

// Integrity verification (works with both .js and .jsc files)
function verifyIntegrity() {
  try {
    const integrityPath = path.join(__dirname, '.integrity');
    if (!fs.existsSync(integrityPath)) return true; // Skip in dev mode
    const hashes = JSON.parse(fs.readFileSync(integrityPath, 'utf8'));
    const basePath = path.join(__dirname, '..');
    let checkedCount = 0;
    for (const [file, expectedHash] of Object.entries(hashes)) {
      const filePath = path.join(basePath, file);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath);
        const actual = crypto.createHash('sha256').update(content).digest('hex');
        if (actual !== expectedHash) {
          return false;
        }
        checkedCount++;
      }
    }
    // At least some files should pass integrity check
    return checkedCount > 0 || Object.keys(hashes).length === 0;
  } catch (err) {
    return true; // Skip on error (dev mode)
  }
}

const store = new Store({
  encryptionKey: crypto.createHash('sha256').update('aura_' + (process.env.STORE_SECRET || 'k3y_2024') + '_enc').digest('hex').slice(0, 32),
  name: 'aura-license'
});

const SERVER_URL = process.env.LICENSE_SERVER_URL || 'http://178.173.245.134:3001';
let licenseWindow = null;
let mainWindow = null;
let currentToken = null;

function createLicenseWindow() {
  if (licenseWindow) return;

  licenseWindow = new BrowserWindow({
    width: 440,
    height: 520,
    resizable: false,
    frame: false,
    transparent: false,
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, 'preload-license.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      enableRemoteModule: false
    },
    icon: path.join(__dirname, '..', 'app', 'assets', 'logo.png')
  });

  licenseWindow.loadFile(path.join(__dirname, 'license.html'));

  // Block navigation away from license page
  licenseWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  licenseWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  licenseWindow.on('closed', () => {
    licenseWindow = null;
    if (!mainWindow) app.quit();
  });
}

function createMainWindow() {
  if (mainWindow) return;

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    frame: false,
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, 'preload-main.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      enableRemoteModule: false
    },
    icon: path.join(__dirname, '..', 'app', 'assets', 'logo.png')
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'app', 'index.html'));

  // Block navigation to external URLs
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Register update IPC handlers for manual checks from renderer
  mainWindow.webContents.once('did-finish-load', () => {
    registerUpdateIPC(mainWindow);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    stopHeartbeat();
    app.quit();
  });
}

// IPC Handlers
ipcMain.handle('license:validate', async (event, key) => {
  try {
    // Sanitize key input
    if (typeof key !== 'string' || key.length > 50) {
      return { success: false, error: 'Clave inválida.' };
    }
    key = key.replace(/[^a-zA-Z0-9\-]/g, '').trim();

    const fingerprint = getFingerprint();
    const hardwareInfo = getHardwareInfo();

    const response = await fetch(SERVER_URL + '/api/license/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, fingerprint, hardwareInfo })
    });

    const data = await response.json();

    if (data.valid && data.token) {
      currentToken = data.token;
      store.set('license_key', key);
      store.set('license_token', data.token);

      // Start heartbeat
      startHeartbeat(SERVER_URL, data.token, fingerprint, (errorMsg) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('license:error', errorMsg);
          setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
          }, 5000);
        }
      });

      // Close license window and open main
      if (licenseWindow && !licenseWindow.isDestroyed()) licenseWindow.close();
      createMainWindow();

      return { success: true };
    } else {
      return { success: false, error: data.error || 'Validación fallida.' };
    }
  } catch (err) {
    return { success: false, error: 'No se puede conectar al servidor. Verifica que el servidor esté activo.' };
  }
});

ipcMain.handle('license:logout', async () => {
  store.delete('license_key');
  store.delete('license_token');
  currentToken = null;
  stopHeartbeat();

  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  createLicenseWindow();
});

ipcMain.handle('app:getUser', () => {
  return { hasLicense: !!currentToken };
});

ipcMain.on('app:minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) win.minimize();
});

ipcMain.on('app:maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  }
});

ipcMain.on('app:close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) win.close();
});

// Focus existing window when second instance is launched
app.on('second-instance', () => {
  const win = mainWindow || licenseWindow;
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

// App lifecycle
app.whenReady().then(async () => {
  debugLog('app.whenReady fired');
  // Integrity check
  debugLog('verifyIntegrity: ' + verifyIntegrity());
  if (!verifyIntegrity()) {
    dialog.showErrorBox('Error', 'La aplicación ha sido modificada. No se puede iniciar.');
    app.quit();
    return;
  }

  // Disable hardware acceleration in renderer for security
  app.disableHardwareAcceleration;

  // CSP headers
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com https://cdnjs.cloudflare.com; " +
          "img-src 'self' data: file:; " +
          "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; " +
          "connect-src 'self' " + SERVER_URL + " http://178.173.245.134:3001; " +
          "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com data:; " +
          "object-src 'none'; " +
          "base-uri 'self';"
        ]
      }
    });
  });

  // Block all permission requests (camera, mic, geolocation, etc.)
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(false);
  });

  // Try auto-login with saved credentials
  const savedKey = store.get('license_key');
  const savedToken = store.get('license_token');

  if (savedKey && savedToken) {
    try {
      const fingerprint = getFingerprint();
      const response = await fetch(SERVER_URL + '/api/license/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: savedKey,
          fingerprint,
          hardwareInfo: getHardwareInfo()
        })
      });

      const data = await response.json();

      if (data.valid && data.token) {
        currentToken = data.token;
        store.set('license_token', data.token);

        startHeartbeat(SERVER_URL, data.token, fingerprint, (errorMsg) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('license:error', errorMsg);
            setTimeout(() => {
              if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
            }, 5000);
          }
        });

        createMainWindow();
        return;
      }
    } catch (err) {
      // Auto-login failed silently, show license screen
    }
  }

  debugLog('Creating license window');
  createLicenseWindow();
  debugLog('License window created');
});

app.on('window-all-closed', () => {
  debugLog('window-all-closed event');
  stopHeartbeat();
  app.quit();
});

app.on('activate', () => {
  if (!mainWindow && !licenseWindow) {
    createLicenseWindow();
  }
});
