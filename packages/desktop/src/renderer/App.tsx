import React, { useState, useEffect } from 'react';

const SERVER_URL = 'http://127.0.0.1:3457';

interface Snapshot {
  timestamp: string;
  serverUptime: string;
  runs: Array<{ attemptId: string; planId: string; verdict: string }>;
  circuitBreaker: { state: string; failureRate: number };
}

function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    fetch(`${SERVER_URL}/api/snapshot`)
      .then(r => r.json())
      .then(data => { setSnapshot(data); setConnected(true); setError(null); })
      .catch(err => { setConnected(false); setError(`Cannot connect to server: ${err.message}`); });
  }, []);

  const v = (val: string) => {
    switch (val) {
      case 'PASS': return '🟢 PASS';
      case 'HOLD': return '🟡 HOLD';
      case 'FAIL': return '🔴 FAIL';
      default: return val;
    }
  };

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: '24px', maxWidth: '1000px', margin: '0 auto', background: '#0d1117', color: '#c9d1d9', minHeight: '100vh' }}>
      <h1 style={{ color: '#58a6ff', borderBottom: '1px solid #30363d', paddingBottom: '12px' }}>
        ⚡ PRAXIS Mission Control
        {connected
          ? <span style={{ color: '#3fb950', fontSize: '14px', marginLeft: '12px' }}>● Connected</span>
          : <span style={{ color: '#f85149', fontSize: '14px', marginLeft: '12px' }}>● Disconnected</span>}
      </h1>

      {error && <div style={{ background: '#3d1111', border: '1px solid #f85149', padding: '12px', borderRadius: '6px', marginBottom: '16px' }}>{error}</div>}

      {snapshot && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '24px' }}>
            <div style={{ background: '#161b22', padding: '16px', borderRadius: '8px', border: '1px solid #30363d' }}>
              <div style={{ color: '#8b949e', fontSize: '12px', textTransform: 'uppercase' }}>Server</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#58a6ff' }}>{snapshot.serverUptime}</div>
              <div style={{ color: '#8b949e', fontSize: '12px' }}>uptime</div>
            </div>
            <div style={{ background: '#161b22', padding: '16px', borderRadius: '8px', border: '1px solid #30363d' }}>
              <div style={{ color: '#8b949e', fontSize: '12px', textTransform: 'uppercase' }}>Circuit Breaker</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: snapshot.circuitBreaker.state === 'CLOSED' ? '#3fb950' : '#f85149' }}>{snapshot.circuitBreaker.state}</div>
              <div style={{ color: '#8b949e', fontSize: '12px' }}>{(snapshot.circuitBreaker.failureRate * 100).toFixed(0)}% failure</div>
            </div>
            <div style={{ background: '#161b22', padding: '16px', borderRadius: '8px', border: '1px solid #30363d' }}>
              <div style={{ color: '#8b949e', fontSize: '12px', textTransform: 'uppercase' }}>Verifications</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#c9d1d9' }}>{snapshot.runs.length}</div>
              <div style={{ color: '#8b949e', fontSize: '12px' }}>total runs</div>
            </div>
          </div>

          <h2 style={{ color: '#c9d1d9', fontSize: '16px', marginBottom: '12px' }}>Recent Verifications</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #30363d' }}>
                <th style={{ textAlign: 'left', padding: '8px', color: '#8b949e', fontSize: '12px' }}>Run ID</th>
                <th style={{ textAlign: 'left', padding: '8px', color: '#8b949e', fontSize: '12px' }}>Plan</th>
                <th style={{ textAlign: 'left', padding: '8px', color: '#8b949e', fontSize: '12px' }}>Verdict</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.runs.length === 0 && (
                <tr><td colSpan={3} style={{ padding: '24px', textAlign: 'center', color: '#8b949e' }}>No verifications yet. Run praxis verify or POST /api/verify.</td></tr>
              )}
              {snapshot.runs.map(r => (
                <tr key={r.attemptId} style={{ borderBottom: '1px solid #21262d' }}>
                  <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: '13px' }}>{r.attemptId}</td>
                  <td style={{ padding: '8px' }}>{r.planId}</td>
                  <td style={{ padding: '8px', fontWeight: 'bold' }}>{v(r.verdict)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {!snapshot && !error && <div style={{ textAlign: 'center', padding: '48px', color: '#8b949e' }}>Loading...</div>}
    </div>
  );
}

export default App;
