export class DesktopFeatureUnavailableError extends Error {
  constructor(feature, runtime) {
    super(`${runtime} adapter does not implement ${feature} yet.`);
    this.name = 'DesktopFeatureUnavailableError';
    this.code = 'DESKTOP_FEATURE_UNAVAILABLE';
  }
}

export class UnavailableDesktopApi {
  constructor(runtime = 'Desktop') {
    this.runtime = runtime;
  }

  unavailable(feature) {
    return Promise.reject(new DesktopFeatureUnavailableError(feature, this.runtime));
  }

  notifyAppChanged() {}

  onAppChanged() {
    return () => {};
  }

  confirm() {
    return Promise.resolve(null);
  }
}

for (const method of [
  'getSettings', 'getWindowRules', 'getWindowTitles', 'getActivityStatistics',
  'getActivityHistory', 'getHeatmap', 'getFatigue', 'getStatus',
  'getActivityBreakdown', 'updateSettings', 'controlPomodoro',
  'clearActivityHistory', 'resetFatigue', 'createWindowRule',
  'updateWindowRule', 'deleteWindowRule', 'getHistoryExportUrl',
  'getTimetableExportUrl', 'getRecordingStatus', 'startRecording',
  'stopRecording', 'showMiniWindow', 'showMainWindow', 'quitApplication'
]) {
  UnavailableDesktopApi.prototype[method] = function unavailableMethod() {
    return this.unavailable(method);
  };
}
