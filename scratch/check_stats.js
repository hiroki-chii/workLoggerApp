const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(process.env.APPDATA, 'workloggerapp', 'logs.db');
const db = new Database(DB_PATH);

const groupBy = 'appName';
const groupCol = (groupBy === 'windowTitle') ? 'windowTitle' : 'appName';

let query = `
  SELECT ${groupCol} as name, COUNT(*) as count 
  FROM logs 
  GROUP BY ${groupCol} ORDER BY count DESC
`;

const stats = db.prepare(query).all();
console.log(JSON.stringify(stats, null, 2));
db.close();
