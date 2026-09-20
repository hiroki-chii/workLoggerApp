import test from 'node:test';
import assert from 'node:assert/strict';
import { createScreenLoader } from '../frontend/src/utils/screen-data.mjs';

test('mini window fetches only lightweight live state', async () => {
  const paths = [];
  const loader = createScreenLoader(async path => {
    paths.push(path);
    if (path === '/settings') return {};
    if (path === '/fatigue') return { statusName: 'Focused' };
    if (path === '/status') return { idleSeconds: 0 };
    return [];
  });
  await loader.load({ mini: true, tab: 'dashboard', params: '', signal: new AbortController().signal });
  assert.deepEqual(paths.sort(), ['/fatigue', '/settings', '/status']);
});

test('dashboard skips log history, heatmap and title scan', async () => {
  const paths = [];
  const loader = createScreenLoader(async path => { paths.push(path); return path === '/settings' ? {} : []; });
  await loader.load({ mini: false, tab: 'dashboard', params: 'startDate=2026-09-20&endDate=2026-09-20', signal: new AbortController().signal });
  assert.equal(paths.includes('/logs'), false);
  assert.equal(paths.some(path => path.startsWith('/heatmap')), false);
  assert.equal(paths.includes('/window-titles'), false);
  assert.equal(paths.filter(path => path.startsWith('/stats')).length, 2);
});
