export function screenNeeds(mini, tab) {
  return {
    stats: !mini && tab === 'dashboard',
    logs: !mini && tab === 'history',
    heatmap: !mini && tab === 'timetable',
    titles: !mini && tab === 'settings',
    rules: !mini && ['dashboard', 'history', 'timetable', 'settings'].includes(tab)
  };
}

export function createScreenLoader(fetchJson) {
  let cache = {};
  return {
    invalidate() { cache = {}; },
    async load({ mini, tab, params, signal }) {
      const needs = screenNeeds(mini, tab);
      const get = path => fetchJson(path, signal);
      const [settings, rules, titles, statsApps, statsWindows, logs, heatmap, fatigue, status] = await Promise.all([
        cache.settings ?? get('/settings'),
        needs.rules ? cache.rules ?? get('/window-rules') : [],
        needs.titles ? cache.titles ?? get('/window-titles') : [],
        needs.stats ? get(`/stats?${params}&groupBy=appName`) : [],
        needs.stats ? get(`/stats?${params}&groupBy=windowTitle`) : [],
        needs.logs ? get('/logs') : [],
        needs.heatmap ? get(`/heatmap?${params}`) : [],
        get('/fatigue'), get('/status')
      ]);
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      cache.settings = settings;
      if (needs.rules) cache.rules = rules;
      if (needs.titles) cache.titles = titles;
      return { needs, settings, rules, titles, statsApps, statsWindows, logs, heatmap, fatigue, status };
    }
  };
}
