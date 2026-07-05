// @praxis/kernel — Wave Scheduler
// Schedules parallel work across waves. Each wave is a set of tasks
// that can run concurrently within namespace boundaries.

export interface WavePlan {
  waveId: string;
  tasks: WaveTask[];
  totalWaves: number;
}

export interface WaveTask {
  taskId: string;
  namespace: string[];
  dependencies: string[];
  estimatedDurationMs?: number;
}

export interface Wave {
  waveIndex: number;
  taskIds: string[];
  namespace: string[];
}

export interface ScheduleResult {
  waves: Wave[];
  totalTasks: number;
  totalWaves: number;
  criticalPathLength: number;
}

export function scheduleWaves(tasks: WaveTask[]): ScheduleResult {
  const taskMap = new Map(tasks.map(t => [t.taskId, t]));
  const remaining = new Set(tasks.map(t => t.taskId));
  const waves: Wave[] = [];
  let waveIndex = 0;

  while (remaining.size > 0) {
    const wave: Wave = {
      waveIndex,
      taskIds: [],
      namespace: [],
    };

    // Find tasks whose dependencies are all satisfied (not in remaining)
    for (const taskId of remaining) {
      const task = taskMap.get(taskId)!;
      const depsSatisfied = task.dependencies.every(d => !remaining.has(d));
      if (depsSatisfied) {
        wave.taskIds.push(taskId);
        wave.namespace.push(...task.namespace);
      }
    }

    if (wave.taskIds.length === 0) {
      // Circular dependency or stuck — add remaining as a single wave
      wave.taskIds.push(...remaining);
      break;
    }

    for (const id of wave.taskIds) remaining.delete(id);
    waves.push(wave);
    waveIndex++;
  }

  return {
    waves,
    totalTasks: tasks.length,
    totalWaves: waves.length,
    criticalPathLength: waves.length,
  };
}

export function validateNoNamespaceCollisions(waves: Wave[]): string[] {
  const collisions: string[] = [];

  for (const wave of waves) {
    const seen = new Map<string, string>();
    for (const ns of wave.namespace) {
      if (seen.has(ns)) {
        collisions.push(`Namespace "${ns}" used by multiple tasks in wave ${wave.waveIndex}`);
      }
      seen.set(ns, wave.taskIds[0]);
    }
  }

  return collisions;
}
