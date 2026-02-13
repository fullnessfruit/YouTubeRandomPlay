const { app, BrowserWindow, session } = require('electron')
const path = require('path')

function createWindow () {
  const win = new BrowserWindow({
    width: 527,
    height: 407,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true,
      backgroundThrottling: false
    }
  })

  win.setMenu(null);
  win.loadFile('index.html')
  
  session.defaultSession.clearCache();
}

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
