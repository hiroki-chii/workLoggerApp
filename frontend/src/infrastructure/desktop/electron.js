const API_BASE = 'http://127.0.0.1:3001/api';

function toQuery(params) {
  return new URLSearchParams(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null)
  ).toString();
}

export class ElectronDesktopApi {
  constructor({ runtime = globalThis.window, fetchImpl = globalThis.fetch } = {}) {
    this.runtime = runtime;
    this.fetchImpl = fetchImpl;
  }

  get ipcRenderer() {
    return this.runtime.require('electron').ipcRenderer;
  }

  async request(path, { method = 'GET', body, signal } = {}) {
    const response = await this.fetchImpl(`${API_BASE}${path}`, {
      method,
      signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    if (!response.ok) throw new Error(`Electron API request failed: ${response.status}`);
    return response.json();
  }

  getSettings(signal) { return this.request('/settings', { signal }); }
  getWindowRules(signal) { return this.request('/window-rules', { signal }); }
  getWindowTitles(signal) { return this.request('/window-titles', { signal }); }
  getActivityStatistics({ startDate, endDate, groupBy, signal }) {
    return this.request(`/stats?${toQuery({ startDate, endDate, groupBy })}`, { signal });
  }
  getActivityHistory(signal) { return this.request('/logs', { signal }); }
  getHeatmap({ startDate, endDate, signal }) {
    return this.request(`/heatmap?${toQuery({ startDate, endDate })}`, { signal });
  }
  getFatigue(signal) { return this.request('/fatigue', { signal }); }
  getStatus(signal) { return this.request('/status', { signal }); }
  getActivityBreakdown({ date, hour, minute, signal }) {
    return this.request(`/logs/breakdown?${toQuery({ date, hour, minute })}`, { signal });
  }
  updateSettings(settings) { return this.request('/settings', { method: 'POST', body: { settings } }); }
  controlPomodoro(action) { return this.request('/pomodoro/control', { method: 'POST', body: { action } }); }
  clearActivityHistory() { return this.request('/logs/clear', { method: 'DELETE' }); }
  resetFatigue() { return this.request('/fatigue/reset', { method: 'POST' }); }
  createWindowRule(rule) { return this.request('/window-rules', { method: 'POST', body: rule }); }
  updateWindowRule(id, rule) { return this.request(`/window-rules/${id}`, { method: 'PUT', body: rule }); }
  deleteWindowRule(id) { return this.request(`/window-rules/${id}`, { method: 'DELETE' }); }
  getHistoryExportUrl({ startDate, endDate } = {}) {
    const query = toQuery({ startDate, endDate });
    return Promise.resolve(`${API_BASE}/export${query ? `?${query}` : ''}`);
  }
  getTimetableExportUrl({ startDate, endDate } = {}) {
    const query = toQuery({ startDate, endDate });
    return Promise.resolve(`${API_BASE}/export/timetable${query ? `?${query}` : ''}`);
  }

  getRecordingStatus() { return this.ipcRenderer.invoke('recording:status'); }
  startRecording() { return this.ipcRenderer.invoke('recording:start'); }
  stopRecording() { return this.ipcRenderer.invoke('recording:stop'); }
  showMiniWindow() { return this.ipcRenderer.invoke('mini-window:open'); }
  showMainWindow() { return this.ipcRenderer.invoke('mini-window:close'); }
  quitApplication() { return this.ipcRenderer.invoke('app:quit-completely'); }
  confirm(options) { return this.ipcRenderer.invoke('alert:confirm', options); }

  notifyAppChanged() {
    this.ipcRenderer.send('window-event:notify', { type: 'sync' });
  }

  onAppChanged(listener) {
    const handle = (_event, message) => {
      if (message?.type === 'sync') listener();
    };
    this.ipcRenderer.on('window-event:received', handle);
    return () => this.ipcRenderer.removeListener('window-event:received', handle);
  }
}
