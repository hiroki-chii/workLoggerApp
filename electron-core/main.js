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
  let miniWindow = null;
  let tray = null;
  let isQuitting = false;

  function createMiniWindow() {
    if (miniWindow) {
      miniWindow.show();
      return;
    }

    const { screen } = require('electron');
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;

    const miniW = 240;
    const miniH = 160;

    let x = width - miniW - 20;
    let y = height - miniH - 20;

    try {
      const Database = require('better-sqlite3');
      const db = new Database(DB_PATH);
      const xObj = db.prepare('SELECT value FROM settings WHERE key = ?').get('mini_window_x');
      const yObj = db.prepare('SELECT value FROM settings WHERE key = ?').get('mini_window_y');
      db.close();

      if (xObj && yObj) {
        const savedX = parseInt(xObj.value, 10);
        const savedY = parseInt(yObj.value, 10);
        
        if (!isNaN(savedX) && !isNaN(savedY)) {
          // 保存された位置が、現在接続されているいずれかのディスプレイの表示エリア内にあるか検証
          const displays = screen.getAllDisplays();
          const isWithinAnyScreen = displays.some(display => {
            const bounds = display.bounds;
            // ミニウィンドウの左上がディスプレイの範囲内に入っているか
            return (
              savedX >= bounds.x &&
              savedX < bounds.x + bounds.width &&
              savedY >= bounds.y &&
              savedY < bounds.y + bounds.height
            );
          });

          if (isWithinAnyScreen) {
            x = savedX;
            y = savedY;
          } else {
            console.log('[Main] Saved mini window position is out of screen bounds. Resetting to default.');
          }
        }
      }
    } catch (err) {
      console.error('[Main] Failed to read mini window position:', err);
    }

    miniWindow = new BrowserWindow({
      x,
      y,
      width: miniW,
      height: miniH,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      hasShadow: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
      icon: path.join(PROJECT_ROOT, 'assets', 'icon.png'),
    });

    const isDev = !app.isPackaged;
    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';

    if (isDev) {
      miniWindow.loadURL(`${devUrl}?mini=true`);
    } else {
      miniWindow.loadFile(path.join(PROJECT_ROOT, 'frontend/dist/index.html'), {
        query: { mini: 'true' }
      });
    }

    miniWindow.on('move', () => {
      try {
        const [mx, my] = miniWindow.getPosition();
        const Database = require('better-sqlite3');
        const db = new Database(DB_PATH);
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('mini_window_x', mx.toString());
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('mini_window_y', my.toString());
        db.close();
      } catch (err) {
        console.error('[Main] Failed to save mini window position:', err);
      }
    });

    miniWindow.on('closed', () => {
      miniWindow = null;
    });
  }

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1100,
      height: 850,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        backgroundThrottling: false,
      },
      icon: path.join(PROJECT_ROOT, 'assets', 'icon.png'),
      show: false,
    });

    const isDev = !app.isPackaged;
    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';

    if (isDev) {
      mainWindow.loadURL(devUrl);
    } else {
      mainWindow.loadFile(path.join(PROJECT_ROOT, 'frontend/dist/index.html'));
    }

    mainWindow.once('ready-to-show', () => {
      mainWindow.show();
    });

    // ウィンドウを閉じようとした時の処理: タスクトレイに格納
    mainWindow.on('close', (event) => {
      if (isQuitting) return;
      event.preventDefault();
      mainWindow.hide();

      try {
        const Database = require('better-sqlite3');
        const db = new Database(DB_PATH);
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('show_mini_on_close');
        db.close();

        if (row && row.value === 'true') {
          createMiniWindow();
        }
      } catch (err) {
        console.error('[Main] Failed to read show_mini_on_close setting:', err);
        // デフォルトではミニ画面を表示
        createMiniWindow();
      }
    });

    // 最小化された時の処理: ミニ画面表示
    mainWindow.on('minimize', () => {
      try {
        const Database = require('better-sqlite3');
        const db = new Database(DB_PATH);
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('show_mini_on_close');
        db.close();

        if (row && row.value === 'true') {
          createMiniWindow();
        }
      } catch (err) {
        console.error('[Main] Failed to read show_mini_on_close setting on minimize:', err);
        createMiniWindow();
      }
    });

    // 復元された時の処理: ミニ画面を閉じる
    mainWindow.on('restore', () => {
      if (miniWindow) {
        miniWindow.close();
      }
    });

    mainWindow.on('show', () => {
      if (miniWindow) {
        miniWindow.close();
      }
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
  ipcMain.on('window-event:notify', (event, arg) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window-event:received', arg);
    }
    if (miniWindow && !miniWindow.isDestroyed()) {
      miniWindow.webContents.send('window-event:received', arg);
    }
  });

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

  ipcMain.handle('mini-window:open', () => {
    createMiniWindow();
    if (mainWindow) {
      mainWindow.hide();
    }
    return true;
  });

  ipcMain.handle('mini-window:close', () => {
    if (miniWindow) {
      miniWindow.close();
    }
    if (mainWindow) {
      mainWindow.show();
    }
    return true;
  });

  ipcMain.handle('alert:danger', async (event, message) => {
    const parentWin = mainWindow && mainWindow.isVisible() ? mainWindow : (miniWindow && miniWindow.isVisible() ? miniWindow : null);
    if (parentWin) {
      if (parentWin.isMinimized()) parentWin.restore();
      parentWin.show();
      parentWin.focus();
      if (parentWin === mainWindow) {
        parentWin.setAlwaysOnTop(true, 'screen-saver');
      }
    }
    await dialog.showMessageBox(parentWin, {
      type: 'warning',
      title: 'WorkPulse からのお知らせ',
      message: message || '長時間の作業お疲れ様です。そろそろ休憩を取りませんか？☕',
      buttons: ['閉じる']
    });
    if (parentWin === mainWindow && parentWin && !parentWin.isDestroyed()) {
      parentWin.setAlwaysOnTop(false);
    }
    return true;
  });

  ipcMain.handle('alert:confirm', async (event, { title, message }) => {
    const parentWin = mainWindow && mainWindow.isVisible() ? mainWindow : (miniWindow && miniWindow.isVisible() ? miniWindow : null);
    if (parentWin) {
      if (parentWin.isMinimized()) parentWin.restore();
      parentWin.show();
      parentWin.focus();
    }
    const result = await dialog.showMessageBox(parentWin, {
      type: 'question',
      title: title || 'WorkPulse 確認',
      message: message || '本当によろしいですか？',
      buttons: ['はい', 'キャンセル'],
      defaultId: 0,
      cancelId: 1
    });
    return result.response === 0;
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
