const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

// アプリケーション名を最優先で設定 (パス決定に影響するため)
app.setName('workloggerapp');

// プロジェクトルートへのパス
const PROJECT_ROOT = path.join(__dirname, '..');
// システムの APPDATA を直接参照してパスを固定
const SHARED_USER_DATA = path.join(process.env.APPDATA, 'workloggerapp');
const DB_PATH = path.join(SHARED_USER_DATA, 'logs.db');

function startApp() {
  let serverProcess = null;
  let collectorProcess = null;
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
      icon: path.join(PROJECT_ROOT, 'assets', 'icon.png'),
      show: false,
    });

    const isDev = !app.isPackaged;
    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
    const startUrl = isDev 
      ? devUrl 
      : `file://${path.join(PROJECT_ROOT, 'frontend/dist/index.html')}`;

    mainWindow.loadURL(startUrl);
    mainWindow.once('ready-to-show', () => mainWindow.show());

    // ウィンドウを閉じようとした時の処理
    mainWindow.on('close', (event) => {
      if (isQuitting) return;

      if (collectorProcess) {
        event.preventDefault();
        const choice = dialog.showMessageBoxSync(mainWindow, {
          type: 'question',
          buttons: ['はい', 'キャンセル'],
          title: '記録の停止確認',
          message: '現在アクティビティを記録中です。記録を停止してアプリを閉じますか？',
          defaultId: 0,
          cancelId: 1
        });

        if (choice === 0) {
          stopCollector();
          isQuitting = true;
          app.quit();
        }
      } else {
        if (!isQuitting) {
          // 記録中以外はトレイに隠す（または通常終了。既存の仕様はhide）
          // ユーザーの「アプリを閉じてください」という言葉に応じ、記録停止時はそのまま終了させる
          isQuitting = true;
          app.quit();
        }
      }
    });
  }

  function startServer() {
    const env = {
      ...process.env,
      DB_PATH,
      MONITOR_SCRIPT_PATH: path.join(PROJECT_ROOT, 'backend', 'monitor.ps1'),
      ELECTRON_RUN_AS_NODE: '1'
    };

    if (!serverProcess) {
      serverProcess = spawn(process.execPath, [path.join(PROJECT_ROOT, 'backend', 'server.js')], { 
        env, 
        stdio: 'inherit',
        windowsHide: true
      });
      console.log('[Main] Server started.');
    }
  }

  function startCollector() {
    if (collectorProcess) return;

    const env = {
      ...process.env,
      DB_PATH,
      MONITOR_SCRIPT_PATH: path.join(PROJECT_ROOT, 'backend', 'monitor.ps1'),
      ELECTRON_RUN_AS_NODE: '1'
    };

    collectorProcess = spawn(process.execPath, [path.join(PROJECT_ROOT, 'backend', 'collector.js')], { 
      env, 
      stdio: 'inherit',
      windowsHide: true
    });
    console.log('[Main] Collector started.');
  }

  function stopCollector() {
    if (collectorProcess) {
      collectorProcess.kill();
      collectorProcess = null;
      console.log('[Main] Collector stopped.');
    }
  }

  // IPC ハンドラーの登録
  ipcMain.handle('recording:start', () => {
    startCollector();
    return true;
  });

  ipcMain.handle('recording:stop', () => {
    stopCollector();
    return false;
  });

  ipcMain.handle('recording:status', () => {
    return !!collectorProcess;
  });

  // 初期化
  startServer();
  // デフォルトでは記録を開始しない（ユーザー操作を待つ）
  createWindow();

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    isQuitting = true;
    if (serverProcess) serverProcess.kill();
    if (collectorProcess) collectorProcess.kill();
  });

  app.on('activate', () => {
    if (mainWindow === null) createWindow();
  });
}

app.whenReady().then(startApp);

