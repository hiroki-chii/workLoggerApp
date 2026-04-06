import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, 
  History, 
  Settings, 
  Download, 
  Activity, 
  Clock, 
  BarChart3,
  Cpu,
  RefreshCw,
  Timer,
  Play,
  Square
} from 'lucide-react';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { Pie } from 'react-chartjs-2';

ChartJS.register(ArcElement, Tooltip, Legend);

const API_BASE = 'http://127.0.0.1:3001/api';

function App() {
  const [stats, setStats] = useState([]);
  const [logs, setLogs] = useState([]);
  const [settings, setSettings] = useState({ sampling_interval: '30' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isSaving, setIsSaving] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

  const fetchData = async () => {
    try {
      const [statsRes, logsRes, settingsRes] = await Promise.all([
        fetch(`${API_BASE}/stats`),
        fetch(`${API_BASE}/logs`),
        fetch(`${API_BASE}/settings`)
      ]);
      
      if (!statsRes.ok || !logsRes.ok || !settingsRes.ok) {
         throw new Error(`Server returned error: ${statsRes.status}`);
      }

      const statsData = await statsRes.json();
      const logsData = await logsRes.json();
      const settingsData = await settingsRes.json();
      
      setStats(statsData);
      setLogs(logsData);
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
  }, []);

  const handleSaveInterval = async (newInterval) => {
    setIsSaving(true);
    try {
      await fetch(`${API_BASE}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'sampling_interval', value: newInterval })
      });
      setSettings(prev => ({ ...prev, sampling_interval: newInterval.toString() }));
    } catch (err) {
      console.error('設定の保存に失敗しました:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const pieData = {
    labels: stats.map(s => s.appName),
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
          color: '#94a3b8',
          font: { family: 'Outfit', size: 12 }
        }
      }
    }
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return (
          <>
            <header className="header fade-in">
              <div>
                <h1>アクティビティ概要</h1>
                <p style={{ color: '#94a3b8' }}>リアルタイムの作業パフォーマンスとアプリ使用状況</p>
              </div>
              <a href={`${API_BASE}/export`} className="export-btn" download>
                <Download size={18} />
                CSVエクスポート
              </a>
            </header>

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
                <div className="card-title">
                  <BarChart3 size={20} /> 本日のアプリ分布
                </div>
                <div className="chart-container">
                  {stats.length > 0 ? (
                    <Pie data={pieData} options={chartOptions} />
                  ) : (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
                      本日のデータはまだありません
                    </div>
                  )}
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
          </>
        );

      case 'history':
        return (
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
        );

      case 'settings':
        return (
          <section className="card fade-in">
            <div className="card-title">
              <Settings size={20} /> アプリケーション設定
            </div>
            <div style={{ padding: '1.5rem' }}>
              <div style={{ marginBottom: '2rem', padding: '1.5rem', background: 'rgba(255,255,255,0.02)', borderRadius: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                  <Timer size={20} color="#6366f1" />
                  <span style={{ fontWeight: '600' }}>サンプリング間隔の設定</span>
                </div>
                <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                  アクティブなウィンドウをチェックする頻度を指定します。間隔を短くするとより詳細なログが残ります。
                </p>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {[10, 20, 30, 40, 50, 60].map((interval) => (
                    <button
                      key={interval}
                      onClick={() => handleSaveInterval(interval)}
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
                {isSaving && <div style={{ marginTop: '1rem', color: '#6366f1', fontSize: '0.8rem' }}>保存中...</div>}
              </div>

              <div style={{ padding: '1.5rem', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: '16px', textAlign: 'center' }}>
                <p style={{ color: '#64748b', fontSize: '0.85rem' }}>
                  その他の詳細設定（通知、非稼働時間の除外など）は今後のアップデートで追加予定です。
                </p>
              </div>
            </div>
          </section>
        );
      
      default:
        return null;
    }
  };

  return (
    <div className="dashboard">
      <aside className="sidebar">
        <div className="logo">
          <Activity size={32} color="#6366f1" />
          <span>WorkPulse</span>
        </div>
        <nav className="nav-links">
          <div 
            className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <LayoutDashboard size={20} />
            <span>ダッシュボード</span>
          </div>
          <div 
            className={`nav-item ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            <History size={20} />
            <span>履歴</span>
          </div>
          <div 
            className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            <Settings size={20} />
            <span>設定</span>
          </div>
        </nav>
        <div style={{ marginTop: 'auto', padding: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '12px' }}>
          <div className="card-title" style={{ fontSize: '0.8rem', marginBottom: '0.5rem', color: 'var(--text-muted)' }}>
            <Cpu size={14} /> エージェントの状態
          </div>
          <div style={{ fontSize: '0.9rem', color: isRecording ? '#10b981' : '#64748b', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div className={`status-dot ${isRecording ? 'active' : 'inactive'}`} />
            {isRecording ? '記録中' : '停止中'}
          </div>
          <button 
            className={`recording-btn ${isRecording ? 'stop' : 'start'}`}
            onClick={toggleRecording}
          >
            {isRecording ? (
              <><Square size={16} fill="white" /> 記録を停止</>
            ) : (
              <><Play size={16} fill="white" /> 記録を開始</>
            )}
          </button>
        </div>
      </aside>

      <main className="main-content">
        {renderContent()}
      </main>
    </div>
  );
}

export default App;

