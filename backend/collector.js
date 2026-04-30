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

function getSettings() {
  try {
    const _db = getDb();
    const rows = _db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    return {
      interval: parseInt(settings.sampling_interval || 30) * 1000,
      recordIdle: settings.record_idle === 'true',
      idleThreshold: parseInt(settings.idle_threshold || 300)
    };
  } catch (err) {
    return { interval: 30000, recordIdle: false, idleThreshold: 300 };
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
        const settings = getSettings();
        const _db = getDb();
        
        let shouldLog = false;
        let logApp = result.appName;
        let logWindow = result.windowTitle;
        let logAlias = null;

        if (result.idleSeconds >= settings.idleThreshold) {
          if (settings.recordIdle) {
            shouldLog = true;
            logApp = '無操作';
            logWindow = '無操作';
          }
        } else if (result.appName && result.appName !== 'None') {
          shouldLog = true;
          // Apply alias if keyword matches
          try {
            const aliases = _db.prepare('SELECT keyword, alias, match_type, case_sensitive FROM keyword_aliases').all();
            for (const item of aliases) {
              let target = logWindow;
              let kw = item.keyword;
              if (!item.case_sensitive) {
                target = target.toLowerCase();
                kw = kw.toLowerCase();
              }
              
              let isMatch = false;
              if (item.match_type === 'starts_with') {
                isMatch = target.startsWith(kw);
              } else if (item.match_type === 'exact') {
                isMatch = target === kw;
              } else {
                isMatch = target.includes(kw);
              }
              
              if (isMatch) {
                logAlias = item.alias;
                break;
              }
            }
          } catch (e) {
            // Table might not exist yet or other DB error
          }
        }

        if (shouldLog) {
          _db.prepare(
            'INSERT INTO logs (appName, windowTitle, alias, timestamp) VALUES (?, ?, ?, ?)'
          ).run(logApp, logWindow, logAlias, result.timestamp);
          
          console.log('[%s] Logged: %s (%s) [Alias: %s]', 
            result.timestamp, 
            logApp, 
            logWindow.substring(0, 30) + (logWindow.length > 30 ? '...' : ''),
            logAlias || 'none'
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
    console.log('[Collector] Next sample in %ds', settings.interval / 1000);
    setTimeout(collect, settings.interval);
  });
}

console.log('[Collector] Background agent started. DB: %s', DB_PATH);
collect();

