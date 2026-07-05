import React, { useState, useEffect } from 'react';

const SERVER_URL = 'http://127.0.0.1:3457';

interface Snapshot {
  timestamp: string;
  serverUptime: string;
  runs: RunEntry[];
  circuitBreaker: { state: string; failureRate: number };
  governor?: { currentTier: string; maxWorkers: number; activeWorkers: number };
}

interface RunEntry {
  attemptId: string;
  planId: string;
  verdict: string;
  startedAt?: string;
  finishedAt?: string;
  passedGates?: number;
  gateCount?: number;
}

function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    fetch(`${SERVER_URL}/api/snapshot`)
      .then(r => r.json())
      .then(data => { setSnapshot(data); setConnected(true); setError(null); })
      .catch(err => { setConnected(false); setError(`Cannot connect to server: ${err.message}`); });

    const interval = setInterval(() => {
      fetch(`${SERVER_URL}/api/snapshot`)
        .then(r => r.json())
        .then(data => setSnapshot(data))
        .catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const v = (val: string) => {
    switch (val) {
      case 'PASS': return '🟢 PASS';
      case 'HOLD': return '🟡 HOLD';
      case 'FAIL': return '🔴 FAIL';
      default: return val;
    }
  };

  // Extract unique "agents" from run IDs (prefix before first dash)
  const agents = snapshot
    ? [...new Set(snapshot.runs.map(r => r.attemptId.split('-')[0] ?? 'unknown'))]
    : [];
  const filteredRuns = snapshot
    ? agentFilter === 'all'
      ? snapshot.runs
      : snapshot.runs.filter(r => r.attemptId.startsWith(agentFilter))
    : [];

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: '24px', maxWidth: '1200px', margin: '0 auto', background: '#0d1117', color: '#c9d1d9', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #30363d', paddingBottom: '12px', marginBottom: '20px' }}>
        <h1 style={{ color: '#58a6ff', margin: 0 }}>
          ⚡ PRAXIS Mission Control
          {connected
            ? <span style={{ color: '#3fb950', fontSize: '14px', marginLeft: '12px' }}>● Connected</span>
            : <span style={{ color: '#f85149', fontSize: '14px', marginLeft: '12px' }}>● Disconnected</span>}
        </h1>
        {agents.length > 1 && (
          <select value={agentFilter} onChange={e => setAgentFilter(e.target.value)}
            style={{ background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d', padding: '6px 12px', borderRadius: '6px' }}>
            <option value="all">All Agents ({snapshot?.runs.length ?? 0})</option>
            {agents.map(a => (
              <option key={a} value={a}>{a} ({snapshot?.runs.filter(r => r.attemptId.startsWith(a)).length ?? 0})</option>
            ))}
          </select>
        )}
      </div>

      {error && <div style={{ background: '#3d1111', border: '1px solid #f85149', padding: '12px', borderRadius: '6px', marginBottom: '16px' }}>{error}</div>}

      {snapshot && (
        <>
          {/* Stats cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px', marginBottom: '20px' }}>
            <StatCard label="Server" value={snapshot.serverUptime} sub="uptime" color="#58a6ff" />
            <StatCard label="Circuit Breaker" value={snapshot.circuitBreaker.state} sub={`${(snapshot.circuitBreaker.failureRate * 100).toFixed(0)}% failure`}
              color={snapshot.circuitBreaker.state === 'CLOSED' ? '#3fb950' : '#f85149'} />
            <StatCard label="Verifications" value={String(snapshot.runs.length)} sub="total runs" color="#c9d1d9" />
            {snapshot.governor && (
              <StatCard label="Concurrency" value={snapshot.governor.currentTier} sub={`${snapshot.governor.activeWorkers}/${snapshot.governor.maxWorkers} workers`} color="#d29922" />
            )}
            <StatCard label="Agents" value={String(agents.length)} sub={agentFilter === 'all' ? 'all agents' : `filtered: ${agentFilter}`} color="#bc8cff" />
          </div>

          {/* Verifications table */}
          <h2 style={{ color: '#c9d1d9', fontSize: '16px', marginBottom: '12px' }}>
            {agentFilter === 'all' ? 'All Verifications' : `Verifications: ${agentFilter}`}
            <span style={{ color: '#8b949e', fontSize: '12px', marginLeft: '8px' }}>
              ({filteredRuns.length} run{filteredRuns.length !== 1 ? 's' : ''})
            </span>
          </h2>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #30363d' }}>
                <th style={{ textAlign: 'left', padding: '8px', color: '#8b949e', fontSize: '12px' }}>Run ID</th>
                <th style={{ textAlign: 'left', padding: '8px', color: '#8b949e', fontSize: '12px' }}>Plan</th>
                <th style={{ textAlign: 'left', padding: '8px', color: '#8b949e', fontSize: '12px' }}>Verdict</th>
                <th style={{ textAlign: 'left', padding: '8px', color: '#8b949e', fontSize: '12px' }}>Gates</th>
                <th style={{ textAlign: 'left', padding: '8px', color: '#8b949e', fontSize: '12px' }}>Time</th>
              </tr>
            </thead>
            <tbody>
              {filteredRuns.length === 0 && (
                <tr><td colSpan={5} style={{ padding: '24px', textAlign: 'center', color: '#8b949e' }}>
                  No verifications yet. Run `praxis verify` or POST /api/verify.
                </td></tr>
              )}
              {filteredRuns.map(r => (
                <tr key={r.attemptId} style={{ borderBottom: '1px solid #21262d' }}>
                  <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: '13px' }}>{r.attemptId}</td>
                  <td style={{ padding: '8px' }}>{r.planId}</td>
                  <td style={{ padding: '8px', fontWeight: 'bold' }}>{v(r.verdict)}</td>
                  <td style={{ padding: '8px', fontSize: '13px', color: '#8b949e' }}>
                    {r.passedGates != null ? `${r.passedGates}/${r.gateCount ?? '?'}` : '—'}
                  </td>
                  <td style={{ padding: '8px', fontSize: '12px', color: '#8b949e', fontFamily: 'monospace' }}>
                    {r.finishedAt ? new Date(r.finishedAt).toLocaleTimeString() : '—'}
                  </td>
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

function StatCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div style={{ background: '#161b22', padding: '14px', borderRadius: '8px', border: '1px solid #30363d' }}>
      <div style={{ color: '#8b949e', fontSize: '11px', textTransform: 'uppercase', marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: '22px', fontWeight: 'bold', color }}>{value}</div>
      <div style={{ color: '#8b949e', fontSize: '11px', marginTop: '2px' }}>{sub}</div>
    </div>
  );
}

export default App;
