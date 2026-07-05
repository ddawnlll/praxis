import { describe, test, expect } from 'bun:test';
import { scheduleWaves, validateNoNamespaceCollisions } from '../src/wave-scheduler/waveScheduler';

describe('Wave Scheduler', () => {
  test('schedules independent tasks in parallel', () => {
    const result = scheduleWaves([
      { taskId: 'A', namespace: ['src/a'], dependencies: [] },
      { taskId: 'B', namespace: ['src/b'], dependencies: [] },
      { taskId: 'C', namespace: ['src/c'], dependencies: [] },
    ]);
    expect(result.totalWaves).toBe(1);
    expect(result.waves[0].taskIds).toContain('A');
    expect(result.waves[0].taskIds).toContain('B');
    expect(result.waves[0].taskIds).toContain('C');
  });

  test('schedules dependent tasks sequentially', () => {
    const result = scheduleWaves([
      { taskId: 'A', namespace: ['src/a'], dependencies: [] },
      { taskId: 'B', namespace: ['src/b'], dependencies: ['A'] },
      { taskId: 'C', namespace: ['src/c'], dependencies: ['B'] },
    ]);
    expect(result.totalWaves).toBe(3);
    expect(result.waves[0].taskIds).toContain('A');
    expect(result.waves[1].taskIds).toContain('B');
    expect(result.waves[2].taskIds).toContain('C');
  });

  test('handles mixed dependencies', () => {
    const result = scheduleWaves([
      { taskId: 'A', namespace: [], dependencies: [] },
      { taskId: 'B', namespace: [], dependencies: ['A'] },
      { taskId: 'C', namespace: [], dependencies: ['A'] },
      { taskId: 'D', namespace: [], dependencies: ['B', 'C'] },
    ]);
    expect(result.totalWaves).toBe(3);
    expect(result.waves[0].taskIds).toContain('A');
    expect(result.waves[1].taskIds).toContain('B');
    expect(result.waves[1].taskIds).toContain('C');
    expect(result.waves[2].taskIds).toContain('D');
  });

  test('detects no collisions on clean namespaces', () => {
    const waves = scheduleWaves([
      { taskId: 'A', namespace: ['src/a'], dependencies: [] },
      { taskId: 'B', namespace: ['src/b'], dependencies: [] },
    ]).waves;
    const collisions = validateNoNamespaceCollisions(waves);
    expect(collisions.length).toBe(0);
  });

  test('criticalPathLength equals number of waves', () => {
    const result = scheduleWaves([
      { taskId: 'A', namespace: [], dependencies: [] },
      { taskId: 'B', namespace: [], dependencies: ['A'] },
    ]);
    expect(result.criticalPathLength).toBe(2);
  });
});
