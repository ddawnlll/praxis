// @praxis/verity-qual — fault injection for recovery/crash replay tests (#34)

export type FaultKind =
  | 'disk-full'
  | 'truncate-write'
  | 'kill-mid-promotion'
  | 'corrupt-record'
  | 'reorder-events'
  | 'duplicate-event';

export interface FaultSpec {
  kind: FaultKind;
  atIndex?: number;
  payload?: Record<string, unknown>;
}

/** Apply a fault to a list of records deterministically. */
export function applyFault<T extends { recordId: string }>(records: T[], fault: FaultSpec): T[] {
  switch (fault.kind) {
    case 'truncate-write':
      return records.slice(0, fault.atIndex ?? Math.max(0, records.length - 1));
    case 'corrupt-record': {
      if (!records.length) return records;
      const idx = fault.atIndex ?? records.length - 1;
      const r = records[idx] as unknown as Record<string, unknown>;
      return records.map((rec, i) => (i === idx ? ({ ...rec, recordId: 'CORRUPTED-' + String(rec.recordId) } as unknown as T) : rec));
    }
    case 'reorder-events': {
      const arr = [...records];
      if (arr.length < 2) return arr;
      const a = fault.atIndex ?? 0;
      const b = Math.min(arr.length - 1, a + 1);
      [arr[a], arr[b]] = [arr[b], arr[a]];
      return arr;
    }
    case 'duplicate-event': {
      if (!records.length) return records;
      const idx = fault.atIndex ?? 0;
      return [...records.slice(0, idx + 1), records[idx], ...records.slice(idx + 1)];
    }
    case 'disk-full':
    case 'kill-mid-promotion':
      // These are not data-level faults; they're scheduling faults.
      return records;
  }
}
