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
  Timer,
  Play,
  Square,
  Sun,
  Moon,
  Monitor,
  Trash2,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Menu,
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

function App() {
  const [stats, setStats] = useState([]);
  const [heatmapData, setHeatmapData] = useState([]);
  const [logs, setLogs] = useState([]);
  const [settings, setSettings] = useState({ sampling_interval: '30' });
  const [windowTitles, setWindowTitles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const timetableContainerRef = useRef(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const hasPrompted = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const { theme, setTheme, resolvedTheme } = useTheme();
  // ローカル時刻基準で 'YYYY-MM-DD' を取得
  const today = new Date().toLocaleDateString('sv-SE'); 
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportRange, setExportRange] = useState({ start: today, end: today });
  const [dateRange, setDateRange] = useState({ start: today, end: today });
  const [viewMode, setViewMode] = useState('pie'); // 'pie', 'list'
  const [groupBy, setGroupBy] = useState('appName'); // 'appName', 'windowTitle'
  const [breakdownLogs, setBreakdownLogs] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [isBreakdownModalOpen, setIsBreakdownModalOpen] = useState(false);

  const [windowRules, setWindowRules] = useState([]);
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [editForm, setEditForm] = useState({ keyword: '', replace_with: '', match_type: 'contains', color: '#5c6ac4' });

  // ウィンドウ名置換ルールの適用関数
  const applyWindowRules = (title, rules = windowRules) => {
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



  const fetchData = async () => {
    try {
      const params = new URLSearchParams({
        startDate: dateRange.start,
        endDate: dateRange.end
      }).toString();

      const [statsRes, logsRes, heatmapRes, settingsRes, titlesRes, rulesRes] = await Promise.all([
        fetch(`${API_BASE}/stats?${params}&groupBy=${groupBy}`),
        fetch(`${API_BASE}/logs?${params}`),
        fetch(`${API_BASE}/heatmap?${params}&groupBy=${groupBy}`),
        fetch(`${API_BASE}/settings`),
        fetch(`${API_BASE}/window-titles`),
        fetch(`${API_BASE}/window-rules`)
      ]);

      if (!statsRes.ok || !logsRes.ok || !heatmapRes.ok || !settingsRes.ok) {
        throw new Error(`Server returned error: ${statsRes.status}`);
      }

      const statsData = await statsRes.json();
      const logsData = await logsRes.json();
      const heatmapData = await heatmapRes.json();
      const settingsData = await settingsRes.json();
      const titlesData = await titlesRes.json();
      const rulesData = await rulesRes.json();
      
      setWindowRules(rulesData);

      // フロントエンドでの表示名置換と再集計
      const processedLogs = logsData.map(log => ({ ...log, ...applyWindowRules(log.windowTitle, rulesData) }));
      
      // heatmapData の置換
      const processedHeatmap = heatmapData.map(cell => {
        const titleToApply = cell.topWindow || '';
        const ruleResult = applyWindowRules(titleToApply, rulesData);
        return { ...cell, topWindowDisplay: ruleResult.displayTitle, topWindowOriginal: ruleResult.originalTitle, color: ruleResult.color };
      });

      // statsData の置換と再集計（groupBy === 'windowTitle' の場合）
      let processedStats = statsData;
      if (groupBy === 'windowTitle') {
        const mergedStats = {};
        statsData.forEach(stat => {
          const ruleResult = applyWindowRules(stat.name, rulesData);
          const disp = ruleResult.displayTitle;
          if (!mergedStats[disp]) mergedStats[disp] = { name: disp, count: 0, color: ruleResult.color };
          mergedStats[disp].count += stat.count;
        });
        processedStats = Object.values(mergedStats).sort((a, b) => b.count - a.count);
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
    // データ取得が完了し、まだ確認ダイアログを表示していない場合、かつ記録中でない場合に表示
    if (!loading && !hasPrompted.current && !isRecording) {
      hasPrompted.current = true;

      const confirmStartup = async () => {
        if (window.require) {
          try {
            const { ipcRenderer } = window.require('electron');
            const started = await ipcRenderer.invoke('recording:confirm-start');
            if (started) {
              setIsRecording(true);
              // 記録開始時はデータを即時リフレッシュ
              setTimeout(fetchData, 1000);
            }
          } catch (err) {
            console.error('起動時の確認に失敗しました:', err);
          }
        }
      };

      // レンダリングが確実に完了するように少しだけ遅延させる
      const timer = setTimeout(confirmStartup, 500);
      return () => clearTimeout(timer);
    }
  }, [loading, isRecording]);

  useEffect(() => {
    fetchData();
    checkRecordingStatus();
    const interval = setInterval(fetchData, 10000); // 10秒ごとにUI更新
    return () => clearInterval(interval);
  }, [dateRange, groupBy]); // 期間または集計単位が変更されたら再取得

  const handleSaveSetting = async (key, value) => {
    let finalValue = value.toString();
    const samplingInterval = parseInt(settings.sampling_interval || 30);
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

    setIsSaving(true);
    try {
      await fetch(`${API_BASE}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: finalValue })
      });
      setSettings(prev => ({ ...prev, [key]: finalValue }));
    } catch (err) {
      console.error('設定の保存に失敗しました:', err);
    } finally {
      setIsSaving(false);
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

  // Alias handlers removed
  
  const handleCellClick = async (date, hour, minute) => {
    setSelectedSlot({ date, hour, minute });
    setIsBreakdownModalOpen(true);
    setBreakdownLogs([]); // Reset previous logs
    
    try {
      const res = await fetch(`${API_BASE}/logs/breakdown?date=${date}&hour=${hour}&minute=${minute}`);
      if (res.ok) {
        const data = await res.json();
        const processedData = data.map(log => ({ ...log, ...applyWindowRules(log.windowTitle) }));
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
      const key = log.appName;
      if (!summaryMap[key]) {
        summaryMap[key] = { count: 0, appName: log.appName };
      }
      summaryMap[key].count++;
    });

    const total = breakdownLogs.length;
    const interval = parseInt(settings.sampling_interval || 30);

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
        ],
        borderColor: [
          '#5c6ac4',
          '#9c7ede',
          '#65c1b8',
          '#e57373',
          '#ffb74d',
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
                  <span className="app-percentage">{Math.round((s.count / total) * 100)}% ({Math.round((s.count * parseInt(settings.sampling_interval || 30)) / 60)}分)</span>
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
            {renderDateHeader('アクティビティ概要')}

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
                      <PieChart size={20} /> {groupBy === 'appName' ? 'アプリ使用分布' : 'ウィンドウ使用分布'}
                    </div>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'nowrap' }}>
                      <div className="toggle-group">
                        <button className={groupBy === 'appName' ? 'active' : ''} onClick={() => setGroupBy('appName')}>アプリ</button>
                        <button className={groupBy === 'windowTitle' ? 'active' : ''} onClick={() => setGroupBy('windowTitle')}>ウィンドウ</button>
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
                    <Clock size={20} /> サマリー
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div style={{ padding: '1.5rem', background: 'rgba(99, 102, 241, 0.1)', borderRadius: '16px' }}>
                      <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>総サンプル数</div>
                      <div style={{ fontSize: '2rem', fontWeight: '800' }}>{stats.reduce((acc, curr) => acc + curr.count, 0)}</div>
                    </div>
                    <div style={{ padding: '1.5rem', background: 'rgba(34, 211, 238, 0.1)', borderRadius: '16px' }}>
                      <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>検知アプリ数</div>
                      <div style={{ fontSize: '2rem', fontWeight: '800' }}>{stats.length}</div>
                    </div>
                  </div>
                  <div style={{ marginTop: '1.5rem', padding: '1rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>次のサンプリングまで 約{settings.sampling_interval}秒</span>
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
            {renderDateHeader('タイムテーブル分析')}
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
                    const yy = dateObj.getFullYear().toString().slice(-2);
                    const mm = (dateObj.getMonth() + 1).toString().padStart(2, '0');
                    const dd = dateObj.getDate().toString().padStart(2, '0');
                    const dayName = ['日', '月', '火', '水', '木', '金', '土'][dateObj.getDay()];
                    const dayType = dateObj.getDay() === 0 ? 'is-sunday' : dateObj.getDay() === 6 ? 'is-saturday' : '';

                    return (
                      <div key={d} className={`day-label sticky-header ${dayType}`}>
                        {`${yy}/${mm}/${dd}(${dayName})`}
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
            {renderDateHeader('アクティビティ履歴')}
            <div style={{ flex: 1, overflowY: 'auto', marginTop: '1rem' }}>
              <section className="card fade-in">
                <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <History size={20} /> 最近のアクティビティ履歴
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
                      <Timer size={20} color="#6366f1" />
                      <span style={{ fontWeight: '600' }}>基本設定</span>
                    </div>

                    <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontSize: '0.9rem', fontWeight: '500' }}>サンプリング間隔</div>
                        <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>データの収集頻度を設定します</div>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        {[10, 30, 60].map((interval) => (
                          <button
                            key={interval}
                            onClick={() => handleSaveSetting('sampling_interval', interval)}
                            style={{
                              padding: '0.4rem 0.8rem',
                              borderRadius: '8px',
                              border: '1px solid',
                              borderColor: settings.sampling_interval === interval.toString() ? '#6366f1' : 'rgba(255,255,255,0.1)',
                              background: settings.sampling_interval === interval.toString() ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
                              color: settings.sampling_interval === interval.toString() ? '#fff' : '#94a3b8',
                              cursor: 'pointer',
                              fontSize: '0.8rem',
                              transition: 'all 0.2s'
                            }}
                          >
                            {interval}s
                          </button>
                        ))}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontSize: '0.9rem', fontWeight: '500' }}>デフォルトカラー</div>
                        <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>エイリアス未設定時の表示色</div>
                      </div>
                      <input
                        type="color"
                        value={settings.default_activity_color || '#6366f1'}
                        onChange={(e) => handleSaveSetting('default_activity_color', e.target.value)}
                        style={{ width: '40px', height: '40px', padding: '0', border: 'none', background: 'transparent', cursor: 'pointer' }}
                      />
                    </div>
                  </div>

                  <div style={{ marginBottom: '2rem', padding: '1.5rem', background: 'rgba(255,255,255,0.02)', borderRadius: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <Activity size={20} color="#10b981" />
                        <div>
                          <div style={{ fontWeight: '600' }}>アイドル状態の記録</div>
                          <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>操作がない時間を「アイドル状態」として記録します</div>
                        </div>
                      </div>
                      <button
                        onClick={() => handleSaveSetting('record_idle', settings.record_idle === 'true' ? 'false' : 'true')}
                        style={{
                          width: '50px',
                          height: '26px',
                          borderRadius: '13px',
                          background: settings.record_idle === 'true' ? '#10b981' : '#475569',
                          position: 'relative',
                          border: 'none',
                          cursor: 'pointer',
                          transition: 'background 0.3s'
                        }}
                      >
                        <div style={{
                          width: '20px',
                          height: '20px',
                          borderRadius: '50%',
                          background: 'white',
                          position: 'absolute',
                          top: '3px',
                          left: settings.record_idle === 'true' ? '27px' : '3px',
                          transition: 'left 0.3s'
                        }} />
                      </button>
                    </div>

                    {settings.record_idle === 'true' && (
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                          <span style={{ fontSize: '0.9rem', color: '#94a3b8' }}>アイドル判定しきい値</span>
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
                        <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.25rem' }}>
                          ※サンプリング間隔（{settings.sampling_interval}秒）以上の値を設定してください
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 表示名置換ルール設定セクション */}
                  <div style={{ marginBottom: '2rem', padding: '1.5rem', background: 'rgba(255,255,255,0.02)', borderRadius: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
                      <Settings size={20} color="#8b5cf6" />
                      <div>
                        <div style={{ fontWeight: '600' }}>表示名置換ルール</div>
                        <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>特定のウィンドウ名を、管理しやすい名前に置き換えて表示します。</div>
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
                        <option value="contains">部分一致</option>
                        <option value="startsWith">前方一致</option>
                        <option value="exact">完全一致</option>
                      </select>
                      <input 
                        type="text" 
                        id="newRuleReplace"
                        placeholder="置換後の名前 (例: ブラウザ)" 
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
                          if (!keyword || !replace_with) return alert('キーワードと置換後の名前を入力してください');
                          
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
                                if (!editForm.keyword || !editForm.replace_with) return alert('キーワードと置換後の名前を入力してください');
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
                              onChange={(e) => setEditForm({...editForm, keyword: e.target.value})}
                              style={{ flex: 1, minWidth: '150px', padding: '0.4rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.3)', color: 'var(--text)', fontSize: '0.85rem' }}
                            />
                            <select 
                              value={editForm.match_type}
                              onChange={(e) => setEditForm({...editForm, match_type: e.target.value})}
                              style={{ padding: '0.4rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.3)', color: 'var(--text)', fontSize: '0.85rem' }}
                            >
                              <option value="contains">部分一致</option>
                              <option value="startsWith">前方一致</option>
                              <option value="exact">完全一致</option>
                            </select>
                            <span style={{ color: '#64748b' }}>→</span>
                            <input 
                              type="text" 
                              value={editForm.replace_with}
                              onChange={(e) => setEditForm({...editForm, replace_with: e.target.value})}
                              style={{ flex: 1, minWidth: '150px', padding: '0.4rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.3)', color: 'var(--text)', fontSize: '0.85rem' }}
                            />
                            <input 
                              type="color" 
                              value={editForm.color || '#5c6ac4'}
                              onChange={(e) => setEditForm({...editForm, color: e.target.value})}
                              style={{ width: '32px', height: '32px', padding: '0', border: 'none', background: 'transparent', cursor: 'pointer', flexShrink: 0 }}
                            />
                            <div style={{ display: 'flex', gap: '0.4rem' }}>
                              <button 
                                onClick={async () => {
                                  if (!editForm.keyword || !editForm.replace_with) return alert('キーワードと置換後の名前を入力してください');
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
                                {rule.match_type === 'exact' ? '完全一致' : rule.match_type === 'startsWith' ? '前方一致' : '部分一致'}
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
                                  } catch(e) {}
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
                      <span style={{ fontWeight: '600' }}>危険な操作</span>
                    </div>
                    <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                      これまでに記録されたすべてのアクティビティログを永久に削除します。
                    </p>
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
                      アプリを起動すると、アクティブなウィンドウのタイトルを定期的にサンプリングして記録します。
                      「記録を開始」ボタンを押すことで、バックグラウンドでの収集が始まります。
                    </p>

                    <h3>2. タイムテーブル分析</h3>
                    <p>
                      「タイムテーブル」タブでは、24時間×設定期間の作業状況を色分けで確認できます。
                      各セルは15分単位で集計されており、その時間帯で<strong>最も長く（最も多くサンプリングされた）行っていた作業</strong>が代表として表示されます。
                    </p>
                    <p style={{ fontSize: '0.8rem', marginTop: '0.5rem', color: 'var(--text-muted)' }}>
                      ※「アイドル状態」や記録停止中の時間は、背景色が塗られず透明のまま表示されます。
                    </p>

                    <h3>3. エイリアス（別名）設定</h3>
                    <p>
                      設定画面から、特定のウィンドウタイトルに含まれるキーワードを「会議」「開発」などの分かりやすい名前に変換できます。
                      これにより、統計データが見やすくなります。
                    </p>

                    <h3>4. データの書き出し</h3>
                    <p>
                      サイドバーの「CSV出力」ボタンから、指定した期間のログデータをCSV形式でダウンロードできます。
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
                        本アプリは、操作中のウィンドウタイトルを記録します。
                        個人情報や機密情報がタイトルに含まれる可能性があるため、共有の予定があるときは記録のオン/オフは適切に切り替えてください。
                      </p>
                    </div>

                    <ul className="help-list">
                      <li><strong>リソース消費:</strong> バックグラウンドでのサンプリングは軽量ですが、低スペックなPCでは動作に影響を与える場合があります。</li>
                      <li><strong>データの保存場所:</strong> 本アプリに関するすべてのデータは、お使いのPCの以下のディレクトリに保存されます。
                        <div style={{ marginTop: '0.8rem', padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                          <div style={{ marginBottom: '0.8rem' }}>
                            <span style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'block', marginBottom: '0.2rem' }}>■ メインデータベース (logs.db)</span>
                            <code style={{ fontSize: '0.8rem', color: 'var(--primary)', wordBreak: 'break-all' }}>%APPDATA%\workloggerapp\logs.db</code>
                            <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.2rem' }}>※アクティビティログ、収集設定、エイリアス設定が含まれます。</p>
                          </div>
                          <div style={{ marginBottom: '0.8rem' }}>
                            <span style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'block', marginBottom: '0.2rem' }}>■ アプリケーション設定・キャッシュ</span>
                            <code style={{ fontSize: '0.8rem', color: 'var(--primary)', wordBreak: 'break-all' }}>%APPDATA%\workloggerapp\</code>
                            <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.2rem' }}>※テーマ設定（ダーク/ライト）やウィンドウの状態、一時ファイルが保存されます。</p>
                          </div>
                          <div>
                            <span style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'block', marginBottom: '0.2rem' }}>■ エクスポートデータ</span>
                            <p style={{ fontSize: '0.75rem', color: '#64748b' }}>CSV出力ボタンから保存したファイルは、保存時に指定したフォルダ（通常はダウンロードフォルダ等）に保存されます。</p>
                          </div>
                        </div>
                      </li>
                      <li><strong>スリープ時の記録:</strong> PCがスリープ状態、キーボードおよびマウス操作がない場合、シャットダウンされている間は記録されません。</li>
                      <li><strong>アイドル判定:</strong> マウスやキーボードの操作が一定時間（設定可能）ない場合、自動的に「アイドル状態」として記録されます。（無効にする場合は設定でオフにしてください）</li>
                    </ul>
                  </div>
                </section>

                <section className="card fade-in" style={{ animationDelay: '0.3s', gridColumn: '1 / -1' }}>
                  <div className="card-title">
                    <Activity size={20} color="#10b981" /> 便利なヒント
                  </div>
                  <div className="tips-grid">
                    <div className="tip-item">
                      <h5>ショートカット</h5>
                      <p>「現在時刻へジャンプ」ボタンを使うと、タイムテーブル上の今の時間を瞬時に特定できます。</p>
                    </div>
                    <div className="tip-item">
                      <h5>集計単位の切り替え</h5>
                      <p>ダッシュボードでは「アプリごと」と「ウィンドウごと」の集計をワンクリックで切り替えられます。</p>
                    </div>
                    <div className="tip-item">
                      <h5>テーマ変更</h5>
                      <p>サイドバー下のアイコンから、ダークモードとライトモードを切り替えることができます。</p>
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
                <div className="card-title" style={{ fontSize: '0.8rem', marginBottom: '0.5rem', color: 'var(--text-muted)' }}>
                  {/* <Cpu size={14} /> {!isSidebarCollapsed && '記録状態'} */}
                </div>
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
                    <h3 style={{ fontSize: '0.9rem', fontWeight: '600', marginBottom: '1rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <PieChart size={16} /> 作業割合の要約
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {getBreakdownSummary().map((item, idx) => (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem', fontSize: '0.85rem' }}>
                              <span style={{ fontWeight: '500', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.appName}</span>
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
                    <List size={16} /> 詳細ログ
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

