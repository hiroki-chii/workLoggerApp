import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { UnavailableDesktopApi } from './unavailable.js';

export class TauriDesktopApi extends UnavailableDesktopApi {
  constructor() {
    super('Tauri');
  }

  getSettings() { return invoke('get_settings'); }
  getWindowRules() { return invoke('get_window_rules'); }
  getWindowTitles() { return invoke('get_window_titles'); }
  getActivityStatistics({ startDate, endDate, groupBy }) {
    return invoke('get_activity_statistics', { startDate, endDate, groupBy });
  }
  getActivityHistory() { return invoke('get_activity_history'); }
  getHistoryCsv({ startDate, endDate }) {
    return invoke('get_history_csv', { startDate, endDate });
  }
  getTimetableCsv({ startDate, endDate }) {
    return invoke('get_timetable_csv', { startDate, endDate });
  }
  async getHistoryExportUrl(range = {}) {
    return this.csvUrl(await this.getHistoryCsv(range));
  }
  async getTimetableExportUrl(range = {}) {
    return this.csvUrl(await this.getTimetableCsv(range));
  }
  getHeatmap({ startDate, endDate }) { return invoke('get_heatmap', { startDate, endDate }); }
  getFatigue() { return invoke('get_fatigue'); }
  getStatus() { return invoke('get_status'); }
  getRecordingStatus() { return invoke('get_recording_status'); }
  startRecording() { return invoke('start_recording'); }
  stopRecording() { return invoke('stop_recording'); }
  updateSettings(settings) { return invoke('update_settings', { settings }); }
  controlPomodoro(action) { return invoke('control_pomodoro', { action }); }
  clearActivityHistory() { return invoke('clear_activity_history'); }
  resetFatigue() { return invoke('reset_fatigue'); }
  createWindowRule(rule) { return invoke('create_window_rule', { rule }); }
  updateWindowRule(id, rule) { return invoke('update_window_rule', { id, rule }); }
  deleteWindowRule(id) { return invoke('delete_window_rule', { id }); }
  showMiniWindow() { return invoke('show_mini_window'); }
  showMainWindow() { return invoke('show_main_window'); }
  quitApplication() { return invoke('quit_application'); }
  getActivityBreakdown({ date, hour, minute }) {
    return invoke('get_activity_breakdown', { date, hour, minute });
  }

  csvUrl(csv) {
    return URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  }

  notifyAppChanged() {
    invoke('notify_app_changed').catch(() => {});
  }

  onAppChanged(listener) {
    let disposed = false;
    let unlisten;
    listen('activity-updated', () => listener())
      .then((dispose) => {
        if (disposed) dispose(); else unlisten = dispose;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }
}
