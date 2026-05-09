// ステータスに応じた色を返すヘルパー
export const getStatusColor = (statusName) => {
  if (statusName === 'Critical') return '#ef4444';
  if (statusName === 'Strained') return '#f97316';
  return '#10b981';
};

// ステータスに応じたテキスト色を返すヘルパー
export const getStatusTextColor = (statusName) => {
  if (statusName === 'Critical') return '#f87171';
  if (statusName === 'Strained') return '#fb923c';
  return '#34d399';
};

// ステータスに応じた背景・ボーダー色を返すヘルパー
export const getStatusTheme = (statusName) => {
  if (statusName === 'Critical') return {
    bg: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.2)',
    text: '#f87171'
  };
  if (statusName === 'Strained') return {
    bg: 'rgba(249, 115, 22, 0.1)',
    border: '1px solid rgba(249, 115, 22, 0.2)',
    text: '#fb923c'
  };
  return {
    bg: 'rgba(16, 185, 129, 0.1)',
    border: '1px solid rgba(16, 185, 129, 0.2)',
    text: '#34d399'
  };
};

// プログレスバーの幅を算出するヘルパー
export const calcProgressWidth = (fatigueData, localRemainingSeconds) => {
  if (fatigueData.pomodoro) {
    const phaseMin = fatigueData.pomodoro.phase === 'work'
      ? fatigueData.pomodoro.workMin
      : fatigueData.pomodoro.breakMin;
    const totalSec = phaseMin * 60;
    const remaining = localRemainingSeconds ?? fatigueData.pomodoro.remainingSeconds;
    return `${Math.max(0, Math.min(100, ((totalSec - remaining) / totalSec) * 100))}%`;
  }
  if (fatigueData.statusName === 'Initializing') return 0;
  return `${100 - fatigueData.idleRate}%`;
};

// プログレスバーのグラデーション色を算出するヘルパー
export const calcProgressGradient = (fatigueData) => {
  if (fatigueData.pomodoro) {
    return fatigueData.pomodoro.phase === 'work'
      ? 'linear-gradient(90deg, var(--primary), var(--accent))'
      : 'linear-gradient(90deg, #10b981, #34d399)';
  }
  if (fatigueData.statusName === 'Critical') return 'linear-gradient(90deg, #ef4444, #f87171)';
  if (fatigueData.statusName === 'Strained') return 'linear-gradient(90deg, #f97316, #fb923c)';
  return 'linear-gradient(90deg, #10b981, #34d399)';
};

// stats データのマージ＆ソート共通処理
export const mergeAndSortStats = (rawData, rulesOrNull, truncateFn, maxItems, applyWindowRulesFn) => {
  const merged = {};
  rawData.forEach(stat => {
    const rawName = stat.name || '不明';
    let displayName = rawName;
    let color = null;

    // ウィンドウルールの適用（ルールが渡された場合のみ）
    if (rulesOrNull && applyWindowRulesFn) {
      const ruleResult = applyWindowRulesFn(rawName, rulesOrNull);
      displayName = ruleResult.displayTitle || '不明';
      color = ruleResult.color;
    }

    const truncated = truncateFn(displayName);
    if (!merged[truncated]) {
      merged[truncated] = { name: truncated, count: 0, color };
    }
    merged[truncated].count += stat.count;
  });

  const sorted = Object.values(merged).sort((a, b) => b.count - a.count);
  if (sorted.length > maxItems) {
    const topStats = sorted.slice(0, maxItems - 1);
    const others = sorted.slice(maxItems - 1).reduce((acc, curr) => acc + curr.count, 0);
    topStats.push({ name: 'その他', count: others, color: '#94a3b8' });
    return { items: topStats, totalUnique: Object.keys(merged).length };
  }
  return { items: sorted, totalUnique: Object.keys(merged).length };
};

// Electron IPC を安全に呼び出すヘルパー
export const invokeIpc = async (channel, ...args) => {
  if (window.require) {
    const { ipcRenderer } = window.require('electron');
    return await ipcRenderer.invoke(channel, ...args);
  }
  return null;
};

// ポモドーロの残り時間を表示用にフォーマット
export const formatRemainingTime = (localRemainingSeconds, pomodoroData) => {
  const sec = localRemainingSeconds ?? pomodoroData?.remainingSeconds ?? 0;
  const min = Math.floor(sec / 60);
  const s = (sec % 60).toString().padStart(2, '0');
  return `${min}:${s}`;
};
