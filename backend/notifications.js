// Owned by the API process: hidden/reloaded renderers cannot suppress or duplicate alerts.
class NotificationTracker {
  constructor() {
    this.previousStatus = null;
    this.previousPomodoro = null;
  }

  update({ fatigue, settings }) {
    const messages = [];
    if (fatigue.statusName === 'Critical' && this.previousStatus !== 'Critical'
        && settings.enable_fatigue_alert === 'true') {
      messages.push('長時間の作業お疲れ様です。そろそろ休憩を取りませんか？');
    }
    this.previousStatus = fatigue.statusName;
    const current = fatigue.pomodoro;
    const previous = this.previousPomodoro;
    if (current?.status === 'running' && previous?.status === 'running'
        && current.mode === previous.mode && current.phaseSequence > previous.phaseSequence) {
      messages.push(current.phase === 'work'
        ? `【作業開始】\n\n${current.workMin}分間の集中タイムです。頑張りましょう！`
        : `【休憩時間】\n\n${current.breakMin}分間の休憩です。リラックスしてください。`);
    }
    this.previousPomodoro = current;
    return messages;
  }
}

function startNotifications(readActivity, notify, onError = console.error) {
  const tracker = new NotificationTracker();
  let timer;
  let stopped = false;
  function refresh() {
    clearTimeout(timer);
    if (stopped) return;
    let delay = 10000;
    try {
      const state = readActivity();
      for (const message of tracker.update(state)) notify(message);
      const pomodoro = state.fatigue.pomodoro;
      if (pomodoro?.status === 'running') {
        delay = Math.min(delay, Math.max(100, pomodoro.deadlineMs - Date.now() + 20));
      }
    } catch (error) {
      onError(error);
    }
    timer = setTimeout(refresh, delay);
    timer.unref();
  }
  refresh();
  return { refresh, stop() { stopped = true; clearTimeout(timer); } };
}

module.exports = { NotificationTracker, startNotifications };
