import React, { useEffect, useState } from 'react';
import { calcProgressWidth, calcProgressGradient, formatRemainingTime } from './utils/helpers';

function useRemaining(pomodoro) {
  const [, tick] = useState(0);
  useEffect(() => {
    let timer;
    const sync = () => {
      clearInterval(timer);
      if (!document.hidden && pomodoro?.status === 'running') {
        tick(value => value + 1);
        timer = setInterval(() => tick(value => value + 1), 1000);
      }
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', sync); };
  }, [pomodoro?.status, pomodoro?.deadlineMs]);
  return pomodoro?.status === 'running' && pomodoro.deadlineMs
    ? Math.max(0, Math.ceil((pomodoro.deadlineMs - Date.now()) / 1000))
    : pomodoro?.remainingSeconds ?? 0;
}

export function RemainingTime({ pomodoro }) {
  return <>残り {formatRemainingTime(useRemaining(pomodoro), pomodoro)}</>;
}

export function ActivityProgress({ fatigue, style }) {
  const remaining = useRemaining(fatigue.pomodoro);
  return <div style={{ ...style, width: calcProgressWidth(fatigue, remaining), background: calcProgressGradient(fatigue) }} />;
}
