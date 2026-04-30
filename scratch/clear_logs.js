const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(process.env.APPDATA, 'workloggerapp', 'logs.db');
const db = new Database(DB_PATH);

try {
  const result = db.prepare('DELETE FROM logs').run();
  console.log(`Successfully deleted ${result.changes} logs.`);
  // 統計の整合性を保つためにVACUUM実行
  db.prepare('VACUUM').run();
} catch (err) {
  console.error('Error clearing logs:', err.message);
} finally {
  db.close();
}
