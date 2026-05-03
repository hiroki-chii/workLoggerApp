import React, { useState, useEffect, useRef } from 'react';
import {
  LayoutDashboard,
  History,
  Settings,
  Download,
  Activity,
  Clock,
  Calendar,
  PieChart,
  List,
  LayoutGrid,

  RefreshCw,
  Play,
  Square,
  Sun,
  Moon,
  Monitor,
  Trash2,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,

  HelpCircle,
  X,
  Edit2
} from 'lucide-react';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend
} from 'chart.js';
import { Pie } from 'react-chartjs-2';
import { useTheme } from './ThemeProvider';

ChartJS.register(ArcElement, Tooltip, Legend);

const API_BASE = 'http://127.0.0.1:3001/api';

// 当日の週の日曜日から土曜日までの範囲を計算
const getWeekRange = () => {
  const now = new Date();
  const day = now.getDay(); // 0:日, 1:月, ... 6:土
  const start = new Date(now);
  start.setDate(now.getDate() - day);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return {
    start: start.toLocaleDateString('sv-SE'),
    end: end.toLocaleDateString('sv-SE')
  };
};

const parseStartTime = (str) => {
  if (!str) return '記録なし';
  try {
    let parsedStr = str;
    if (!str.includes('T')) {
      parsedStr = str.replace(' ', 'T');
    }
    if (!parsedStr.includes('Z') && !parsedStr.includes('+')) {
      parsedStr += 'Z';
    }
    const d = new Date(parsedStr);
    return isNaN(d.getTime()) ? '記録なし' : d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  } catch (err) {
    return '記録なし';
  }
};


// ウィンドウ名置換ルールの適用関数
const applyWindowRules = (title, rules = []) => {
  if (!title || title === 'アイドル状態' || title === '無操作') return { displayTitle: title, originalTitle: title, isReplaced: false, color: null };

  for (const rule of rules) {
    let match = false;
    if (rule.match_type === 'exact') match = title === rule.keyword;
    else if (rule.match_type === 'startsWith') match = title.startsWith(rule.keyword);
    else match = title.includes(rule.keyword); // contains

    if (match) {
      return { displayTitle: rule.replace_with, originalTitle: title, isReplaced: true, color: rule.color };
    }
  }
  return { displayTitle: title, originalTitle: title, isReplaced: false, color: null };
};

// ウィンドウタイトル表示用の共通ヘルパー
const renderWindowTitle = (log) => {
  if (log.isReplaced) {
    return (
      <>
        <span style={{ color: log.color || 'var(--primary)', fontWeight: '600', marginRight: '8px' }}>{log.displayTitle}</span>
        <span style={{ color: '#94a3b8', fontSize: '0.85em' }} title={log.originalTitle}>({log.originalTitle})</span>
      </>
    );
  }
  return <span title={log.displayTitle}>{log.displayTitle}</span>;
};

const formatNumberWithSuffix = (num) => {
  if (num === undefined || num === null) return '0';
  if (num <= 999) return num.toString();

  const units = ['K', 'M', 'G', 'T'];
  let value = num;
  let unit = '';

  for (const u of units) {
    value /= 1000;
    unit = u;
    if (value <= 999) break;
  }

  const ceiled = Math.ceil(value * 10) / 10;
  return `${ceiled.toFixed(1)}${unit}`;
};

