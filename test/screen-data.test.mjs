import test from 'node:test';
import assert from 'node:assert/strict';
import { createScreenLoader } from '../frontend/src/utils/screen-data.mjs';

test('mini window fetches only lightweight live state', async () => {
  const calls = [];
  const loader = createScreenLoader({
    getSettings: () => { calls.push('settings'); return {}; },
    getFatigue: () => { calls.push('fatigue'); return { statusName: 'Focused' }; },
    getStatus: () => { calls.push('status'); return { idleSeconds: 0 }; }
  });
  await loader.load({ mini: true, tab: 'dashboard', range: {}, signal: new AbortController().signal });
  assert.deepEqual(calls.sort(), ['fatigue', 'settings', 'status']);
});

test('dashboard skips log history, heatmap and title scan', async () => {
  const calls = [];
  const loader = createScreenLoader({
    getSettings: () => { calls.push('settings'); return {}; },
    getWindowRules: () => { calls.push('rules'); return []; },
    getActivityStatistics: ({ groupBy }) => { calls.push(`stats:${groupBy}`); return []; },
    getFatigue: () => { calls.push('fatigue'); return {}; },
    getStatus: () => { calls.push('status'); return {}; }
  });
  await loader.load({ mini: false, tab: 'dashboard', range: { startDate: '2026-09-20', endDate: '2026-09-20' }, signal: new AbortController().signal });
  assert.equal(calls.includes('logs'), false);
  assert.equal(calls.includes('heatmap'), false);
  assert.equal(calls.includes('titles'), false);
  assert.deepEqual(calls.filter(call => call.startsWith('stats:')).sort(), ['stats:appName', 'stats:windowTitle']);
});
