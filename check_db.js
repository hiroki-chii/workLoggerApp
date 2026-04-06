const Database = require('better-sqlite3');

function check() {
  const db = new Database('C:/Users/hirok/AppData/Roaming/workloggerapp/logs.db');
  
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log('Tables:', tables);
  
  const dateNow = db.prepare("SELECT date('now', 'localtime') as d").get();
  console.log('Today is (SQLite):', dateNow.d);
  
  const statsQuery = `
    SELECT appName, COUNT(*) as count 
    FROM logs 
    WHERE date(timestamp) = date('now', 'localtime')
    GROUP BY appName
  `;
  const stats = db.prepare(statsQuery).all();
  console.log('Stats query results:', stats);

  db.close();
}

try {
  check();
} catch (err) {
  console.error(err);
}
