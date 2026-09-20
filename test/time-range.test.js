const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { periodFilter } = require('../backend/time-range');

test('period filter validates dates and creates an indexable half-open range', () => {
  assert.deepEqual(periodFilter('2026-09-01', '2026-09-07'), {
    clause: " WHERE timestamp >= datetime(?, 'utc') AND timestamp < datetime(?, '+1 day', 'utc') ",
    params: ['2026-09-01', '2026-09-07']
  });
  assert.throws(() => periodFilter('2026-02-30', '2026-03-01'), /Invalid date/);
  assert.throws(() => periodFilter('2026-09-07', '2026-09-01'), /Invalid date/);
});

test('timestamp range uses the logs index', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE logs(timestamp DATETIME, appName TEXT); CREATE INDEX idx_logs_timestamp ON logs(timestamp)');
  const range = periodFilter('2026-09-01', '2026-09-07');
  const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT appName FROM logs ${range.clause}`).all(...range.params);
  assert.match(plan.map(row => row.detail).join(' '), /USING INDEX idx_logs_timestamp/);
  db.close();
});
