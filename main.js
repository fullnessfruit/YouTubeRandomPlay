const { app, BrowserWindow, session, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')

// Disable background throttling for all renderers including webview guest processes
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')

const logFile = path.join(__dirname, 'debug.log')
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  fs.appendFileSync(logFile, line)
}

let win;
let normalBounds = null;
let isPip = true;

function createWindow () {
  win = new BrowserWindow({
    width: 320,
    height: 180,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true,
      backgroundThrottling: false
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver');
  log(`createWindow - alwaysOnTop: ${win.isAlwaysOnTop()}, level: screen-saver`);

  win.setMenu(null);
  win.loadFile('index.html')
    .catch((err) => { log(`❌ loadFile rejected - error: ${err && err.message ? err.message : err}`); });

  // Forward renderer error-level console messages to debug.log (level 3 only; levels: 0=verbose, 1=info, 2=warning, 3=error)
  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (level === 3) {
      log(`🖥 renderer console error - source: ${sourceId}:${line}, msg: ${message}`);
    }
  });

  win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    log(`❌ did-fail-load - code: ${errorCode}, desc: ${errorDescription}, url: ${validatedURL}, mainFrame: ${isMainFrame}`);
  });
  win.webContents.on('preload-error', (event, preloadPath, error) => {
    log(`❌ preload-error - path: ${preloadPath}, error: ${error && error.message ? error.message : error}`);
  });
  win.webContents.on('render-process-gone', (event, details) => {
    log(`❌ render-process-gone - reason: ${details.reason}, exitCode: ${details.exitCode}`);
  });

  // Notify renderer of PIP mode after load
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('pip-changed', true);
  });

  // Track alwaysOnTop state changes
  win.on('always-on-top-changed', (event, isOnTop) => {
    log(`always-on-top-changed event - isOnTop: ${isOnTop}, isPip: ${isPip}`);
    // Restore alwaysOnTop if lost while in PIP mode
    if (isPip && !isOnTop) {
      log('alwaysOnTop lost in PIP mode, restoring');
      win.setAlwaysOnTop(true, 'screen-saver');
    }
  });

  win.on('resize', () => {
    log(`resize - bounds: ${JSON.stringify(win.getBounds())}, alwaysOnTop: ${win.isAlwaysOnTop()}, isPip: ${isPip}`);
  });

  session.defaultSession.clearCache();
}

ipcMain.on('toggle-pip', () => {
  if (!win) return;

  if (isPip) {
    // PIP → Normal
    isPip = false;
    win.setAlwaysOnTop(false);
    if (normalBounds) {
      win.setBounds(normalBounds);
    } else {
      win.setBounds({ width: 527, height: 407 });
    }
    log(`toggle-pip → normal - bounds: ${JSON.stringify(win.getBounds())}`);
  } else {
    // Normal → PIP
    normalBounds = win.getBounds();
    isPip = true;
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setBounds({ width: 320, height: 180 });
    log(`toggle-pip → pip - bounds: ${JSON.stringify(win.getBounds())}`);
  }

  win.webContents.send('pip-changed', isPip);
});

ipcMain.on('window-minimize', () => { if (win) win.minimize(); });
ipcMain.on('window-maximize', () => {
  if (!win) return;
  win.isMaximized() ? win.unmaximize() : win.maximize();
});
ipcMain.on('window-close', () => { if (win) win.close(); });

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
