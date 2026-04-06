/**
 * WorkPulse Main Process
 * 
 * Electron v41 + Node.js v24 環境で、node_modules/electron が
 * パス文字列を返すモジュール競合を回避するための起動スクリプト。
 */

// Electron ランタイム内蔵モジュールを直接取得
// process.electronBinding が存在する = Electron プロセス内で実行中
let electron;
try {
  // Electron の内蔵モジュールローダーから直接取得を試みる
  electron = require('electron');
  // node_modules/electron は文字列(パス)を返すため、オブジェクトかチェック
  if (typeof electron === 'string' || !electron.app) {
    // キャッシュを削除して再取得
    delete require.cache[require.resolve('electron')];
    // node_modules/electron を除外するためパスを直接指定
    const electronPath = require.resolve('electron', { 
      paths: [] // node_modules を検索しない
    });
    electron = require(electronPath);
  }
} catch (e) {
  // フォールバック: process.versions.electron が存在すれば Electron 内
  if (process.versions.electron) {
    // Electron 内蔵モジュールへの直接アクセス
    electron = process._linkedBinding ? 
      { app: process._linkedBinding('electron_browser_app') } : 
      require('electron');
  } else {
    throw new Error('This script must be run within Electron');
  }
}

const { app, BrowserWindow } = electron;
const path = require('path');
const { spawn } = require('child_process');

// UserData path fix
app.setName('workloggerapp');

console.log('--- WorkPulse System Boot (App: %s) ---', app.getName());

let serverProcess;
let collectorProcess;
let mainWindow = null;
let isQuitting = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 850,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    show: false,
  });

  const isDev = !app.isPackaged;
  const startUrl = isDev 
    ? 'http://localhost:5173' 
    : `file://${path.join(__dirname, 'frontend/dist/index.html')}`;

  mainWindow.loadURL(startUrl);
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function startServices() {
  const userDataPath = app.getPath('userData');
  
  const env = {
    ...process.env,
    DB_PATH: path.join(userDataPath, 'logs.db'),
    MONITOR_SCRIPT_PATH: path.join(__dirname, 'backend', 'monitor.ps1')
  };

  console.log('Services started. Data stored in: %s', userDataPath);

  serverProcess = spawn('node', [path.join(__dirname, 'backend', 'server.js')], { 
    env,
    stdio: 'inherit'
  });

  collectorProcess = spawn('node', [path.join(__dirname, 'backend', 'collector.js')], { 
    env,
    stdio: 'inherit'
  });
}

app.whenReady().then(() => {
  startServices();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  if (serverProcess) serverProcess.kill();
  if (collectorProcess) collectorProcess.kill();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
