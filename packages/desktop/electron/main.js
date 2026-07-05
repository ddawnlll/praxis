const { app, BrowserWindow, nativeImage } = require('electron');
const path = require('path');

let mainWindow;

app.whenReady().then(() => {
  const iconPath = path.join(__dirname, '../../scripts/praxis-icon.svg');
  const icon = nativeImage.createFromPath(iconPath);

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
    title: 'PRAXIS Mission Control',
  });

  const isDev = process.argv.includes('--dev');
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/renderer/index.html'));
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
