const test = require('node:test');
const assert = require('node:assert/strict');
const { pomodoroState } = require('../backend/activity-state');
const { NotificationTracker } = require('../backend/notifications');

test('pomodoro exposes a stable deadline and phase sequence', () => {
  const start = Date.UTC(2026, 8, 20, 0, 0, 0);
  const settings = { current_mode: 'pomodoro25', pomodoro_start_ms: String(start), pomodoro_status: 'running' };
  const work = pomodoroState(settings, start + 24 * 60000);
  assert.equal(work.phase, 'work');
  assert.equal(work.remainingSeconds, 60);
  const rest = pomodoroState(settings, start + 26 * 60000);
  assert.equal(rest.phase, 'break');
  assert.equal(rest.phaseSequence, 1);
  assert.equal(rest.remainingSeconds, 4 * 60);
});

test('paused phase does not advance with wall-clock time', () => {
  const state = pomodoroState({
    current_mode: 'pomodoro25', pomodoro_start_ms: '1', pomodoro_status: 'paused',
    pomodoro_paused_phase: 'break', pomodoro_remaining_ms: '120000'
  }, Date.UTC(2026, 8, 20));
  assert.equal(state.phase, 'break');
  assert.equal(state.remainingSeconds, 120);
  assert.equal(state.deadlineMs, null);
});

test('notification tracker emits each transition once', () => {
  const tracker = new NotificationTracker();
  const settings = { enable_fatigue_alert: 'true' };
  const state = (statusName, phaseSequence, phase = 'work') => ({ settings, fatigue: {
    statusName, pomodoro: { mode: 'pomodoro25', status: 'running', phaseSequence, phase, workMin: 25, breakMin: 5 }
  }});
  assert.equal(tracker.update(state('Focused', 0)).length, 0);
  assert.equal(tracker.update(state('Critical', 0)).length, 1);
  assert.equal(tracker.update(state('Critical', 0)).length, 0);
  assert.equal(tracker.update(state('Critical', 1, 'break')).length, 1);
  assert.equal(tracker.update(state('Critical', 1, 'break')).length, 0);
});
