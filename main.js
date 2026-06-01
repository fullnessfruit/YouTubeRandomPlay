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

// Channel rotation drives Electron's `name` field (and thus the userData path / Google
// session directory). On each launch we rotate the index if the date changed, then verify
// package.json matches the target template's `name`. A mismatch triggers a copy + relaunch
// so the next instance boots with the correct identity. The relaunch is required because
// userData is resolved once during app initialization and cannot be changed at runtime.
const channelListSlotCount = 4;
const packageTemplates = ['package_l.json', 'package_l_h.json', 'package_l_n.json', 'package_l_u.json'];
const recordFilePath = path.join(__dirname, 'channel_record.json');
const packagePath = path.join(__dirname, 'package.json');

function ensureCorrectPackageJson() {
  let record = { date: null, index: -1 };
  try {
    record = JSON.parse(fs.readFileSync(recordFilePath, 'utf8'));
  } catch {}

  const today = new Date().toISOString().slice(0, 10);
  let targetIndex;

  if (record.date === today) {
    targetIndex = record.index;
  } else {
    targetIndex = (record.index + 1) % channelListSlotCount;
    fs.writeFileSync(recordFilePath, JSON.stringify({ date: today, index: targetIndex }), 'utf8');
    log(`📅 channel rotation - date: ${today}, index: ${targetIndex}`);
  }

  const templatePath = path.join(__dirname, packageTemplates[targetIndex]);
  let templateName, currentName;
  try {
    templateName = JSON.parse(fs.readFileSync(templatePath, 'utf8')).name;
  } catch (e) {
    log(`⚠️ package template read failed - path: ${templatePath}, error: ${e && e.message ? e.message : e}`);
    return false;
  }
  try {
    currentName = JSON.parse(fs.readFileSync(packagePath, 'utf8')).name;
  } catch (e) {
    log(`⚠️ current package.json read failed - error: ${e && e.message ? e.message : e}`);
    return false;
  }

  if (templateName === currentName) {
    return false;
  }

  log(`🔄 package.json swap - from: ${currentName}, to: ${templateName}, template: ${packageTemplates[targetIndex]}, index: ${targetIndex}`);
  fs.copyFileSync(templatePath, packagePath);
  return true;
}

if (ensureCorrectPackageJson()) {
  log('🔁 relaunching after package.json swap');
  app.relaunch();
  app.exit(0);
}
// app.exit terminates immediately; code below only runs when no swap was needed.

let win;
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
    // PIP → Normal: drop always-on-top but keep the current window size
    isPip = false;
    win.setAlwaysOnTop(false);
    log(`toggle-pip → normal - bounds: ${JSON.stringify(win.getBounds())}`);
  } else {
    // Normal → PIP: restore always-on-top but keep the current window size
    isPip = true;
    win.setAlwaysOnTop(true, 'screen-saver');
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
