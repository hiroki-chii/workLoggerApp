const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(process.env.APPDATA, 'workloggerapp', 'logs.db');
const MONITOR_SCRIPT = process.env.MONITOR_SCRIPT_PATH || path.join(__dirname, 'monitor.ps1');


let db;
function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
  }
  return db;
}

function getSettings() {
  try {
    const _db = getDb();
    const rows = _db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    return {
      interval: parseInt(settings.sampling_interval || 10) * 1000,
      idleThreshold: 120 // 2分（120秒）に固定
    };
  } catch (err) {
    return { interval: 10000, idleThreshold: 120 };
  }
}

async function collect() {
  const startTime = Date.now();
  if (!fs.existsSync(MONITOR_SCRIPT)) {
    console.error('[Collector] Monitor script not found:', MONITOR_SCRIPT);
    return;
  }

  const ps = spawn('powershell', [
    '-ExecutionPolicy', 'Bypass',
    '-File', MONITOR_SCRIPT
  ], { windowsHide: true });

  let output = '';
  ps.stdout.on('data', (data) => { output += data.toString(); });

  ps.on('close', async (code) => {
    if (code === 0) {
      try {
        const result = JSON.parse(output);
        const settings = getSettings();
        const _db = getDb();
        
        let shouldLog = false;
        let logApp = result.appName || '不明なアプリ';
        let logWindow = result.windowTitle || '';

        if (result.idleSeconds >= settings.idleThreshold) {
          // 無操作の時は記録をスキップ
          shouldLog = false;
        } else if (result.appName && result.appName !== 'None') {
          shouldLog = true;
        }

        if (shouldLog) {
          _db.prepare(
            'INSERT INTO logs (appName, windowTitle, timestamp) VALUES (?, ?, ?)'
          ).run(logApp, logWindow, result.timestamp);
          
          console.log('[%s] Logged: %s (%s)', 
            result.timestamp, 
            logApp, 
            logWindow ? (logWindow.substring(0, 30) + (logWindow.length > 30 ? '...' : '')) : ''
          );
        } else {
          console.log('[%s] Skipped (idle=%ds)', 
            result.timestamp || new Date().toISOString(),
            result.idleSeconds || 0
          );
        }
      } catch (err) {
        console.log('[Collector] Error processing batch:', err.message);
      }
    } else {
      console.log('[Collector] PowerShell script exited with code:', code);
    }

    // Schedule next run
    const settings = getSettings();
    const elapsed = Date.now() - startTime;
    const waitTime = Math.max(0, settings.interval - elapsed);
    console.log('[Collector] Next sample in %ds', (waitTime / 1000).toFixed(1));
    setTimeout(collect, waitTime);
  });
}

console.log('[Collector] Background agent started. DB: %s', DB_PATH);
collect();

