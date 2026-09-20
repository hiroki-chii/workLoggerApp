const { app, BrowserWindow, ipcMain, dialog, Menu, Tray, powerMonitor } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

// アプリケーション名を最優先で設定 (パス決定に影響するため)
app.setName('workloggerapp');

// Windowsアップデート後のGPUドライバ/サンドボックス競合によるクラッシュ暫定対策
if (process.env.WORKLOGGER_DISABLE_GPU === '1') app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');

// プロジェクトルートへのパス
const PROJECT_ROOT = path.join(__dirname, '..');
// システムの APPDATA を直接参照してパスを固定
const SHARED_USER_DATA = process.env.WORKLOGGER_DATA_DIR || path.join(process.env.APPDATA, 'workloggerapp');
const DB_PATH = path.join(SHARED_USER_DATA, 'logs.db');
const MONITOR_SCRIPT_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'monitor.ps1')
  : path.join(PROJECT_ROOT, 'backend', 'monitor.ps1');
if (process.env.WORKLOGGER_DATA_DIR) app.setPath('userData', SHARED_USER_DATA);
const hasSingleInstanceLock = app.requestSingleInstanceLock();

function startApp() {
  let serverProcess = null;
  let collectorProcess = null;
  let mainWindow = null;
  let miniWindow = null;
  let tray = null;
  let isQuitting = false;
  let recordingRequested = true;
  let suspended = false;
  let serverReady = false;
  let alertQueue = Promise.resolve();

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
        backgroundThrottling: false,
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

    let moveTimer;
    let savedPosition;
    function savePosition() {
      clearTimeout(moveTimer);
      if (!savedPosition) return;
      const [mx, my] = savedPosition;
      savedPosition = null;
      let db;
      try {
        const Database = require('better-sqlite3');
        db = new Database(DB_PATH);
        db.transaction(() => {
          const save = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
          save.run('mini_window_x', String(mx));
          save.run('mini_window_y', String(my));
        })();
      } catch (err) {
        console.error('[Main] Failed to save mini window position:', err);
      } finally { if (db) db.close(); }
    }
    miniWindow.on('move', () => {
      savedPosition = miniWindow.getPosition();
      clearTimeout(moveTimer);
      moveTimer = setTimeout(savePosition, 300);
    });
    miniWindow.on('close', savePosition);

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
        backgroundThrottling: true,
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
          stopServer();
          app.quit();
        }
      }
    ]);
    tray.setToolTip('ゆとリズム');
    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
      if (mainWindow) {
        mainWindow.show();
      }
    });
  }


  function startServer() {
    serverProcess = spawn(process.execPath, [path.join(PROJECT_ROOT, 'backend', 'server.js')], {
      env: { ...process.env, DB_PATH, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'], windowsHide: true
    });
    serverProcess.on('message', message => {
      if (message.type === 'ready') {
        serverReady = true;
        if (recordingRequested && !suspended) startCollector();
      } else if (message.type === 'alert') {
        alertQueue = alertQueue.then(() => !isQuitting && showDanger(message.message)).catch(console.error);
      }
    });
    serverProcess.on('error', error => console.error('[Main] Server failed:', error));
    serverProcess.on('exit', () => {
      serverReady = false;
      serverProcess = null;
      stopCollector();
    });
  }

  function startCollector() {
    if (collectorProcess || !serverReady || suspended || isQuitting) return;
    const child = spawn(process.execPath, [path.join(PROJECT_ROOT, 'backend', 'collector.js')], {
      env: { ...process.env, DB_PATH, MONITOR_SCRIPT_PATH, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'], windowsHide: true
    });
    collectorProcess = child;
    child.monitorPid = null;
    child.on('message', message => {
      if (message.type === 'monitor-pid') child.monitorPid = message.pid;
    });
    child.on('error', error => console.error('[Main] Collector failed:', error));
    child.on('exit', () => {
      if (collectorProcess === child) collectorProcess = null;
      if (child.monitorPid) { try { process.kill(child.monitorPid); } catch {} }
    });
  }

  function stopCollector() {
    const child = collectorProcess;
    if (!child) return;
    collectorProcess = null;
    if (child.connected) child.send({ type: 'shutdown' }, () => {});
    // Windows terminate bypasses child cleanup: stop the monitor first if shutdown stalls.
    const fallback = setTimeout(() => {
      if (child.monitorPid) { try { process.kill(child.monitorPid); } catch {} }
      child.kill();
    }, 2000);
    child.once('exit', () => clearTimeout(fallback));
  }

  function stopServer() {
    const child = serverProcess;
    if (!child) return;
    serverProcess = null;
    serverReady = false;
    if (child.connected) child.send({ type: 'shutdown' }, () => {});
    const fallback = setTimeout(() => child.kill(), 2000);
    child.once('exit', () => clearTimeout(fallback));
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
    recordingRequested = true;
    startCollector();
    return !!collectorProcess;
  });

  ipcMain.handle('recording:stop', () => {
    recordingRequested = false;
    stopCollector();
    return false;
  });

  ipcMain.handle('recording:status', () => {
    return !!collectorProcess;
  });

  ipcMain.handle('app:quit-completely', () => {
    isQuitting = true;
    stopCollector();
    stopServer();
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

  async function showDanger(message) {
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
  }
  ipcMain.handle('alert:danger', (event, message) => showDanger(message));

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
  // Collector starts after the server initializes the database.
  createWindow();
  createTray();

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    isQuitting = true;
    stopServer();
    stopCollector();
  });

  powerMonitor.on('suspend', () => {
    suspended = true;
    stopCollector();
  });
  powerMonitor.on('resume', () => {
    suspended = false;
    if (recordingRequested) startCollector();
    if (serverProcess?.connected) serverProcess.send({ type: 'resume' }, () => {});
    for (const win of [mainWindow, miniWindow]) {
      if (win && !win.isDestroyed()) win.webContents.send('window-event:received', { type: 'sync' });
    }
  });

  app.on('second-instance', () => {
    if (!mainWindow) createWindow();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.on('activate', () => {
    if (mainWindow === null) createWindow();
    else mainWindow.show();
  });
}

if (!hasSingleInstanceLock) {
  app.quit();
} else app.whenReady().then(() => {
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
