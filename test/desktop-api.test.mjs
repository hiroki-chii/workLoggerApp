import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopApi } from '../frontend/src/infrastructure/desktop/index.js';

test('Tauri adapter maps write use-cases and synchronization to Rust commands', async () => {
  const calls = [];
  const originalWindow = globalThis.window;
  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke: async (...args) => { calls.push(args); return true; }
    }
  };
  try {
    const adapter = createDesktopApi(globalThis.window);
    await adapter.updateSettings({ sampling_interval: '30' });
    await adapter.controlPomodoro('pause');
    await adapter.createWindowRule({ keyword: 'Code', replace_with: '開発', match_type: 'contains' });
    adapter.notifyAppChanged();
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(calls.map(([command, args]) => [command, args]), [
      ['update_settings', { settings: { sampling_interval: '30' } }],
      ['control_pomodoro', { action: 'pause' }],
      ['create_window_rule', {
        rule: { keyword: 'Code', replace_with: '開発', match_type: 'contains' }
      }],
      ['notify_app_changed', {}]
    ]);
  } finally {
    globalThis.window = originalWindow;
  }
});
