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
    CREATE TABLE IF NOT EXISTS keyword_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT UNIQUE,
      alias TEXT,
      color TEXT,
      match_type TEXT DEFAULT 'contains',
      case_sensitive INTEGER DEFAULT 0
    );
  `);

  // Add columns if they don't exist
  try { db.prepare("ALTER TABLE logs ADD COLUMN alias TEXT").run(); } catch(e) {}
  try { db.prepare("ALTER TABLE keyword_aliases ADD COLUMN match_type TEXT DEFAULT 'contains'").run(); } catch(e) {}
  try { db.prepare("ALTER TABLE keyword_aliases ADD COLUMN case_sensitive INTEGER DEFAULT 0").run(); } catch(e) {}
  try { db.prepare("ALTER TABLE keyword_aliases ADD COLUMN color TEXT").run(); } catch(e) {}

  // Default settings
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('sampling_interval', '30');
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('record_idle', 'true');
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('idle_threshold', '300');
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('default_activity_color', '#6366f1');
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
    const groupCol = (groupBy === 'windowTitle') ? 'COALESCE(alias, windowTitle)' : 'appName';
    
    let query = `SELECT ${groupCol} AS name, COUNT(*) AS count FROM logs`;
    let params = [];

    if (startDate && endDate) {
      query += ` WHERE date(timestamp, 'localtime') BETWEEN ? AND ? `;
      params.push(startDate, endDate);
    } else {
      query += ` WHERE date(timestamp, 'localtime') = date('now', 'localtime') `;
    }

    query += ` GROUP BY name ORDER BY count DESC `;
    
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
    let query = "SELECT id, appName, windowTitle, alias, datetime(timestamp, 'localtime') as timestamp FROM logs";
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

// Alias APIs
app.get('/api/aliases', (req, res) => {
  try {
    const aliases = db.prepare('SELECT * FROM keyword_aliases').all();
    res.json(aliases);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function applyAliasToPastLogs(db, keyword, alias, matchType, caseSensitive) {
  const logs = db.prepare('SELECT id, windowTitle FROM logs WHERE windowTitle IS NOT NULL').all();
  let updatedCount = 0;
  
  const kw = caseSensitive ? keyword : keyword.toLowerCase();
  const updateStmt = db.prepare('UPDATE logs SET alias = ? WHERE id = ?');
  
  db.transaction(() => {
    for (const log of logs) {
      let target = log.windowTitle;
      if (!caseSensitive) target = target.toLowerCase();
      
      let isMatch = false;
      if (matchType === 'starts_with') {
        isMatch = target.startsWith(kw);
      } else if (matchType === 'exact') {
        isMatch = target === kw;
      } else {
        isMatch = target.includes(kw);
      }
      
      if (isMatch) {
        updateStmt.run(alias, log.id);
        updatedCount++;
      }
    }
  })();
  return updatedCount;
}

app.post('/api/aliases', (req, res) => {
  try {
    const { keyword, alias, color, applyToPast, matchType = 'contains', caseSensitive = false } = req.body;
    db.prepare('INSERT OR REPLACE INTO keyword_aliases (keyword, alias, color, match_type, case_sensitive) VALUES (?, ?, ?, ?, ?)').run(keyword, alias, color, matchType, caseSensitive ? 1 : 0);
    
    let updatedCount = 0;
    if (applyToPast) {
      updatedCount = applyAliasToPastLogs(db, keyword, alias, matchType, caseSensitive);
    }

    res.json({ success: true, updatedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/window-titles', (req, res) => {
  try {
    const titles = db.prepare("SELECT windowTitle FROM logs WHERE windowTitle IS NOT NULL GROUP BY windowTitle ORDER BY MAX(timestamp) DESC LIMIT 500").all();
    res.json(titles.map(t => t.windowTitle));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/aliases/:id', (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM keyword_aliases WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/aliases/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { keyword, alias, color, applyToPast, matchType = 'contains', caseSensitive = false } = req.body;
    db.prepare('UPDATE keyword_aliases SET keyword = ?, alias = ?, color = ?, match_type = ?, case_sensitive = ? WHERE id = ?').run(keyword, alias, color, matchType, caseSensitive ? 1 : 0, id);

    let updatedCount = 0;
    if (applyToPast) {
      updatedCount = applyAliasToPastLogs(db, keyword, alias, matchType, caseSensitive);
    }

    res.json({ success: true, updatedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/export', (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let query = "SELECT datetime(timestamp, 'localtime') as timestamp, appName, windowTitle, alias FROM logs";
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
        windowTitle: 'ウィンドウタイトル',
        alias: 'エイリアス'
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
          COALESCE(alias, windowTitle) as groupWindow,
          alias,
          MAX(windowTitle) as origTitle,
          COUNT(*) as taskCount
        FROM logs
        ${whereClause}
        GROUP BY logDate, hour, minute, appName, groupWindow
      ),
      RankedBuckets AS (
        SELECT 
          b.logDate, b.hour, b.minute, b.appName, b.groupWindow, b.alias, b.origTitle, b.taskCount,
          SUM(b.taskCount) OVER(PARTITION BY b.logDate, b.hour, b.minute) as totalCount,
          ROW_NUMBER() OVER(PARTITION BY b.logDate, b.hour, b.minute ORDER BY b.taskCount DESC) as rank,
          (SELECT color FROM keyword_aliases WHERE alias = b.alias LIMIT 1) as color
        FROM BucketCounts b
      )
      SELECT logDate, hour, minute, appName as topApp, 
             CASE WHEN alias IS NOT NULL THEN alias || ' (' || origTitle || ')' ELSE groupWindow END as topWindow, 
             taskCount, totalCount as count, color
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

