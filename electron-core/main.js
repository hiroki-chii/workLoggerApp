const { app, BrowserWindow, ipcMain, dialog, Menu, Tray } = require('electron');
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
  let tray = null;
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
    mainWindow.once('ready-to-show', () => {
      mainWindow.show();
    });

    // ウィンドウを閉じようとした時の処理: タスクトレイに格納
    mainWindow.on('close', (event) => {
      if (isQuitting) return;
      event.preventDefault();
      mainWindow.hide();
    });
  }

  function createTray() {
    const iconPath = path.join(PROJECT_ROOT, 'assets', 'icon.png');
    tray = new Tray(iconPath);
    const contextMenu = Menu.buildFromTemplate([
      {
        label: '表示',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
          } else {
            createWindow();
          }
        }
      },
      { type: 'separator' },
      {
        label: '終了',
        click: () => {
          isQuitting = true;
          stopCollector();
          if (serverProcess) serverProcess.kill();
          app.quit();
        }
      }
    ]);
    tray.setToolTip('PulseWork');
    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
      if (mainWindow) {
        mainWindow.show();
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

  ipcMain.handle('app:quit-completely', () => {
    isQuitting = true;
    stopCollector();
    if (serverProcess) serverProcess.kill();
    app.quit();
    return true;
  });


  // 初期化
  startServer();
  // アプリケーション起動時に自動で記録（collector）を開始
  startCollector();
  createWindow();
  createTray();

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
    else mainWindow.show();
  });
}

app.whenReady().then(() => {
  // カスタムメニューの設定 (Viewのみ残す)
  const template = [
    {
      label: 'View',
      submenu: [
        { role: 'reload', label: '再読み込み' },
        { role: 'forceReload', label: '強制的に再読み込み' },
        { role: 'toggleDevTools', label: 'デベロッパーツールを切り替え' },
        { type: 'separator' },
        { role: 'resetZoom', label: '実際のサイズ' },
        { role: 'zoomIn', label: '拡大' },
        { role: 'zoomOut', label: '縮小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全画面表示を切り替え' }
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  startApp();
});