function App() {
  const [stats, setStats] = useState([]);
  const [totalAppsCount, setTotalAppsCount] = useState(0);
  const [totalWindowsCount, setTotalWindowsCount] = useState(0);
  const [heatmapData, setHeatmapData] = useState([]);
  const [logs, setLogs] = useState([]);
  const [settings, setSettings] = useState({ sampling_interval: '10', default_activity_color: '#6366f1' });
  const [windowTitles, setWindowTitles] = useState([]);
  const [fatigueData, setFatigueData] = useState({
    fatigueLevel: 0,
    idleRate: 100,
    statusName: 'Chill',
    startTime: null,
    elapsedSeconds: 0,
    activeLogs: 0,
    expectedLogs: 0
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const timetableContainerRef = useRef(null);
  const prevStatusRef = useRef(null);
  const lastAlertTimeRef = useRef(0);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const { theme, setTheme, resolvedTheme } = useTheme();
  // ローカル時刻基準で 'YYYY-MM-DD' を取得
  const today = new Date().toLocaleDateString('sv-SE');
  const weekRange = getWeekRange();

  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportRange, setExportRange] = useState({ start: today, end: today });
  const [dateRange, setDateRange] = useState(weekRange);
  const [viewMode, setViewMode] = useState('pie'); // 'pie', 'list'
  const [groupBy, setGroupBy] = useState('windowTitle'); // 'appName', 'windowTitle'
  const [breakdownLogs, setBreakdownLogs] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [isBreakdownModalOpen, setIsBreakdownModalOpen] = useState(false);
  const [breakdownGroupBy, setBreakdownGroupBy] = useState('windowTitle'); // 'appName', 'windowTitle'

  const [windowRules, setWindowRules] = useState([]);
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [editForm, setEditForm] = useState({ keyword: '', replace_with: '', match_type: 'contains', color: '#5c6ac4' });



  const fetchData = async () => {
    try {
      const params = new URLSearchParams({
        startDate: dateRange.start,
        endDate: dateRange.end
      }).toString();

      const [statsAppsRes, statsWindowsRes, logsRes, heatmapRes, settingsRes, titlesRes, rulesRes, fatigueRes] = await Promise.all([
        fetch(`${API_BASE}/stats?${params}&groupBy=appName`),
        fetch(`${API_BASE}/stats?${params}&groupBy=windowTitle`),
        fetch(`${API_BASE}/logs?${params}`),
        fetch(`${API_BASE}/heatmap?${params}&groupBy=${groupBy}`),
        fetch(`${API_BASE}/settings`),
        fetch(`${API_BASE}/window-titles`),
        fetch(`${API_BASE}/window-rules`),
        fetch(`${API_BASE}/fatigue`)
      ]);

      if (!statsAppsRes.ok || !statsWindowsRes.ok || !logsRes.ok || !heatmapRes.ok || !settingsRes.ok) {
        throw new Error(`Server returned error: ${statsAppsRes.status}`);
      }

      const statsAppsData = await statsAppsRes.json();
      const statsWindowsData = await statsWindowsRes.json();
      const logsData = await logsRes.json();
      const heatmapData = await heatmapRes.json();
      const settingsData = await settingsRes.json();
      const titlesData = await titlesRes.json();
      const rulesData = await rulesRes.json();
      if (fatigueRes && fatigueRes.ok) {
        const fData = await fatigueRes.json();
        setFatigueData(fData);
        const now = Date.now();
        if (fData.statusName === 'Danger') {
          if (prevStatusRef.current !== 'Danger' || now - lastAlertTimeRef.current >= 10 * 60 * 1000) {
            lastAlertTimeRef.current = now;
            const requiredExpectedLogs = Math.ceil(fData.activeLogs / 0.855);
            const diffLogs = Math.max(0, requiredExpectedLogs - fData.expectedLogs);
            const requiredSeconds = diffLogs * 10;
            const requiredMinutes = requiredSeconds / 60;
            const restMinutes = Math.ceil(requiredMinutes / 10) * 10;
            const finalMinutes = restMinutes > 0 ? restMinutes : 10;
            const message = `長時間の作業お疲れ様です。${finalMinutes}分ほど休憩を取りませんか？`;

            if (window.require) {
              const { ipcRenderer } = window.require('electron');
              ipcRenderer.invoke('alert:danger', message);
            } else if (typeof window !== 'undefined' && window.Notification) {
              new window.Notification("WorkPulse からのお知らせ", {
                body: message
              });
            }
          }
        } else {
          lastAlertTimeRef.current = 0;
        }
        prevStatusRef.current = fData.statusName;
      }


      setWindowRules(rulesData);

      // フロントエンドでの表示名置換と再集計
      const processedLogs = logsData.map(log => ({ ...log, ...applyWindowRules(log.windowTitle, rulesData) }));

      // heatmapData の置換
      const processedHeatmap = heatmapData.map(cell => {
        const titleToApply = cell.topWindow || '';
        const ruleResult = applyWindowRules(titleToApply, rulesData);
        return { ...cell, topWindowDisplay: ruleResult.displayTitle, topWindowOriginal: ruleResult.originalTitle, color: ruleResult.color };
      });

      // statsData の置換と再集計、表示数の制限
      const maxLen = 20;
      const truncateName = (str) => {
        if (!str) return '不明なウィンドウ';
        return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
      };

      const maxItems = 6;

      // Merge unique windows
      const mergedWindows = {};
      statsWindowsData.forEach(stat => {
        const rawName = stat.name || '不明なウィンドウ';
        const ruleResult = applyWindowRules(rawName, rulesData);
        const disp = ruleResult.displayTitle || '不明なウィンドウ';
        const truncated = truncateName(disp);

        if (!mergedWindows[truncated]) {
          mergedWindows[truncated] = { name: truncated, count: 0, color: ruleResult.color };
        }
        mergedWindows[truncated].count += stat.count;
      });

      // Merge unique apps
      const mergedApps = {};
      statsAppsData.forEach(stat => {
        const rawName = stat.name || '不明なアプリ';
        const truncated = truncateName(rawName);

        if (!mergedApps[truncated]) {
          mergedApps[truncated] = { name: truncated, count: 0, color: null };
        }
        mergedApps[truncated].count += stat.count;
      });

      setTotalAppsCount(Object.keys(mergedApps).length);
      setTotalWindowsCount(Object.keys(mergedWindows).length);

      let processedStats = [];
      if (groupBy === 'windowTitle') {
        const sorted = Object.values(mergedWindows).sort((a, b) => b.count - a.count);
        if (sorted.length > maxItems) {
          const topStats = sorted.slice(0, maxItems - 1);
          const others = sorted.slice(maxItems - 1).reduce((acc, curr) => acc + curr.count, 0);
          topStats.push({ name: 'その他', count: others, color: '#94a3b8' });
          processedStats = topStats;
        } else {
          processedStats = sorted;
        }
      } else {
        const sorted = Object.values(mergedApps).sort((a, b) => b.count - a.count);
        if (sorted.length > maxItems) {
          const topStats = sorted.slice(0, maxItems - 1);
          const others = sorted.slice(maxItems - 1).reduce((acc, curr) => acc + curr.count, 0);
          topStats.push({ name: 'その他', count: others, color: '#94a3b8' });
          processedStats = topStats;
        } else {
          processedStats = sorted;
        }
      }

      setStats(processedStats);
      setLogs(processedLogs);
      setHeatmapData(processedHeatmap);
      setSettings(settingsData);
      setWindowTitles(Array.isArray(titlesData) ? titlesData : []);
      setError(null);
      setLoading(false);
    } catch (err) {
      console.error('データの取得に失敗しました:', err);
      setError('サーバーに接続できません。backendプロセスが起動しているか確認してください。');
      setLoading(false);
    }
  };

  const checkRecordingStatus = async () => {
    if (window.require) {
      try {
        const { ipcRenderer } = window.require('electron');
        const status = await ipcRenderer.invoke('recording:status');
        setIsRecording(status);
      } catch (err) {
        console.error('記録状態の取得に失敗しました:', err);
      }
    }
  };

  const toggleRecording = async () => {
    if (window.require) {
      const { ipcRenderer } = window.require('electron');
      const channel = isRecording ? 'recording:stop' : 'recording:start';
      const status = await ipcRenderer.invoke(channel);
      setIsRecording(status);

      // 記録開始時はデータを即時リフレッシュ
      if (status) {
        setTimeout(fetchData, 1000);
      }
    }
  };

  const jumpToCurrentTime = () => {
    const now = new Date();
    const dateStr = now.toLocaleDateString('sv-SE');
    const h = now.getHours();
    const m = Math.floor(now.getMinutes() / 15) * 15;
    const mStr = m.toString().padStart(2, '0');

    const elementId = `cell-${dateStr}-${h}-${mStr}`;
    const element = document.getElementById(elementId);

    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      // 一時的にハイライト
      element.style.outline = '3px solid var(--accent)';
      element.style.outlineOffset = '2px';
      element.style.zIndex = '100';
      setTimeout(() => {
        element.style.outline = '';
        element.style.outlineOffset = '';
        element.style.zIndex = '';
      }, 3000);
    } else {
      alert('現在の日時が表示範囲外です。');
    }
  };




  useEffect(() => {
    fetchData();
    checkRecordingStatus();
    const interval = setInterval(fetchData, 10000); // 10秒ごとにUI更新
    return () => clearInterval(interval);
  }, [dateRange, groupBy]); // 期間または集計単位が変更されたら再取得

  const handleSaveSetting = async (key, value) => {
    let finalValue = value.toString();
    const samplingInterval = parseInt(settings.sampling_interval || 10);
    const idleThreshold = parseInt(settings.idle_threshold || 300);

    // バリデーション: アイドリング判定しきい値はサンプリング間隔以上である必要がある。また、上限を600秒に制限。
    if (key === 'idle_threshold') {
      const val = parseInt(value);
      if (val < samplingInterval) {
        finalValue = samplingInterval.toString();
      } else if (val > 600) {
        finalValue = '600';
      }
    }
    if (key === 'sampling_interval' && parseInt(value) > idleThreshold) {
      // サンプリング間隔を上げた場合、しきい値も連動して上げる
      await handleSaveSetting('idle_threshold', value);
    }

    try {
      await fetch(`${API_BASE}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: finalValue })
      });
      setSettings(prev => ({ ...prev, [key]: finalValue }));
    } catch (err) {
      console.error('設定の保存に失敗しました:', err);
    }
  };

  const handleClearLogs = async () => {
    if (!window.confirm('本当にすべてのログを削除しますか？\nこの操作は取り消せません。')) {
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/logs/clear`, { method: 'DELETE' });
      if (res.ok) {
        alert('ログをすべて削除しました。');
        fetchData(); // データをリフレッシュ
      }
    } catch (err) {
      console.error('ログの削除に失敗しました:', err);
      alert('削除に失敗しました。');
    }
  };

  const handleExportCsv = (mode) => {
    let url = `${API_BASE}/export`;
    if (mode === 'range') {
      url += `?startDate=${exportRange.start}&endDate=${exportRange.end}`;
    }

    // Create a temporary link to trigger download
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'work_logs.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setIsExportModalOpen(false);
  };



  const handleCellClick = async (date, hour, minute) => {
    setSelectedSlot({ date, hour, minute });
    setIsBreakdownModalOpen(true);
    setBreakdownLogs([]); // Reset previous logs

    try {
      const res = await fetch(`${API_BASE}/logs/breakdown?date=${date}&hour=${hour}&minute=${minute}`);
      if (res.ok) {
        const data = await res.json();
        const processedData = data.map(log => ({ ...log, ...applyWindowRules(log.windowTitle, windowRules) }));
        setBreakdownLogs(processedData);
      }
    } catch (err) {
      console.error('内訳の取得に失敗しました:', err);
    }
  };

  const getBreakdownSummary = () => {
    if (!breakdownLogs.length) return [];

    const summaryMap = {};
    breakdownLogs.forEach(log => {
      const key = breakdownGroupBy === 'appName' ? log.appName : log.displayTitle;
      if (!summaryMap[key]) {
        summaryMap[key] = {
          count: 0,
          name: key,
          isReplaced: breakdownGroupBy === 'windowTitle' ? log.isReplaced : false,
          color: breakdownGroupBy === 'windowTitle' ? log.color : null,
          originalTitle: breakdownGroupBy === 'windowTitle' ? log.originalTitle : null
        };
      }
      summaryMap[key].count++;
    });

    const total = breakdownLogs.length;
    const interval = parseInt(settings.sampling_interval || 10);

    return Object.values(summaryMap)
      .map(item => ({
        ...item,
        percentage: Math.round((item.count / total) * 100),
        duration: Math.round((item.count * interval)) // 秒単位で計算
      }))
      .sort((a, b) => b.count - a.count);
  };


  const pieData = {
    labels: stats.map(s => s.name || s.appName),
    datasets: [
      {
        data: stats.map(s => s.count),
        backgroundColor: [
          'rgba(92, 106, 196, 0.7)',
          'rgba(156, 126, 222, 0.7)',
          'rgba(101, 193, 184, 0.7)',
          'rgba(229, 115, 115, 0.7)',
          'rgba(255, 183, 77, 0.7)',
          'rgba(148, 163, 184, 0.7)',
        ],
        borderColor: [
          '#5c6ac4',
          '#9c7ede',
          '#65c1b8',
          '#e57373',
          '#ffb74d',
          '#94a3b8',
        ],
        borderWidth: 1,
      },
    ],
  };


  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'right',
        labels: {
          color: resolvedTheme === 'light' ? '#64748b' : '#94a3b8',
          font: { family: 'Outfit', size: 12 }
        }
      }
    }
  };

  const renderStatsView = () => {
    if (stats.length === 0) {
      return (
        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
          期間内のデータはまだありません
        </div>
      );
    }

    switch (viewMode) {
      case 'pie':
        return <Pie data={pieData} options={chartOptions} />;
      case 'list':
        const total = stats.reduce((acc, curr) => acc + curr.count, 0);
        return (
          <div className="top-apps-list">
            {stats.map((s, i) => (
              <div key={i} className="top-app-item">
                <div className="top-app-info">
                  <span className="app-rank">{i + 1}</span>
                  <span className="app-name">{s.name || s.appName}</span>
                  <span className="app-percentage">{Math.round((s.count / total) * 100)}% ({Math.round((s.count * parseInt(settings.sampling_interval || 10)) / 60)}分)</span>
                </div>
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${(s.count / total) * 100}%`,
                      background: s.color ? s.color : `linear-gradient(90deg, var(--primary), var(--accent))`
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        );
      default:
        return null;
    }
  };

  const renderDateHeader = (title) => (
    <header className="header fade-in">
      <div>
        <h1>{title}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.5rem' }}>
          <div className="date-picker-group">
            <Calendar size={14} />
            <input
              type="date"
              value={dateRange.start}
              max={dateRange.end}
              onChange={(e) => {
                const newStart = e.target.value;
                if (newStart <= dateRange.end) {
                  setDateRange(prev => ({ ...prev, start: newStart }));
                }
              }}
            />
            <span>～</span>
            <input
              type="date"
              value={dateRange.end}
              min={dateRange.start}
              onChange={(e) => {
                const newEnd = e.target.value;
                if (newEnd >= dateRange.start) {
                  setDateRange(prev => ({ ...prev, end: newEnd }));
                }
              }}
            />
          </div>
        </div>
      </div>
    </header>
  );

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return (
          <>
            {renderDateHeader('作業状況のまとめ')}

            <div style={{ flex: 1, overflowY: 'auto', paddingRight: '0.5rem', marginTop: '1rem' }}>
              {error && (
                <div style={{
                  margin: '1rem 0',
                  padding: '1rem',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  borderRadius: '12px',
                  color: '#f87171',
                  fontSize: '0.9rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}>
                  <RefreshCw size={16} />
                  {error}
                </div>
              )}

              <section className="stats-grid fade-in" style={{ animationDelay: '0.1s' }}>
                <div className="card">
                  <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', height: 'auto', minHeight: '1.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', whiteSpace: 'nowrap' }}>
                      <PieChart size={20} /> {groupBy === 'windowTitle' ? 'ウィンドウごとの時間' : 'アプリごとの時間'}
                    </div>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'nowrap' }}>
                      <div className="toggle-group">
                        <button className={groupBy === 'windowTitle' ? 'active' : ''} onClick={() => setGroupBy('windowTitle')}>ウィンドウ</button>
                        <button className={groupBy === 'appName' ? 'active' : ''} onClick={() => setGroupBy('appName')}>アプリ</button>
                      </div>
                      <div className="view-mode-toggle">
                        <button className={viewMode === 'pie' ? 'active' : ''} onClick={() => setViewMode('pie')} title="円グラフ"><PieChart size={16} /></button>
                        <button className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')} title="リスト表示"><List size={16} /></button>
                      </div>
                    </div>
                  </div>
                  <div className="chart-container">
                    {renderStatsView()}
                  </div>
                </div>

                <div className="card">
                  <div className="card-title">
                    <Clock size={20} /> 現在の状況
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <div style={{ padding: '1rem 1.5rem', background: 'rgba(99, 102, 241, 0.1)', borderRadius: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: '0.9rem', color: '#94a3b8' }}>合計の記録回数</div>
                      <div style={{ fontSize: '2rem', fontWeight: '800' }}>{formatNumberWithSuffix(stats.reduce((acc, curr) => acc + curr.count, 0))}</div>
                    </div>
                    <div style={{ padding: '1rem 1.5rem', background: 'rgba(34, 211, 238, 0.1)', borderRadius: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: '0.9rem', color: '#94a3b8' }}>使用したアプリの数</div>
                      <div style={{ fontSize: '2rem', fontWeight: '800' }}>{totalAppsCount}</div>
                    </div>
                    <div style={{ padding: '1rem 1.5rem', background: 'rgba(139, 92, 246, 0.1)', borderRadius: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: '0.9rem', color: '#94a3b8' }}>使用したウィンドウの数</div>
                      <div style={{ fontSize: '2rem', fontWeight: '800' }}>{totalWindowsCount}</div>
                    </div>
                  </div>
                </div>

                <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Activity size={20} color={fatigueData.statusName === 'Danger' ? '#ef4444' : fatigueData.statusName === 'Busy' ? '#f97316' : '#10b981'} />
                      <span>疲労ゲージ</span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem', color: '#94a3b8', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={settings.show_mini_on_close === 'true'}
                          onChange={async (e) => {
                            const val = e.target.checked ? 'true' : 'false';
                            handleSaveSetting('show_mini_on_close', val);
                            if (val === 'false' && window.require) {
                              const { ipcRenderer } = window.require('electron');
                              await ipcRenderer.invoke('mini-window:close');
                            }
                          }}
                          style={{ width: '12px', height: '12px', accentColor: '#6366f1' }}
                        />
                        <span>メイン画面を閉じたら表示</span>
                      </label>
                      <button
                        onClick={async () => {
                          if (window.require) {
                            const { ipcRenderer } = window.require('electron');
                            await ipcRenderer.invoke('mini-window:open');
                          }
                        }}
                        style={{
                          padding: '0.3rem 0.6rem',
                          fontSize: '0.75rem',
                          borderRadius: '6px',
                          background: 'rgba(99, 102, 241, 0.1)',
                          border: '1px solid rgba(99, 102, 241, 0.2)',
                          color: 'var(--primary)',
                          cursor: 'pointer',
                          fontWeight: '600'
                        }}
                      >
                        ミニ画面を表示
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1, justifyContent: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                      <span style={{ fontSize: '2rem', fontWeight: '800', color: fatigueData.statusName === 'Danger' ? '#ef4444' : fatigueData.statusName === 'Busy' ? '#f97316' : 'var(--text)' }}>
                        {fatigueData.statusName}
                      </span>
                      <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                        (稼働率 {fatigueData.statusName === 'Flesh' ? '集計中. . .' : `${100 - fatigueData.idleRate}%`})
                      </span>
                    </div>

                    <div style={{ height: '8px', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: `${fatigueData.statusName === 'Flesh' ? 0 : 100 - fatigueData.idleRate}%`,
                        background: fatigueData.statusName === 'Danger' ? 'linear-gradient(90deg, #ef4444, #f87171)' : fatigueData.statusName === 'Busy' ? 'linear-gradient(90deg, #f97316, #fb923c)' : 'linear-gradient(90deg, #10b981, #34d399)',
                        borderRadius: '4px',
                        transition: 'width 0.5s ease'
                      }} />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <div style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'flex', justifyContent: 'space-between' }}>
                        <span>作業開始時刻</span>
                        <span style={{ color: 'var(--text)', fontWeight: '600' }}>
                          {parseStartTime(fatigueData.startTime)}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'flex', justifyContent: 'space-between' }}>
                        <span>実稼働時間</span>
                        <span style={{ color: 'var(--text)', fontWeight: '600' }}>
                          {Math.floor(fatigueData.activeLogs * 10 / 60)}分
                        </span>
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'flex', justifyContent: 'space-between' }}>
                        <span>経過時間</span>
                        <span style={{ color: 'var(--text)', fontWeight: '600' }}>
                          {Math.floor(fatigueData.elapsedSeconds / 60)}分
                        </span>
                      </div>
                    </div>

                    <div style={{
                      padding: '0.65rem 0.85rem',
                      background: fatigueData.statusName === 'Danger' ? 'rgba(239, 68, 68, 0.1)' : fatigueData.statusName === 'Busy' ? 'rgba(249, 115, 22, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                      border: fatigueData.statusName === 'Danger' ? '1px solid rgba(239, 68, 68, 0.2)' : fatigueData.statusName === 'Busy' ? '1px solid rgba(249, 115, 22, 0.2)' : '1px solid rgba(16, 185, 129, 0.2)',
                      borderRadius: '12px',
                      color: fatigueData.statusName === 'Danger' ? '#f87171' : fatigueData.statusName === 'Busy' ? '#fb923c' : '#34d399',
                      fontSize: '0.85rem',
                      fontWeight: '600',
                      lineHeight: '1.4',
                      whiteSpace: 'pre-line'
                    }}>
                      {fatigueData.statusName === 'Danger'
                        ? "少し頑張りすぎていませんか？\nそろそろ小休憩を！"
                        : fatigueData.statusName === 'Busy'
                          ? "そろそろ疲れていませんか？\n適度に水分補給を！"
                          : fatigueData.statusName === 'Good'
                            ? "良いバランスです。\nこの調子で進めましょう！"
                            : fatigueData.statusName === 'Flesh'
                              ? "今日も一日頑張りましょう！！"
                              : "休憩を入れながら\nマイペースに進めましょう！"}
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </>
        );

      case 'timetable':
        const dates = [];
        let tCurr = new Date(dateRange.start);
        const tLast = new Date(dateRange.end);
        while (tCurr <= tLast) {
          dates.push(tCurr.toISOString().split('T')[0]);
          tCurr.setDate(tCurr.getDate() + 1);
        }

        const intervals = [];
        for (let i = 0; i < 24; i++) {
          const h = (i + 6) % 24;
          for (let m = 0; m < 60; m += 15) {
            intervals.push({ h, m: m.toString().padStart(2, '0') });
          }
        }


        return (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {renderDateHeader('時間ごとの活動の記録')}
            <section className="card fade-in" style={{ flex: 1, marginTop: '1rem', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <LayoutGrid size={20} /> 24時間・週次アクティビティ
                </div>
                <button
                  onClick={jumpToCurrentTime}
                  className="jump-btn"
                  style={{
                    padding: '0.4rem 0.8rem',
                    fontSize: '0.75rem',
                    borderRadius: '8px',
                    background: 'rgba(99, 102, 241, 0.1)',
                    border: '1px solid rgba(99, 102, 241, 0.2)',
                    color: 'var(--primary)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    fontWeight: '600',
                    transition: 'all 0.2s'
                  }}
                >
                  <Clock size={14} /> 現在時刻へ
                </button>
              </div>
              <div className="timetable-container" ref={timetableContainerRef} style={{ flex: 1, marginTop: '1rem' }}>
                <div className="timetable-grid" style={{ gridTemplateColumns: `70px repeat(${dates.length}, 1fr)`, gridAutoRows: '30px' }}>
                  <div className="time-label-header sticky-header sticky-left"></div>
                  {dates.map(d => {
                    const dateObj = new Date(d);
                    const yyyy = dateObj.getFullYear();
                    const mm = (dateObj.getMonth() + 1).toString().padStart(2, '0');
                    const dd = dateObj.getDate().toString().padStart(2, '0');
                    const dayName = ['日', '月', '火', '水', '木', '金', '土'][dateObj.getDay()];
                    const dayType = dateObj.getDay() === 0 ? 'is-sunday' : dateObj.getDay() === 6 ? 'is-saturday' : '';

                    return (
                      <div key={d} className={`day-label sticky-header ${dayType}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: '1.2', padding: '0.25rem 0' }}>
                        <div style={{ fontSize: '0.7rem', opacity: 0.7, fontWeight: 'normal' }}>{yyyy}</div>
                        <div style={{ fontSize: '0.8rem', fontWeight: '700' }}>{`${mm}/${dd}(${dayName})`}</div>
                      </div>
                    );
                  })}


                  {intervals.map(({ h, m }) => (
                    <React.Fragment key={`${h}:${m}`}>
                      <div className={`time-label sticky-left ${m === '00' ? 'is-hour-start' : ''}`}>{m === '00' ? `${h}:00` : `:${m}`}</div>
                      {dates.map(date => {
                        const cell = heatmapData.find(d =>
                          d.logDate === date &&
                          parseInt(d.hour) === h &&
                          parseInt(d.minute) === parseInt(m)
                        );
                        const isIdle = cell && (cell.topApp === 'アイドル状態' || cell.topApp === '無操作');
                        const cellColor = cell?.color || settings.default_activity_color || 'var(--primary)';
                        return (
                          <div
                            key={date}
                            id={`cell-${date}-${h}-${m}`}
                            className={`timetable-cell ${m === '00' ? 'is-hour-start' : ''} ${new Date(date).getDay() === 0 ? 'is-sunday' : new Date(date).getDay() === 6 ? 'is-saturday' : ''}`}
                            style={{
                              backgroundColor: (cell && !isIdle) ? cellColor : undefined,
                              border: (cell && !isIdle) ? 'none' : undefined,
                              cursor: cell ? 'pointer' : 'default'
                            }}
                            onClick={() => cell && handleCellClick(date, h, m)}
                            title={cell ? `${date} ${h}:${m}\nアプリ: ${cell.topApp}\nウィンドウ: ${cell.topWindowDisplay}${cell.topWindowDisplay !== cell.topWindowOriginal ? ` (${cell.topWindowOriginal})` : ''}\nサンプリング数: ${cell.count} samples\n(クリックで内訳を表示)` : undefined}
                          />
                        );
                      })}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </section>
          </div>
        );

      case 'history':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {renderDateHeader('これまでの作業履歴')}
            <div style={{ flex: 1, overflowY: 'auto', marginTop: '1rem' }}>
              <section className="card fade-in">
                <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <History size={20} /> 最近の作業履歴
                  </div>
                </div>
                <div className="logs-table-container">
                  <table className="logs-table">
                    <thead>
                      <tr>
                        <th>時刻</th>
                        <th>アプリ名</th>
                        <th>ウィンドウタイトル</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map((log) => (
                        <tr key={log.id}>
                          <td className="timestamp">{new Date(log.timestamp).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
                          <td><span className="app-badge">{log.appName}</span></td>
                          <td style={{ maxWidth: '400px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {renderWindowTitle(log)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          </div>
        );

      case 'settings':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {renderDateHeader('環境設定')}
            <div style={{ flex: 1, overflowY: 'auto', marginTop: '1rem', paddingRight: '0.5rem' }}>
              <section className="card fade-in">
                <div className="card-title">
                  <Settings size={20} /> アプリケーション設定
                </div>
                <div style={{ padding: '1.5rem' }}>
                  <div style={{ marginBottom: '2rem', padding: '1.5rem', background: 'rgba(255,255,255,0.02)', borderRadius: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
                      <Activity size={20} color="#10b981" />
                      <div>
                        <div style={{ fontWeight: '600' }}>無操作の判定設定</div>
                        <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>操作がないとみなす時間（アイドル判定しきい値）を設定します。この時間以上操作がない場合、記録は行われません。</div>
                      </div>
                    </div>
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1.5rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                        <span style={{ fontSize: '0.9rem', color: '#94a3b8' }}>操作していないとみなす時間</span>
                        <span style={{ fontWeight: '600' }}>{settings.idle_threshold || 300}秒</span>
                      </div>
                      <input
                        type="range"
                        min="10"
                        max="600"
                        step="10"
                        value={settings.idle_threshold || 300}
                        onChange={(e) => handleSaveSetting('idle_threshold', e.target.value)}
                        style={{ width: '100%', accentColor: '#10b981' }}
                      />
                    </div>
                  </div>


                  {/* 表示名置換ルール設定セクション */}
                  <div style={{ marginBottom: '2rem', padding: '1.5rem', background: 'rgba(255,255,255,0.02)', borderRadius: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
                      <Settings size={20} color="#8b5cf6" />
                      <div>
                        <div style={{ fontWeight: '600' }}>表示名の変更ルール</div>
                        <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>特定のウィンドウ名を、分かりやすい名前に変更して表示します。</div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                      <datalist id="windowTitlesList">
                        {windowTitles.map((title, i) => (
                          <option key={i} value={title} />
                        ))}
                      </datalist>
                      <input
                        type="text"
                        id="newRuleKeyword"
                        list="windowTitlesList"
                        placeholder="キーワード (例: Google Chrome)"
                        style={{ flex: 1, padding: '0.5rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)', color: 'var(--text)' }}
                      />
                      <select id="newRuleMatchType" style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)', color: 'var(--text)' }}>
                        <option value="contains">を含む</option>
                        <option value="startsWith">から始まる</option>
                        <option value="exact">と同じ</option>
                      </select>
                      <input
                        type="text"
                        id="newRuleReplace"
                        placeholder="変更後の名前 (例: ブラウザ)"
                        style={{ flex: 1, padding: '0.5rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)', color: 'var(--text)' }}
                      />
                      <input
                        type="color"
                        id="newRuleColor"
                        defaultValue="#5c6ac4"
                        style={{ width: '38px', height: '38px', padding: '0.1rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)', cursor: 'pointer', flexShrink: 0 }}
                        title="表示色を選択"
                      />
                      <button
                        onClick={async () => {
                          const keyword = document.getElementById('newRuleKeyword').value;
                          const replace_with = document.getElementById('newRuleReplace').value;
                          const match_type = document.getElementById('newRuleMatchType').value;
                          const color = document.getElementById('newRuleColor').value;
                          if (!keyword || !replace_with) return alert('キーワードと変更後の名前を入力してください');

                          try {
                            const res = await fetch(`${API_BASE}/window-rules`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ keyword, replace_with, match_type, color })
                            });
                            if (res.ok) {
                              document.getElementById('newRuleKeyword').value = '';
                              document.getElementById('newRuleReplace').value = '';
                              fetchData(); // データをリロードして新しいルールを適用
                            }
                          } catch (err) {
                            console.error(err);
                          }
                        }}
                        style={{ padding: '0.5rem 1rem', borderRadius: '6px', background: 'var(--primary)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: '500' }}
                      >
                        追加
                      </button>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {windowRules.map(rule => (
                        editingRuleId === rule.id ? (
                          <div
                            key={rule.id}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', border: '1px solid #6366f1', flexWrap: 'wrap' }}
                            onKeyDown={async (e) => {
                              if (e.key === 'Escape') {
                                setEditingRuleId(null);
                              } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                if (!editForm.keyword || !editForm.replace_with) return alert('キーワードと変更後の名前を入力してください');
                                try {
                                  const res = await fetch(`${API_BASE}/window-rules/${rule.id}`, {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(editForm)
                                  });
                                  if (res.ok) {
                                    setEditingRuleId(null);
                                    fetchData();
                                  }
                                } catch (err) {
                                  console.error(err);
                                }
                              }
                            }}
                          >
                            <input
                              type="text"
                              value={editForm.keyword}
                              onChange={(e) => setEditForm({ ...editForm, keyword: e.target.value })}
                              style={{ flex: 1, minWidth: '150px', padding: '0.4rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.3)', color: 'var(--text)', fontSize: '0.85rem' }}
                            />
                            <select
                              value={editForm.match_type}
                              onChange={(e) => setEditForm({ ...editForm, match_type: e.target.value })}
                              style={{ padding: '0.4rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.3)', color: 'var(--text)', fontSize: '0.85rem' }}
                            >
                              <option value="contains">を含む</option>
                              <option value="startsWith">から始まる</option>
                              <option value="exact">と同じ</option>
                            </select>
                            <span style={{ color: '#64748b' }}>→</span>
                            <input
                              type="text"
                              value={editForm.replace_with}
                              onChange={(e) => setEditForm({ ...editForm, replace_with: e.target.value })}
                              style={{ flex: 1, minWidth: '150px', padding: '0.4rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.3)', color: 'var(--text)', fontSize: '0.85rem' }}
                            />
                            <input
                              type="color"
                              value={editForm.color || '#5c6ac4'}
                              onChange={(e) => setEditForm({ ...editForm, color: e.target.value })}
                              style={{ width: '32px', height: '32px', padding: '0', border: 'none', background: 'transparent', cursor: 'pointer', flexShrink: 0 }}
                            />
                            <div style={{ display: 'flex', gap: '0.4rem' }}>
                              <button
                                onClick={async () => {
                                  if (!editForm.keyword || !editForm.replace_with) return alert('キーワードと変更後の名前を入力してください');
                                  try {
                                    const res = await fetch(`${API_BASE}/window-rules/${rule.id}`, {
                                      method: 'PUT',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify(editForm)
                                    });
                                    if (res.ok) {
                                      setEditingRuleId(null);
                                      fetchData();
                                    }
                                  } catch (e) {
                                    console.error(e);
                                  }
                                }}
                                style={{ padding: '0.4rem 0.8rem', borderRadius: '4px', background: '#10b981', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '500' }}
                                title="保存 (Ctrl + Enter)"
                              >
                                保存
                              </button>
                              <button
                                onClick={() => setEditingRuleId(null)}
                                style={{ padding: '0.4rem 0.8rem', borderRadius: '4px', background: '#475569', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '500' }}
                                title="取消 (Esc)"
                              >
                                取消
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div key={rule.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', overflow: 'hidden' }}>
                              <div style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', background: 'rgba(139, 92, 246, 0.2)', color: '#a78bfa', borderRadius: '4px', whiteSpace: 'nowrap' }}>
                                {rule.match_type === 'exact' ? 'と同じ' : rule.match_type === 'startsWith' ? 'から始まる' : 'を含む'}
                              </div>
                              <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#94a3b8' }}>
                                <span style={{ color: 'var(--text)' }}>{rule.keyword}</span>
                              </div>
                              <div style={{ color: '#64748b' }}>→</div>
                              <div style={{ fontWeight: '500', color: rule.color || 'var(--primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {rule.replace_with}
                              </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                              <button
                                onClick={() => {
                                  setEditingRuleId(rule.id);
                                  setEditForm({ keyword: rule.keyword, replace_with: rule.replace_with, match_type: rule.match_type, color: rule.color || '#5c6ac4' });
                                }}
                                style={{ background: 'none', border: 'none', color: '#a78bfa', cursor: 'pointer', padding: '0.4rem' }}
                                title="編集"
                              >
                                <Edit2 size={16} />
                              </button>
                              <button
                                onClick={async () => {
                                  try {
                                    await fetch(`${API_BASE}/window-rules/${rule.id}`, { method: 'DELETE' });
                                    fetchData();
                                  } catch (e) { }
                                }}
                                style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: '0.4rem' }}
                                title="削除"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                        )
                      ))}
                      {windowRules.length === 0 && (
                        <div style={{ textAlign: 'center', padding: '1rem', color: '#64748b', fontSize: '0.85rem' }}>
                          設定されたルールはありません
                        </div>
                      )}
                    </div>
                  </div>


                  <div style={{ marginBottom: '2rem', padding: '1.5rem', background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.1)', borderRadius: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', color: '#f87171' }}>
                      <AlertTriangle size={20} />
                      <span style={{ fontWeight: '600' }}>記録の削除とリセット</span>
                    </div>
                    <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                      今日のデータを消去して作業開始時間をリセット、またはこれまでに記録されたすべての履歴を完全に削除します。
                    </p>
                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                      <button
                        onClick={async () => {
                          if (window.confirm('今日の記録を消去し、作業開始時間をリセットしますか？')) {
                            await fetch('http://127.0.0.1:3001/api/fatigue/reset', { method: 'POST' });
                            fetchData();
                            alert('今日の記録と作業開始時間をリセットしました。');
                          }
                        }}
                        style={{
                          padding: '0.75rem 1.5rem',
                          borderRadius: '10px',
                          background: 'rgba(239, 68, 68, 0.1)',
                          color: '#ef4444',
                          border: '1px solid rgba(239, 68, 68, 0.2)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          fontWeight: '600',
                          transition: 'all 0.2s'
                        }}
                      >
                        <RefreshCw size={18} />
                        今日の作業開始時間をリセット
                      </button>
                      <button
                        onClick={handleClearLogs}
                        className="delete-btn"
                        style={{
                          padding: '0.75rem 1.5rem',
                          borderRadius: '10px',
                          background: 'rgba(239, 68, 68, 0.2)',
                          color: '#f87171',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          fontWeight: '600',
                          transition: 'all 0.2s'
                        }}
                      >
                        <Trash2 size={18} />
                        すべてのログを削除
                      </button>
                    </div>
                  </div>

                  <div style={{ marginTop: '2rem', padding: '1.5rem', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: '16px', textAlign: 'center' }}>
                    <p style={{ color: '#64748b', fontSize: '0.85rem' }}>
                      その他の詳細設定（通知、非稼働時間の除外など）は今後のアップデートで追加予定です。
                    </p>
                  </div>
                </div>
              </section>
            </div>
          </div>
        );

      case 'help':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {renderDateHeader('ヘルプ・ガイド')}
            <div style={{ flex: 1, overflowY: 'auto', marginTop: '1rem', paddingRight: '0.5rem' }}>
              <div className="help-grid">
                <section className="card fade-in" style={{ animationDelay: '0.1s' }}>
                  <div className="card-title">
                    <HelpCircle size={20} color="var(--primary)" /> WorkPulse の使い方
                  </div>
                  <div className="help-content">
                    <h3>1. 自動記録</h3>
                    <p>
                      アプリを起動すると、アクティブなウィンドウの名前を定期的にバックグラウンドで記録します。
                      サイドバーの「記録を開始」ボタンを押すことで、収集が始まります。
                    </p>
                    <p style={{ fontSize: '0.8rem', marginTop: '0.5rem', color: 'var(--text-muted)' }}>
                      ※記録する間隔や無操作（アイドル）と判定するまでの秒数は、設定画面から自由に変更できます。
                    </p>

                    <h3>2. 時間ごとの活動（タイムテーブル）</h3>
                    <p>
                      「タイムテーブル」タブでは、24時間×設定期間の作業状況を一覧で確認できます。
                      各15分間の枠ごとに集計され、その時間帯で<strong>最も長く（多く記録）行っていた作業</strong>が代表としてカラー表示されます。
                    </p>
                    <p>
                      <strong>タイムテーブルの枠（セル）をクリックすると、その15分間の詳しいログ内訳、使用割合、合計時間をモーダルで確認できます。</strong>
                    </p>
                    <p style={{ fontSize: '0.8rem', marginTop: '0.5rem', color: 'var(--text-muted)' }}>
                      ※アイドル状態や記録を停止していた時間は透明のまま表示されます。
                    </p>

                    <h3>3. 表示名の変更ルール</h3>
                    <p>
                      設定画面から、特定のウィンドウタイトルに含まれるキーワードに対する置換ルールを登録できます。
                      分かりやすい名前に変えたり、専用の色（カラーピッカーで選択）を付けたりすることができます。
                      ※フロントエンド側で動的に置換するため、過去の元データが上書きされることはありません。
                    </p>

                    <h3>4. ミニ画面と疲労状態・稼働率</h3>
                    <p>
                      当日の稼働開始時刻とサンプリング数に基づき、リアルタイムに「疲労状態（Chill/Good/Busy/Danger）」を自動算出。
                      疲労状態が **Danger**（危険）のときは、5分おきに休憩を促す警告アラートを画面上に通知します。
                      さらにメイン画面や疲労度カードにある「メイン画面を閉じたら表示」をオンにすることで、親画面を閉じた際に、疲労状態や稼働率を常時把握できるコンパクトなミニ画面（ウィジェット）をデスクトップ上に自動表示できます。
                    </p>
                  </div>
                </section>

                <section className="card fade-in" style={{ animationDelay: '0.2s' }}>
                  <div className="card-title">
                    <AlertTriangle size={20} color="#fbbf24" /> ご利用上の注意
                  </div>
                  <div className="help-content">
                    <div className="warning-box">
                      <h4>プライバシーについて</h4>
                      <p>
                        本アプリは、操作中のアクティブウィンドウのタイトルを記録します。
                        個人情報や機密情報がタイトルに含まれる可能性があるため、必要に応じて記録のオン/オフを切り替えてください。
                      </p>
                    </div>

                    <ul className="help-list">
                      <li><strong>リソース消費:</strong> バックグラウンドでの記録は非常に軽量ですが、低スペックなPCでは動作に影響を与える場合があります。</li>
                      <li><strong>データの保存場所:</strong> 本アプリに関するすべてのデータは、お使いのPCの以下のディレクトリに保存されます。
                        <div style={{ marginTop: '0.8rem', padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                          <div style={{ marginBottom: '0.8rem' }}>
                            <span style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'block', marginBottom: '0.2rem' }}>■ メインデータベース (logs.db)</span>
                            <code style={{ fontSize: '0.8rem', color: 'var(--primary)', wordBreak: 'break-all' }}>%APPDATA%\workloggerapp\logs.db</code>
                            <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.2rem' }}>※作業履歴データ、環境設定、表示名変更ルールが保存されます。</p>
                          </div>
                          <div style={{ marginBottom: '0.8rem' }}>
                            <span style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'block', marginBottom: '0.2rem' }}>■ アプリケーション設定・キャッシュ</span>
                            <code style={{ fontSize: '0.8rem', color: 'var(--primary)', wordBreak: 'break-all' }}>%APPDATA%\workloggerapp\</code>
                            <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.2rem' }}>※テーマ設定（ダーク/ライト）やウィンドウの状態、一時ファイルが保存されます。</p>
                          </div>
                          <div>
                            <span style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'block', marginBottom: '0.2rem' }}>■ エクスポートデータ</span>
                            <p style={{ fontSize: '0.75rem', color: '#64748b' }}>CSV出力ボタンから保存したファイルは、ダウンロードフォルダなどの指定された場所に保存されます。</p>
                          </div>
                        </div>
                      </li>
                      <li><strong>スリープ時の記録:</strong> PCがスリープ状態、シャットダウンされている間は記録されません。</li>
                      <li><strong>操作していない時間の判定:</strong> 一定時間（設定可能）操作がない場合、作業の記録を自動的に停止します。無操作状態が続くと、稼働率が下がり、疲労状態が緩和されます。</li>
                    </ul>
                  </div>
                </section>

                <section className="card fade-in" style={{ animationDelay: '0.3s', gridColumn: '1 / -1' }}>
                  <div className="card-title">
                    <Activity size={20} color="#10b981" /> 便利なヒント
                  </div>
                  <div className="tips-grid">
                    <div className="tip-item">
                      <h5>タイムテーブルの活用</h5>
                      <p>「現在時刻へジャンプ」ボタンを使うと、今の時間を瞬時に特定してハイライトします。また、気になる枠をクリックして内訳を見るのも便利です。</p>
                    </div>
                    <div className="tip-item">
                      <h5>集計単位の切り替え</h5>
                      <p>ダッシュボードや詳細内訳画面では、ウィンドウごととアプリごとの集計をいつでもトグル切り替え可能です。</p>
                    </div>
                    <div className="tip-item">
                      <h5>ミニ画面（ウィジェット）</h5>
                      <p>メインウィンドウの非表示中も、邪魔にならないウィジェットによって作業の集中度がひと目で確認できます。いつでもワンクリックでメイン画面に戻れます。</p>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </div>
        );


      default:
        return null;
    }
  };

  const isMiniMode = window.location.search.includes('mini=true');

  if (isMiniMode) {
    return (
      <div className="mini-window-container fade-in" style={{
        WebkitAppRegion: 'drag',
        height: '100vh',
        padding: '0.6rem 0.75rem',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: 'rgba(30, 41, 59, 0.95)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '16px',
        color: '#cbd5e1',
        boxSizing: 'border-box'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <Activity size={15} color={fatigueData.statusName === 'Danger' ? '#ef4444' : fatigueData.statusName === 'Busy' ? '#f97316' : '#10b981'} />
            <span style={{ fontSize: '0.75rem', fontWeight: '700', color: '#fff' }}>疲労ゲージ</span>
          </div>
          <div style={{ display: 'flex', gap: '0.3rem', WebkitAppRegion: 'no-drag' }}>
            <button
              onClick={async () => {
                if (window.require) {
                  const { ipcRenderer } = window.require('electron');
                  await ipcRenderer.invoke('mini-window:close');
                }
              }}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#94a3b8',
                borderRadius: '6px',
                padding: '0.15rem 0.4rem',
                fontSize: '0.7rem',
                cursor: 'pointer',
                fontWeight: '600'
              }}
            >
              メイン
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
            <span style={{ fontSize: '1.25rem', fontWeight: '800', color: fatigueData.statusName === 'Danger' ? '#ef4444' : fatigueData.statusName === 'Busy' ? '#f97316' : '#fff' }}>
              {fatigueData.statusName}
            </span>
            <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
              ({fatigueData.statusName === 'Flesh' ? '集計中. . .' : `${100 - fatigueData.idleRate}%`})
            </span>
          </div>
          <div style={{ height: '5px', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '2.5px', overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${fatigueData.statusName === 'Flesh' ? 0 : 100 - fatigueData.idleRate}%`,
              background: fatigueData.statusName === 'Danger' ? 'linear-gradient(90deg, #ef4444, #f87171)' : fatigueData.statusName === 'Busy' ? 'linear-gradient(90deg, #f97316, #fb923c)' : 'linear-gradient(90deg, #10b981, #34d399)',
              borderRadius: '2.5px',
              transition: 'width 0.5s ease'
            }} />
          </div>
        </div>

        <div style={{
          fontSize: '0.65rem',
          color: fatigueData.statusName === 'Danger' ? '#f87171' : fatigueData.statusName === 'Busy' ? '#fb923c' : '#34d399',
          background: fatigueData.statusName === 'Danger' ? 'rgba(239, 68, 68, 0.1)' : fatigueData.statusName === 'Busy' ? 'rgba(249, 115, 22, 0.1)' : 'rgba(16, 185, 129, 0.1)',
          border: fatigueData.statusName === 'Danger' ? '1px solid rgba(239, 68, 68, 0.2)' : fatigueData.statusName === 'Busy' ? '1px solid rgba(249, 115, 22, 0.2)' : '1px solid rgba(16, 185, 129, 0.2)',
          padding: '0.25rem 0.4rem',
          borderRadius: '6px',
          lineHeight: '1.25',
          fontWeight: '500',
          whiteSpace: 'pre-line'
        }}>
          {fatigueData.statusName === 'Danger'
            ? "少し頑張りすぎていませんか？\nそろそろ小休憩を！"
            : fatigueData.statusName === 'Busy'
              ? "そろそろ疲れていませんか？\n適度に水分補給を！"
              : fatigueData.statusName === 'Good'
                ? "良いバランスです。\nこの調子で進めましょう！"
                : fatigueData.statusName === 'Flesh'
                  ? "今日も一日頑張りましょう！！"
                  : "休憩を入れながら\nマイペースに進めましょう！"}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.35rem', WebkitAppRegion: 'no-drag' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.65rem', color: '#94a3b8', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={settings.show_mini_on_close === 'true'}
              onChange={async (e) => {
                const val = e.target.checked ? 'true' : 'false';
                handleSaveSetting('show_mini_on_close', val);
                if (val === 'false' && window.require) {
                  const { ipcRenderer } = window.require('electron');
                  await ipcRenderer.invoke('mini-window:close');
                }
              }}
              style={{ width: '12px', height: '12px', accentColor: '#6366f1' }}
            />
            <span>メイン画面を閉じたら表示</span>
          </label>
          <span style={{ fontSize: '0.65rem', color: '#64748b' }}>
            稼働: {Math.floor(fatigueData.activeLogs * 10 / 60)}分
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={`dashboard ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="logo">
          {!isSidebarCollapsed && (
            <>
              <Activity size={32} color="#6366f1" />
              <span>WorkPulse</span>
            </>
          )}
          <button
            className="sidebar-toggle"
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            title={isSidebarCollapsed ? "サイドバーを開く" : "サイドバーを閉じる"}
            style={isSidebarCollapsed ? { position: 'static', margin: '0 auto' } : {}}
          >
            {isSidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>

        {!isSidebarCollapsed && (
          <>
            <nav className="nav-links">
              <div
                className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
                onClick={() => setActiveTab('dashboard')}
                title="ダッシュボード"
              >
                <LayoutDashboard size={20} />
                <span>ダッシュボード</span>
              </div>
              <div
                className={`nav-item ${activeTab === 'history' ? 'active' : ''}`}
                onClick={() => setActiveTab('history')}
                title="履歴"
              >
                <History size={20} />
                <span>履歴</span>
              </div>
              <div
                className={`nav-item ${activeTab === 'timetable' ? 'active' : ''}`}
                onClick={() => setActiveTab('timetable')}
                title="タイムテーブル"
              >
                <LayoutGrid size={20} />
                <span>タイムテーブル</span>
              </div>
              <div
                className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
                onClick={() => setActiveTab('settings')}
                title="設定"
              >
                <Settings size={20} />
                <span>設定</span>
              </div>
              <div
                className={`nav-item ${activeTab === 'help' ? 'active' : ''}`}
                onClick={() => setActiveTab('help')}
                title="ヘルプ"
              >
                <HelpCircle size={20} />
                <span>ヘルプ</span>
              </div>
              <div
                className="nav-item export-nav-item"
                onClick={() => {
                  setExportRange({ start: dateRange.start, end: dateRange.end });
                  setIsExportModalOpen(true);
                }}
                title="CSV出力"
              >
                <Download size={20} />
                <span>CSV出力</span>
              </div>
            </nav>
            <div className="sidebar-footer">
              <div className={`theme-switcher ${isSidebarCollapsed ? 'vertical' : ''}`}>
                <button
                  className={`theme-btn ${theme === 'light' ? 'active' : ''}`}
                  onClick={() => setTheme('light')}
                  title="ライトモード"
                >
                  <Sun size={18} />
                </button>
                <button
                  className={`theme-btn ${theme === 'dark' ? 'active' : ''}`}
                  onClick={() => setTheme('dark')}
                  title="ダークモード"
                >
                  <Moon size={18} />
                </button>
                <button
                  className={`theme-btn ${theme === 'system' ? 'active' : ''}`}
                  onClick={() => setTheme('system')}
                  title="システム設定"
                >
                  <Monitor size={18} />
                </button>
              </div>

              <div className="agent-status-card">

                <div style={{ fontSize: '0.9rem', color: isRecording ? '#10b981' : '#64748b', display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: isSidebarCollapsed ? 'center' : 'flex-start' }}>
                  <div className={`status-dot ${isRecording ? 'active' : 'inactive'}`} />
                  {!isSidebarCollapsed && (isRecording ? '記録中' : '停止中')}
                </div>
                <button
                  className={`recording-btn ${isRecording ? 'stop' : 'start'} ${isSidebarCollapsed ? 'mini' : ''}`}
                  onClick={toggleRecording}
                  title={isRecording ? "記録を停止" : "記録を開始"}
                >
                  {isRecording ? (
                    <><Square size={16} fill="white" /> 記録を停止</>
                  ) : (
                    <><Play size={16} fill="white" /> 記録を開始</>
                  )}
                </button>
              </div>

              <button
                onClick={async () => {
                  if (window.confirm('アプリケーションを完全に終了しますか？\n（バックグラウンドでの記録も停止します）')) {
                    if (window.require) {
                      const { ipcRenderer } = window.require('electron');
                      await ipcRenderer.invoke('app:quit-completely');
                    }
                  }
                }}
                style={{
                  width: '100%',
                  marginTop: '1rem',
                  padding: '0.6rem',
                  background: 'rgba(239, 68, 68, 0.15)',
                  color: '#f87171',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  fontWeight: '600',
                  fontSize: '0.8rem',
                  transition: 'all 0.2s',
                  boxShadow: '0 4px 6px rgba(0, 0, 0, 0.05)'
                }}
                title="アプリを完全に終了します"
              >
                <X size={16} />
                {!isSidebarCollapsed && 'アプリを閉じる'}
              </button>
            </div>
          </>
        )}
      </aside>

      <main className="main-content">
        {renderContent()}
      </main>

      {isExportModalOpen && (
        <div className="modal-overlay" onClick={() => setIsExportModalOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3><Download size={20} /> CSV出力設定</h3>
              <button className="close-btn" onClick={() => setIsExportModalOpen(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
                出力するデータの期間を選択してください。
              </p>

              <div className="export-option-card">
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: '600', marginBottom: '0.5rem' }}>期間を指定して出力</div>
                  <div className="modal-date-picker">
                    <input
                      type="date"
                      value={exportRange.start}
                      onChange={e => setExportRange(prev => ({ ...prev, start: e.target.value }))}
                    />
                    <span>～</span>
                    <input
                      type="date"
                      value={exportRange.end}
                      onChange={e => setExportRange(prev => ({ ...prev, end: e.target.value }))}
                    />
                  </div>
                </div>
                <button
                  className="primary-btn mini"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleExportCsv('range');
                  }}
                >
                  <Download size={14} /> 出力
                </button>
              </div>

              <div className="export-option-card" onClick={() => handleExportCsv('all')}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: '600', marginBottom: '0.25rem' }}>すべてのデータを出力</div>
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>全期間の記録を1つのCSVファイルとして保存します</div>
                </div>
                <button className="primary-btn mini secondary"><Download size={14} /> 出力</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {isBreakdownModalOpen && (
        <div className="modal-overlay" onClick={() => setIsBreakdownModalOpen(false)}>
          <div className="modal-content breakdown-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '700px', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div className="modal-header" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '1rem', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ fontSize: '1.2rem', fontWeight: '700', color: 'var(--text)' }}>
                  ログの内訳
                </h2>
                <div style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: '0.2rem' }}>
                  {selectedSlot?.date} {selectedSlot?.hour}:{selectedSlot?.minute} (15分間)
                </div>
              </div>
              <button onClick={() => setIsBreakdownModalOpen(false)} className="close-btn" style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>
                <X size={24} />
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', paddingRight: '0.5rem' }}>
              {breakdownLogs.length > 0 ? (
                <>
                  <div style={{ marginBottom: '2rem', padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <h3 style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                        <PieChart size={16} /> {breakdownGroupBy === 'appName' ? 'アプリごとの時間のまとめ' : 'ウィンドウごとの時間のまとめ'}
                      </h3>
                      <div className="toggle-group" style={{ display: 'inline-flex' }}>
                        <button className={breakdownGroupBy === 'windowTitle' ? 'active' : ''} onClick={() => setBreakdownGroupBy('windowTitle')}>ウィンドウ</button>
                        <button className={breakdownGroupBy === 'appName' ? 'active' : ''} onClick={() => setBreakdownGroupBy('appName')}>アプリ</button>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {getBreakdownSummary().map((item, idx) => (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem', fontSize: '0.85rem' }}>
                              <span style={{ fontWeight: '500', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '350px', display: 'inline-block' }}>
                                {breakdownGroupBy === 'windowTitle' && item.isReplaced ? (
                                  <>
                                    <span style={{ color: item.color || 'var(--primary)', fontWeight: '600', marginRight: '8px' }}>{item.name}</span>
                                    <span style={{ color: '#94a3b8', fontSize: '0.85em' }} title={item.originalTitle}>({item.originalTitle})</span>
                                  </>
                                ) : (
                                  <span title={item.name}>{item.name}</span>
                                )}
                              </span>
                              <span style={{ color: 'var(--primary)', fontWeight: '600' }}>
                                {item.percentage}% ({item.duration >= 60 ? `${Math.floor(item.duration / 60)}分${item.duration % 60}秒` : `${item.duration}秒`})
                              </span>
                            </div>
                            <div style={{ height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', overflow: 'hidden' }}>
                              <div
                                style={{
                                  height: '100%',
                                  width: `${item.percentage}%`,
                                  background: 'linear-gradient(90deg, var(--primary), var(--accent))',
                                  borderRadius: '2px'
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <h3 style={{ fontSize: '0.9rem', fontWeight: '600', marginBottom: '0.5rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <List size={16} /> 詳しい履歴
                  </h3>
                  <table className="logs-table" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', padding: '0.75rem' }}>時刻</th>
                        <th style={{ textAlign: 'left', padding: '0.75rem' }}>アプリ</th>
                        <th style={{ textAlign: 'left', padding: '0.75rem' }}>ウィンドウタイトル</th>
                      </tr>
                    </thead>
                    <tbody>
                      {breakdownLogs.map((log) => (
                        <tr key={log.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                          <td className="timestamp" style={{ whiteSpace: 'nowrap', padding: '0.75rem' }}>
                            {new Date(log.timestamp).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </td>
                          <td style={{ padding: '0.75rem' }}><span className="app-badge">{log.appName}</span></td>
                          <td style={{ padding: '0.75rem', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={log.originalTitle}>
                            {renderWindowTitle(log)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : (
                <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>
                  <RefreshCw size={24} className="spin" style={{ marginBottom: '1rem' }} />
                  <div>データを読み込み中...</div>
                </div>
              )}
            </div>

            <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.05)', textAlign: 'right' }}>
              <button
                onClick={() => setIsBreakdownModalOpen(false)}
                className="primary-btn"
                style={{ padding: '0.6rem 1.2rem', borderRadius: '8px' }}
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

