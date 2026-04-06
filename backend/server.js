const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { stringify } = require('csv-stringify');

const app = express();
const PORT = 3001;
const DB_PATH = process.env.DB_PATH || path.join(process.env.APPDATA, 'workloggerapp', 'logs.db');

// Ensure database directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

app.use(cors({ origin: '*' }));
app.use(express.json());

let db;
try {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  // Initialize database
  db.exec(`
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      appName TEXT,
      windowTitle TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  // Default interval: 30s (if not set)
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('sampling_interval', '30');
  console.log('[Server] Database initialized (Better-SQLite3, WAL mode) at: %s', DB_PATH);
} catch (err) {
  console.error('[Server] Database initialization failed:', err);
}

// Logging middleware
app.use((req, res, next) => {
  console.log(`[Server] ${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

app.get('/api/stats', (req, res) => {
  try {
    const stats = db.prepare(`
      SELECT appName, COUNT(*) as count 
      FROM logs 
      WHERE date(timestamp) = date('now', 'localtime')
      GROUP BY appName 
      ORDER BY count DESC
    `).all();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/logs', (req, res) => {
  try {
    const logs = db.prepare('SELECT * FROM logs ORDER BY timestamp DESC LIMIT 100').all();
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/settings', (req, res) => {
  try {
    const settings = db.prepare('SELECT * FROM settings').all();
    const settingsObj = settings.reduce((acc, curr) => ({ ...acc, [curr.key]: curr.value }), {});
    res.json(settingsObj);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings', (req, res) => {
  try {
    const { key, value } = req.body;
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value.toString());
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/export', (req, res) => {
  try {
    const logs = db.prepare('SELECT timestamp, appName, windowTitle FROM logs ORDER BY timestamp DESC').all();
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="work_logs.csv"');

    stringify(logs, {
      header: true,
      columns: {
        timestamp: '日時',
        appName: 'アプリ名',
        windowTitle: 'ウィンドウタイトル'
      }
    }).pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[Server] WorkPulse API listening on http://127.0.0.1:${PORT}`);
});

