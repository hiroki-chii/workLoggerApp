import React, { useState, useEffect } from 'react';
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
  Cpu,
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
  Menu
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const { theme, setTheme, resolvedTheme } = useTheme();
  
  // 期間選択用のステート (デフォルトは今日)
  const today = new Date().toISOString().split('T')[0];
  const [dateRange, setDateRange] = useState({ start: today, end: today });
  const [viewMode, setViewMode] = useState('pie'); // 'pie', 'list'
  const [groupBy, setGroupBy] = useState('appName'); // 'appName', 'windowTitle'

  const fetchData = async () => {
    try {
      const params = new URLSearchParams({
        startDate: dateRange.start,
        endDate: dateRange.end
      }).toString();

      const [statsRes, logsRes, heatmapRes, settingsRes] = await Promise.all([
        fetch(`${API_BASE}/stats?${params}&groupBy=${groupBy}`),
        fetch(`${API_BASE}/logs?${params}`),
        fetch(`${API_BASE}/heatmap?${params}&groupBy=${groupBy}`),
        fetch(`${API_BASE}/settings`)
      ]);
      
      if (!statsRes.ok || !logsRes.ok || !heatmapRes.ok || !settingsRes.ok) {
         throw new Error(`Server returned error: ${statsRes.status}`);
      }

      const statsData = await statsRes.json();
      const logsData = await logsRes.json();
      const heatmapData = await heatmapRes.json();
      const settingsData = await settingsRes.json();
      
      setStats(statsData);
      setLogs(logsData);
      setHeatmapData(heatmapData);
      setSettings(settingsData);
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

    // バリデーション: アイドリング判定しきい値はサンプリング間隔以上である必要がある
    if (key === 'idle_threshold' && parseInt(value) < samplingInterval) {
      finalValue = samplingInterval.toString();
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

  const pieData = {
    labels: stats.map(s => s.name || s.appName),
    datasets: [
      {
        data: stats.map(s => s.count),
        backgroundColor: [
          'rgba(99, 102, 241, 0.6)',
          'rgba(168, 85, 247, 0.6)',
          'rgba(34, 211, 238, 0.6)',
          'rgba(244, 63, 94, 0.6)',
          'rgba(251, 191, 36, 0.6)',
        ],
        borderColor: [
          '#6366f1',
          '#a855f7',
          '#22d3ee',
          '#f43f5e',
          '#fbbf24',
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
                  <span className="app-percentage">{Math.round((s.count / total) * 100)}%</span>
                </div>
                <div className="progress-bar">
                  <div 
                    className="progress-fill" 
                    style={{ 
                      width: `${(s.count / total) * 100}%`,
                      background: `linear-gradient(90deg, var(--primary), var(--accent))`
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
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <a href={`${API_BASE}/export?startDate=${dateRange.start}&endDate=${dateRange.end}`} className="export-btn" download>
          <Download size={18} />
          CSV
        </a>
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
                  <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <PieChart size={20} /> {groupBy === 'appName' ? 'アプリ使用分布' : 'ウィンドウ使用分布'}
                    </div>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
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
        for (let h = 0; h < 24; h++) {
          for (let m = 0; m < 60; m += 15) {
            intervals.push({ h, m: m.toString().padStart(2, '0') });
          }
        }

        const maxCount = Math.max(...heatmapData.map(d => d.count), 1);

        return (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {renderDateHeader('タイムテーブル分析')}
            <section className="card fade-in" style={{ flex: 1, marginTop: '1rem', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div className="card-title">
                <LayoutGrid size={20} /> 24時間・週次アクティビティ
              </div>
              <div className="timetable-container" style={{ flex: 1, marginTop: '1rem' }}>
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
                      <div className="time-label sticky-left">{m === '00' ? `${h}:00` : `:${m}`}</div>
                      {dates.map(date => {
                        const cell = heatmapData.find(d => 
                          d.logDate === date && 
                          parseInt(d.hour) === h && 
                          parseInt(d.minute) === parseInt(m)
                        );
                        const opacity = cell ? (cell.count / maxCount) * 0.8 + 0.1 : 0;
                        return (
                          <div 
                            key={date} 
                            className={`timetable-cell ${new Date(date).getDay() === 0 ? 'is-sunday' : new Date(date).getDay() === 6 ? 'is-saturday' : ''}`} 
                            style={{ 
                              backgroundColor: cell ? `rgba(99, 102, 241, ${opacity})` : undefined,
                              border: cell ? 'none' : undefined
                            }}
                            title={`${date} ${h}:${m}\nアプリ: ${cell ? cell.topApp : 'なし'}\nウィンドウ: ${cell ? cell.topWindow : 'なし'}\n占有率: ${cell ? Math.round((cell.taskCount / cell.count) * 100) : 0}% (${cell ? cell.count : 0} samples)`}
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
                  <a href={`${API_BASE}/export`} className="export-btn" style={{ padding: '0.5rem 1rem', fontSize: '0.8rem' }} download>
                    <Download size={14} /> CSV出力
                  </a>
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
                          <td style={{ maxWidth: '400px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.windowTitle}</td>
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                      <Timer size={20} color="#6366f1" />
                      <span style={{ fontWeight: '600' }}>サンプリング間隔</span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {[10, 20, 30, 40, 50, 60].map((interval) => (
                        <button
                          key={interval}
                          onClick={() => handleSaveSetting('sampling_interval', interval)}
                          disabled={isSaving}
                          style={{
                            padding: '0.75rem 1.25rem',
                            borderRadius: '10px',
                            border: '1px solid',
                            borderColor: settings.sampling_interval === interval.toString() ? '#6366f1' : 'rgba(255,255,255,0.1)',
                            background: settings.sampling_interval === interval.toString() ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
                            color: settings.sampling_interval === interval.toString() ? '#fff' : '#94a3b8',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            fontWeight: '500'
                          }}
                        >
                          {interval}秒
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{ marginBottom: '2rem', padding: '1.5rem', background: 'rgba(255,255,255,0.02)', borderRadius: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <Activity size={20} color="#10b981" />
                        <div>
                          <div style={{ fontWeight: '600' }}>無操作時間の記録</div>
                          <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>操作がない時間を「無操作」として記録します</div>
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
                          <span style={{ fontSize: '0.9rem', color: '#94a3b8' }}>無操作判定しきい値</span>
                          <span style={{ fontWeight: '600' }}>{settings.idle_threshold || 300}秒</span>
                        </div>
                        <input 
                          type="range" 
                          min="10" 
                          max="1800" 
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
                  <Cpu size={14} /> {!isSidebarCollapsed && 'エージェントの状態'}
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
    </div>
  );
}

export default App;

