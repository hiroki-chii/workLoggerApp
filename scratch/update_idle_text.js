const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(process.env.APPDATA, 'workloggerapp', 'logs.db');
const db = new Database(DB_PATH);

console.log('Updating existing "無操作" logs to "アイドル状態"...');

const result1 = db.prepare("UPDATE logs SET appName = 'アイドル状態' WHERE appName = '無操作'").run();
const result2 = db.prepare("UPDATE logs SET windowTitle = 'アイドル状態' WHERE windowTitle = '無操作'").run();

console.log(`Updated ${result1.changes} appName entries and ${result2.changes} windowTitle entries.`);
db.close();
