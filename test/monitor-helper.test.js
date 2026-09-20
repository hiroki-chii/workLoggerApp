const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

test('PowerShell monitor serves multiple samples from one process', {
  skip: process.platform !== 'win32', timeout: 20000
}, async () => {
  const script = path.join(__dirname, '..', 'backend', 'monitor.ps1');
  const child = spawn('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script
  ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const stderr = [];
  child.stderr.on('data', data => stderr.push(data.toString()));
  const lines = readline.createInterface({ input: child.stdout });
  const results = [];
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(stderr.join('') || `exit ${code}`)));
    lines.on('line', line => {
      results.push(JSON.parse(line.replace(/^\uFEFF/, '')));
      if (results.length === 2) child.stdin.end();
    });
  });
  child.stdin.write('sample\n');
  child.stdin.write('sample\n');
  await done;
  assert.equal(results.length, 2);
  assert.equal(typeof results[0].idleSeconds, 'number');
  assert.equal(typeof results[0].timestamp, 'string');
});
