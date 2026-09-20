const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');

test('API initializes a new database and accepts atomic settings updates', { timeout: 15000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worklogger-api-'));
  const child = fork(path.join(__dirname, '..', 'backend', 'server.js'), [], {
    env: { ...process.env, DB_PATH: path.join(dir, 'logs.db'), PORT: '0' },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc']
  });
  try {
    const port = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.on('message', message => { if (message.type === 'ready') resolve(message.port); });
    });
    const base = `http://127.0.0.1:${port}/api`;
    const update = await fetch(`${base}/settings`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ settings: {
        current_mode: 'pomodoro25', pomodoro_status: 'paused',
        pomodoro_remaining_ms: '1500000', pomodoro_paused_phase: 'work'
      } })
    });
    assert.equal(update.status, 200);
    const fatigue = await fetch(`${base}/fatigue`).then(response => response.json());
    assert.equal(fatigue.pomodoro.status, 'paused');
    assert.equal(fatigue.pomodoro.remainingSeconds, 1500);
    const invalid = await fetch(`${base}/stats?startDate=2026-02-30&endDate=2026-03-01`);
    assert.equal(invalid.status, 500);
  } finally {
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.send({ type: 'shutdown' });
    await exited;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
