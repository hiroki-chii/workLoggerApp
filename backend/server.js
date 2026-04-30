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
  // Default settings
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('sampling_interval', '30');
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('record_idle', 'true');
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('idle_threshold', '300');
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
    const { startDate, endDate, groupBy } = req.query;
    // デフォルトは appName
    const groupCol = (groupBy === 'windowTitle') ? 'windowTitle' : 'appName';
    
    let query = `SELECT ${groupCol} AS name, COUNT(*) AS count FROM logs`;
    let params = [];

    if (startDate && endDate) {
      query += ` WHERE date(timestamp, 'localtime') BETWEEN ? AND ? `;
      params.push(startDate, endDate);
    } else {
      query += ` WHERE date(timestamp, 'localtime') = date('now', 'localtime') `;
    }

    query += ` GROUP BY ${groupCol} ORDER BY count DESC `;
    
    console.log(`[Server] Stats query: ${query} with params: ${params}`);
    
    const stats = db.prepare(query).all(...params);
    res.json(stats);
  } catch (err) {
    console.error('[Server] Stats error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/logs', (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let query = "SELECT id, appName, windowTitle, datetime(timestamp, 'localtime') as timestamp FROM logs";
    let params = [];

    if (startDate && endDate) {
      query += " WHERE date(timestamp, 'localtime') BETWEEN ? AND ? ";
      params.push(startDate, endDate);
    }

    query += ' ORDER BY timestamp DESC LIMIT 100';
    const logs = db.prepare(query).all(...params);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/logs/clear', (req, res) => {
  try {
    const result = db.prepare('DELETE FROM logs').run();
    db.prepare('VACUUM').run();
    res.json({ success: true, deleted: result.changes });
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
    const { startDate, endDate } = req.query;
    let query = "SELECT datetime(timestamp, 'localtime') as timestamp, appName, windowTitle FROM logs";
    let params = [];

    if (startDate && endDate) {
      query += " WHERE date(timestamp, 'localtime') BETWEEN ? AND ? ";
      params.push(startDate, endDate);
    }

    query += ' ORDER BY timestamp DESC';
    const logs = db.prepare(query).all(...params);
    
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

app.get('/api/heatmap', (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let whereClause = "";
    let params = [];
    if (startDate && endDate) {
      whereClause = ` WHERE date(timestamp, 'localtime') BETWEEN ? AND ? `;
      params.push(startDate, endDate);
    } else {
      whereClause = ` WHERE date(timestamp, 'localtime') = date('now', 'localtime') `;
    }

    // 各(時間枠, アプリ, ウィンドウ)の組み合わせでカウントし、時間枠ごとに最大のものを抽出
    const query = `
      WITH BucketCounts AS (
        SELECT 
          date(timestamp, 'localtime') as logDate,
          strftime('%H', timestamp, 'localtime') as hour,
          (strftime('%M', timestamp, 'localtime') / 15) * 15 as minute,
          appName,
          windowTitle,
          COUNT(*) as taskCount
        FROM logs
        ${whereClause}
        GROUP BY logDate, hour, minute, appName, windowTitle
      ),
      RankedBuckets AS (
        SELECT 
          logDate, hour, minute, appName, windowTitle, taskCount,
          SUM(taskCount) OVER(PARTITION BY logDate, hour, minute) as totalCount,
          ROW_NUMBER() OVER(PARTITION BY logDate, hour, minute ORDER BY taskCount DESC) as rank
        FROM BucketCounts
      )
      SELECT logDate, hour, minute, appName as topApp, windowTitle as topWindow, taskCount, totalCount as count
      FROM RankedBuckets
      WHERE rank = 1
    `;
    
    const data = db.prepare(query).all(...params);
    res.json(data);
  } catch (err) {
    console.error('[Server] Heatmap error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[Server] WorkPulse API listening on http://127.0.0.1:${PORT}`);
});

