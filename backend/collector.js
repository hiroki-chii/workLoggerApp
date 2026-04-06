const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(process.env.APPDATA, 'workloggerapp', 'logs.db');
const MONITOR_SCRIPT = process.env.MONITOR_SCRIPT_PATH || path.join(__dirname, 'monitor.ps1');
const IDLE_THRESHOLD_SECONDS = 300;

let db;
function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
  }
  return db;
}

function getInterval() {
  try {
    const _db = getDb();
    const setting = _db.prepare('SELECT value FROM settings WHERE key = ?').get('sampling_interval');
    const val = setting ? parseInt(setting.value) : 30; // Default 30s
    return val * 1000;
  } catch (err) {
    console.log('[Collector] Settings read failed, defaulting to 30s');
    return 30000;
  }
}

async function collect() {
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
        if (result.appName && result.appName !== 'None' && result.idleSeconds < IDLE_THRESHOLD_SECONDS) {
          const _db = getDb();
          _db.prepare(
            'INSERT INTO logs (appName, windowTitle, timestamp) VALUES (?, ?, ?)'
          ).run(result.appName, result.windowTitle, result.timestamp);
          
          console.log('[%s] Logged: %s (%s)', 
            result.timestamp, 
            result.appName, 
            result.windowTitle.substring(0, 30) + (result.windowTitle.length > 30 ? '...' : '')
          );
        } else {
          console.log('[%s] Skipped: %s (idle=%ds)', 
            result.timestamp || new Date().toISOString().replace('T', ' ').slice(0, 19), 
            result.appName || 'None', 
            result.idleSeconds || 0);
        }
      } catch (err) {
        console.log('[Collector] Error processing batch:', err.message);
      }
    } else {
      console.log('[Collector] PowerShell script exited with code:', code);
    }

    // Schedule next run
    const nextInterval = getInterval();
    console.log('[Collector] Next sample in %ds', nextInterval / 1000);
    setTimeout(collect, nextInterval);
  });
}

console.log('[Collector] Background agent started. DB: %s', DB_PATH);
collect();

