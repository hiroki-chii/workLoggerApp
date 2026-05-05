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

// リアルタイムステータス管理
let currentStatus = {
  idleSeconds: 0,
  lastUpdate: Date.now()
};

app.get('/api/status', (req, res) => {
  res.json(currentStatus);
});

app.post('/api/status', (req, res) => {
  const { idleSeconds } = req.body;
  currentStatus = {
    idleSeconds: parseInt(idleSeconds || 0),
    lastUpdate: Date.now()
  };
  res.json({ success: true });
});

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
    CREATE TABLE IF NOT EXISTS window_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT NOT NULL,
      replace_with TEXT NOT NULL,
      match_type TEXT NOT NULL,
      color TEXT
    );
  `);

  // デフォルト設定（初回のみ挿入、既存値は上書きしない）
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('sampling_interval', '10');
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('idle_threshold', '60');
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('default_activity_color', '#6366f1');
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('show_mini_on_close', 'true');
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('mini_window_position', '右下');
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('show_pet_in_mini', 'true');
  // 既存データがある場合は「右上」を「右下」へ補正
  db.prepare("UPDATE settings SET value = '右下' WHERE key = 'mini_window_position' AND value = '右上'").run();
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

app.get('/api/logs/breakdown', (req, res) => {
  try {
    const { date, hour, minute } = req.query;
    if (!date || hour === undefined || minute === undefined) {
      return res.status(400).json({ error: 'Missing date, hour, or minute' });
    }

    // hour と minute を2桁の文字列に整形
    const hStr = hour.toString().padStart(2, '0');
    const mStart = parseInt(minute);

    const query = `
      SELECT id, appName, windowTitle, datetime(timestamp, 'localtime') as timestamp 
      FROM logs
      WHERE date(timestamp, 'localtime') = ?
        AND strftime('%H', timestamp, 'localtime') = ?
        AND (strftime('%M', timestamp, 'localtime') / 15) * 15 = ?
      ORDER BY timestamp ASC
    `;
    const logs = db.prepare(query).all(date, hStr, mStart);
    res.json(logs);
  } catch (err) {
    console.error('[Server] Breakdown error:', err);
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

app.get('/api/fatigue', (req, res) => {
  try {
    const logInfo = db.prepare(`
      SELECT 
        MIN(timestamp) as startTime, 
        COUNT(*) as activeLogs 
      FROM logs 
      WHERE date(timestamp, 'localtime') = date('now', 'localtime')
    `).get();

    if (!logInfo || !logInfo.startTime || logInfo.activeLogs === 0) {
      return res.json({
        fatigueLevel: 0,
        idleRate: 0,
        statusName: 'Initializing',
        startTime: null,
        elapsedSeconds: 0,
        activeLogs: 0,
        expectedLogs: 0
      });
    }

    const startTimeISO = logInfo.startTime.replace(' ', 'T') + 'Z';
    const startMs = new Date(startTimeISO).getTime();
    const nowMs = Date.now();
    const elapsedSeconds = Math.max(0, Math.floor((nowMs - startMs) / 1000));

    // 2. 直近90分間のスライディングウィンドウ
    const windowStartMs = nowMs - 90 * 60 * 1000;
    const startTimeInWindowMs = Math.max(startMs, windowStartMs);
    const elapsedInWindowSeconds = Math.max(0, Math.floor((nowMs - startTimeInWindowMs) / 1000));

    // 直近90分間かつ本日分の有効ログ数を取得
    const windowActiveLogsObj = db.prepare(`
      SELECT COUNT(*) as activeLogsInWindow
      FROM logs
      WHERE date(timestamp, 'localtime') = date('now', 'localtime')
        AND timestamp >= datetime('now', '-90 minutes')
    `).get();

    const activeLogsInWindow = windowActiveLogsObj ? windowActiveLogsObj.activeLogsInWindow : 0;
    const samplingInterval = 11;
    // スライディングウィンドウを常に90分(5400秒)として計算する。
    // これにより、起動直後や30分経過時点などでも、過去90分のうちアプリ未起動の時間は「アイドル(休憩)」として扱われます。
    const expectedLogsInWindow = Math.max(1, Math.floor(5400 / samplingInterval));


    // ウィンドウ内アイドル率を計算
    const idleRatePercent = Math.max(0, Math.min(100, Math.round(((expectedLogsInWindow - activeLogsInWindow) / expectedLogsInWindow) * 100)));

    let statusName = 'Critical';
    if (idleRatePercent >= 40) {
      statusName = 'Restored';
    } else if (idleRatePercent >= 25) {
      statusName = 'Calm';
    } else if (idleRatePercent >= 15) {
      statusName = 'Focused';
    } else if (idleRatePercent >= 10) {
      statusName = 'Strained';
    } else {
      statusName = 'Critical';
    }

    // 疲労度 = 100 - アイドル率 (%)
    const fatigueLevel = Math.max(0, Math.min(100, 100 - idleRatePercent));

    res.json({
      fatigueLevel,
      idleRate: idleRatePercent,
      statusName,
      startTime: startTimeISO,
      elapsedSeconds,
      activeLogs: logInfo.activeLogs,
      expectedLogs: Math.max(1, Math.floor(elapsedSeconds / samplingInterval))
    });
  } catch (err) {
    console.error('[Server] Fatigue error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/fatigue/reset', (req, res) => {
  try {
    db.prepare("DELETE FROM logs WHERE date(timestamp, 'localtime') = date('now', 'localtime')").run();
    res.json({ success: true });
  } catch (err) {
    console.error('[Server] Reset fatigue error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/debug-db', (req, res) => {
  try {
    const logs = db.prepare("SELECT timestamp FROM logs ORDER BY timestamp DESC LIMIT 20").all();
    const matchCount = db.prepare("SELECT COUNT(*) as c FROM logs WHERE date(timestamp, 'localtime') = date('now', 'localtime')").get().c;
    res.json({ logs, matchCount });
  } catch (err) {
    res.json({ error: err.message });
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

app.get('/api/window-titles', (req, res) => {
  try {
    const titles = db.prepare(`
      SELECT windowTitle 
      FROM logs 
      WHERE windowTitle IS NOT NULL 
        AND windowTitle NOT IN ('アイドル状態', '無操作')
      GROUP BY windowTitle 
      ORDER BY MAX(timestamp) DESC 
      LIMIT 500
    `).all();
    res.json(titles.map(t => t.windowTitle));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Window Rules APIs
app.get('/api/window-rules', (req, res) => {
  try {
    const rules = db.prepare('SELECT * FROM window_rules ORDER BY id DESC').all();
    res.json(rules);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/window-rules', (req, res) => {
  try {
    const { keyword, replace_with, match_type, color } = req.body;
    if (!keyword || !replace_with || !match_type) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const result = db.prepare('INSERT INTO window_rules (keyword, replace_with, match_type, color) VALUES (?, ?, ?, ?)').run(keyword, replace_with, match_type, color || null);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/window-rules/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { keyword, replace_with, match_type, color } = req.body;
    if (!keyword || !replace_with || !match_type) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    db.prepare('UPDATE window_rules SET keyword = ?, replace_with = ?, match_type = ?, color = ? WHERE id = ?').run(keyword, replace_with, match_type, color || null, id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/window-rules/:id', (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM window_rules WHERE id = ?').run(id);
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
          windowTitle as groupWindow,
          COUNT(*) as taskCount
        FROM logs
        ${whereClause}
        GROUP BY logDate, hour, minute, appName, groupWindow
      ),
      RankedBuckets AS (
        SELECT 
          b.logDate, b.hour, b.minute, b.appName, b.groupWindow, b.taskCount,
          SUM(b.taskCount) OVER(PARTITION BY b.logDate, b.hour, b.minute) as totalCount,
          ROW_NUMBER() OVER(PARTITION BY b.logDate, b.hour, b.minute ORDER BY b.taskCount DESC) as rank
        FROM BucketCounts b
      )
      SELECT logDate, hour, minute, appName as topApp, groupWindow as topWindow, 
             taskCount, totalCount as count
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

