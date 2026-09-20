const { spawn } = require('child_process');
const readline = require('readline');
const Database = require('better-sqlite3');
const path = require('path');
const http = require('http');

const DB_PATH = process.env.DB_PATH || path.join(process.env.APPDATA, 'workloggerapp', 'logs.db');
const MONITOR_SCRIPT = process.env.MONITOR_SCRIPT_PATH || path.join(__dirname, 'monitor.ps1');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
const settingsQuery = db.prepare("SELECT value FROM settings WHERE key = 'sampling_interval'");
const insert = db.prepare('INSERT INTO logs (appName, windowTitle, timestamp) VALUES (?, ?, ?)');
let helper = null;
let timer = null;
let timeout = null;
let stopped = false;
let pending = false;
let sampleStarted = 0;
let failures = 0;

function intervalMs() {
  return Math.max(1000, (Number(settingsQuery.get()?.value) || 10) * 1000);
}

function updateStatus(idleSeconds) {
  const body = JSON.stringify({ idleSeconds });
  const req = http.request({
    hostname: '127.0.0.1', port: Number(process.env.PORT) || 3001,
    path: '/api/status', method: 'POST', timeout: 3000,
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, response => response.resume());
  req.on('timeout', () => req.destroy());
  req.on('error', () => {});
  req.end(body);
}

function sample() {
  if (stopped || !helper || pending) return;
  pending = true;
  sampleStarted = Date.now();
  timeout = setTimeout(() => {
    if (helper) helper.kill();
  }, 15000);
  helper.stdin.write('sample\n', error => {
    if (error && helper) helper.kill();
  });
}

function startHelper() {
  if (stopped) return;
  const child = spawn('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', MONITOR_SCRIPT
  ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  helper = child;
  if (process.connected) process.send({ type: 'monitor-pid', pid: child.pid });
  child.stdin.on('error', () => {});
  child.stderr.on('data', data => {
    if (process.env.WORKLOGGER_DEBUG === '1') console.error('[Monitor]', data.toString());
  });
  child.on('error', error => console.error('[Collector]', error.message));
  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', line => {
    if (!pending || stopped) return;
    try {
      const result = JSON.parse(line.replace(/^\uFEFF/, ''));
      if (!Number.isFinite(result.idleSeconds) || typeof result.timestamp !== 'string') {
        throw new Error('Invalid monitor response');
      }
      clearTimeout(timeout);
      pending = false;
      if (result.idleSeconds < 60 && result.appName && result.appName !== 'None') {
        insert.run(result.appName, result.windowTitle || '', result.timestamp);
      }
      updateStatus(result.idleSeconds);
      failures = 0;
      timer = setTimeout(sample, Math.max(1000, intervalMs() - (Date.now() - sampleStarted)));
    } catch (error) {
      console.error('[Collector]', error.message);
      child.kill();
    }
  });
  child.on('close', () => {
    lines.close();
    clearTimeout(timer);
    clearTimeout(timeout);
    pending = false;
    if (helper === child) helper = null;
    if (process.connected) process.send({ type: 'monitor-pid', pid: null });
    if (stopped) {
      db.close();
      process.exit(0);
    } else {
      timer = setTimeout(startHelper, Math.min(60000, 5000 * 2 ** Math.min(failures++, 4)));
    }
  });
  sample();
}

function shutdown() {
  if (stopped) return;
  stopped = true;
  clearTimeout(timer);
  clearTimeout(timeout);
  if (helper) helper.kill();
  else { db.close(); process.exit(0); }
}
process.on('message', message => { if (message?.type === 'shutdown') shutdown(); });
process.on('disconnect', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
startHelper();
