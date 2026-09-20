const { WORKDAY_FILTER } = require('./time-range');

function pomodoroState(settings, now = Date.now()) {
  const match = /^pomodoro(15|25|50)$/.exec(settings.current_mode || '');
  if (!match) return null;
  const workMin = Number(match[1]);
  const breakMin = workMin === 15 ? 3 : workMin === 25 ? 5 : 10;
  const workMs = workMin * 60000;
  const cycleMs = (workMin + breakMin) * 60000;
  const startMs = Number(settings.pomodoro_start_ms) || now;
  const elapsed = Math.max(0, now - startMs);
  const position = elapsed % cycleMs;
  const status = settings.pomodoro_status || 'running';
  const phase = status === 'paused'
    ? (settings.pomodoro_paused_phase || (position < workMs ? 'work' : 'break'))
    : (position < workMs ? 'work' : 'break');
  const remainingMs = status === 'paused'
    ? Math.max(0, Number(settings.pomodoro_remaining_ms) || 0)
    : (phase === 'work' ? workMs : cycleMs) - position;
  return {
    mode: settings.current_mode, phase, status, workMin, breakMin,
    remainingSeconds: Math.ceil(remainingMs / 1000),
    deadlineMs: status === 'running' ? now + remainingMs : null,
    phaseSequence: Math.floor(elapsed / cycleMs) * 2 + (phase === 'break' ? 1 : 0)
  };
}

function createActivityReader(db) {
  const settingsQuery = db.prepare('SELECT key, value FROM settings');
  const dayQuery = db.prepare(`SELECT MIN(timestamp) as startTime, COUNT(*) as activeLogs FROM logs WHERE ${WORKDAY_FILTER}`);
  const windowQuery = db.prepare("SELECT COUNT(*) as count FROM logs WHERE timestamp >= datetime(?, 'unixepoch')");
  return function readActivity(now = Date.now()) {
    const settings = Object.fromEntries(settingsQuery.all().map(row => [row.key, row.value]));
    const logInfo = dayQuery.get();
    const interval = Math.max(1, Number(settings.sampling_interval) || 10);
    const currentMode = settings.current_mode || 'tracking';
    const startTime = logInfo.startTime ? logInfo.startTime.replace(' ', 'T') + 'Z' : null;
    const elapsedSeconds = startTime ? Math.max(0, Math.floor((now - Date.parse(startTime)) / 1000)) : 0;
    let idleRate = 0;
    let statusName = logInfo.activeLogs ? 'Active' : 'Initializing';
    if (currentMode === 'tracking' && logInfo.activeLogs) {
      const seconds = Math.max(1, Number(settings.sliding_window_size) || 90) * 60;
      const active = windowQuery.get(Math.floor(now / 1000) - seconds).count;
      const expected = Math.max(1, Math.floor(seconds / interval));
      idleRate = Math.max(0, Math.min(100, Math.round((expected - active) / expected * 100)));
      statusName = idleRate >= 40 ? 'Restored' : idleRate >= 25 ? 'Calm'
        : idleRate >= 15 ? 'Focused' : idleRate >= 10 ? 'Strained' : 'Critical';
    }
    return {
      settings,
      fatigue: {
        fatigueLevel: currentMode === 'tracking' && logInfo.activeLogs ? 100 - idleRate : 0,
        idleRate, statusName, startTime, elapsedSeconds, activeLogs: logInfo.activeLogs,
        expectedLogs: Math.max(1, Math.floor(elapsedSeconds / interval)),
        currentMode, pomodoro: pomodoroState(settings, now)
      }
    };
  };
}

module.exports = { createActivityReader, pomodoroState };
