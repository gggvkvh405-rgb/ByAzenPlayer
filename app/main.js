const { app, BrowserWindow, ipcMain, shell, nativeImage } = require('electron');
const path = require('path');

const isDev = !app.isPackaged;

/** @type {BrowserWindow|null} */
let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    frame: false,
    backgroundColor: '#F5F1EA',
    title: 'ByAzen',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.once('ready-to-show', () => win.show());

  const send = () => win && win.webContents.send('window:state', { maximized: win.isMaximized() });
  win.on('maximize', send);
  win.on('unmaximize', send);

  // keep external links out of the app shell
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev && process.env.BYAZEN_DEVTOOLS) win.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.byazen.player');
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* --------------------------------------------------------- window controls */
ipcMain.handle('window:minimize', () => win && win.minimize());
ipcMain.handle('window:toggleMaximize', () => {
  if (!win) return false;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
  return win.isMaximized();
});
ipcMain.handle('window:close', () => win && win.close());
ipcMain.handle('window:isMaximized', () => !!(win && win.isMaximized()));

/* ------------------------------------------------------------- misc helpers */
ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  platform: process.platform,
}));

ipcMain.handle('shell:openExternal', (_e, url) => {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
});

ipcMain.handle('app:icon', () => {
  const img = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.ico'));
  return img.isEmpty() ? null : img.toDataURL();
});
