export function screenNeeds(mini, tab) {
  return {
    stats: !mini && tab === 'dashboard',
    logs: !mini && tab === 'history',
    heatmap: !mini && tab === 'timetable',
    titles: !mini && tab === 'settings',
    rules: !mini && ['dashboard', 'history', 'timetable', 'settings'].includes(tab)
  };
}

export function createScreenLoader(desktopApi) {
  let cache = {};
  return {
    invalidate() { cache = {}; },
    async load({ mini, tab, range, signal }) {
      const needs = screenNeeds(mini, tab);
      const [settings, rules, titles, statsApps, statsWindows, logs, heatmap, fatigue, status] = await Promise.all([
        cache.settings ?? desktopApi.getSettings(signal),
        needs.rules ? cache.rules ?? desktopApi.getWindowRules(signal) : [],
        needs.titles ? cache.titles ?? desktopApi.getWindowTitles(signal) : [],
        needs.stats ? desktopApi.getActivityStatistics({ ...range, groupBy: 'appName', signal }) : [],
        needs.stats ? desktopApi.getActivityStatistics({ ...range, groupBy: 'windowTitle', signal }) : [],
        needs.logs ? desktopApi.getActivityHistory(signal) : [],
        needs.heatmap ? desktopApi.getHeatmap({ ...range, signal }) : [],
        desktopApi.getFatigue(signal), desktopApi.getStatus(signal)
      ]);
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      cache.settings = settings;
      if (needs.rules) cache.rules = rules;
      if (needs.titles) cache.titles = titles;
      return { needs, settings, rules, titles, statsApps, statsWindows, logs, heatmap, fatigue, status };
    }
  };
}
