const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');

function waitForMessage(child, predicate) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    const handler = message => {
      if (predicate(message)) {
        child.off('message', handler);
        resolve(message);
      }
    };
    child.on('message', handler);
  });
}

test('collector reuses its monitor and shuts it down cleanly', { timeout: 25000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worklogger-collector-'));
  const database = path.join(dir, 'logs.db');
  const common = { ...process.env, DB_PATH: database, PORT: '0' };
  const server = fork(path.join(__dirname, '..', 'backend', 'server.js'), [], {
    env: common, stdio: ['ignore', 'ignore', 'inherit', 'ipc']
  });
  let collector;
  try {
    const ready = await waitForMessage(server, message => message.type === 'ready');
    collector = fork(path.join(__dirname, '..', 'backend', 'collector.js'), [], {
      env: {
        ...common, PORT: String(ready.port),
        MONITOR_SCRIPT_PATH: path.join(__dirname, '..', 'backend', 'monitor.ps1')
      },
      stdio: ['ignore', 'ignore', 'inherit', 'ipc']
    });
    const monitor = await waitForMessage(collector, message => message.type === 'monitor-pid' && message.pid);
    const started = Date.now();
    let status;
    while (Date.now() - started < 15000) {
      status = await fetch(`http://127.0.0.1:${ready.port}/api/status`).then(response => response.json());
      if (status.lastUpdate >= started) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(status.lastUpdate >= started, 'collector did not publish a sample');
    const exited = new Promise(resolve => collector.once('exit', resolve));
    collector.send({ type: 'shutdown' });
    await exited;
    collector = null;
    assert.throws(() => process.kill(monitor.pid, 0));
  } finally {
    if (collector) collector.kill();
    const exited = new Promise(resolve => server.once('exit', resolve));
    if (server.connected) server.send({ type: 'shutdown' }); else server.kill();
    await exited;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
