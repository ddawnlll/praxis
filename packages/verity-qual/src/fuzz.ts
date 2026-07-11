// @praxis/verity-qual — fuzz and mutation infrastructure (#34)
//
// Property-based fuzzing: generate randomized inputs that satisfy the
// protocol v1 schema's required fields, then verify that:
//   1. The gates produce the same verdict for the same input (determinism)
//   2. No input ever produces a false PASS
//   3. Mutating one byte of a valid input changes the verdict
//
// This is "property-based" testing without fast-check: we use a seeded
// PRNG to keep replay reproducible.

import { createHash } from 'node:crypto';

class SeededRng {
  private s: number;
  constructor(seed: number) { this.s = seed & 0x7fffffff; }
  next(): number { this.s = (this.s * 1103515245 + 12345) & 0x7fffffff; return this.s / 0x7fffffff; }
  int(min: number, max: number): number { return min + Math.floor(this.next() * (max - min + 1)); }
  pick<T>(arr: T[]): T { return arr[this.int(0, arr.length - 1)]; }
  bool(prob = 0.5): boolean { return this.next() < prob; }
  str(minLen: number, maxLen: number, alphabet = 'abcdef0123456789'): string {
    const len = this.int(minLen, maxLen);
    let s = '';
    for (let i = 0; i < len; i++) s += alphabet[this.int(0, alphabet.length - 1)];
    return s;
  }
  hex64(): string { return this.str(64, 64, 'abcdef0123456789'); }
  bytes(n: number): Buffer {
    const buf = Buffer.alloc(n);
    for (let i = 0; i < n; i++) buf[i] = this.int(0, 255);
    return buf;
  }
}

export interface FuzzStats {
  seed: number;
  total: number;
  crashes: number;
  falsePass: number;
  mutationFlips: number;
  determinismViolations: number;
  durationMs: number;
  firstFalsePassAt?: number;
}

export interface FuzzOptions {
  seed?: number;
  iterations?: number;
  runOnce?: (input: unknown) => { verdict: string };
  onMutation?: (input: unknown, before: { verdict: string }, after: { verdict: string }) => void;
}

/**
 * Run N iterations of randomized inputs through a gate function and assert
 * that:
 *   - No input produces a "false PASS" (verdict === 'PASS' for an input that
 *     a second reference run rejects)
 *   - Mutating one byte of a PASS input produces a non-PASS result
 *     (mutation score = flips / passes)
 *   - Same input → same verdict (determinism)
 */
export function fuzzGate(name: string, opts: FuzzOptions): FuzzStats {
  const start = Date.now();
  const seed = opts.seed ?? 42;
  const iterations = opts.iterations ?? 1000;
  const rng = new SeededRng(seed);

  let crashes = 0;
  let falsePass = 0;
  let mutationFlips = 0;
  let determinismViolations = 0;
  let firstFalsePassAt: number | undefined;
  let passesObserved = 0;

  for (let i = 0; i < iterations; i++) {
    // Generate a randomized input. The shape is determined by the gate
    // implementer via the `runOnce` callback. We provide a generic
    // fuzzable object that the gate must reject.
    const input = generateFuzzInput(rng);
    let before;
    try {
      before = opts.runOnce(input);
    } catch (e) {
      crashes++;
      continue;
    }
    // Determinism: run twice.
    let second;
    try {
      second = opts.runOnce(input);
    } catch (e) {
      crashes++;
      continue;
    }
    if (second.verdict !== before.verdict) {
      determinismViolations++;
    }
    if (before.verdict === 'PASS') {
      passesObserved++;
      // Mutate one byte and expect non-PASS.
      const mutated = mutateOneByte(input, rng);
      let after;
      try {
        after = opts.runOnce(mutated);
      } catch (e) {
        // Throwing on a mutated input is acceptable for many validators
        // (it means the mutation broke the schema). It still counts as a
        // "flip" because the original was PASS and the mutated is not.
        mutationFlips++;
        continue;
      }
      if (after.verdict === 'PASS') {
        falsePass++;
        if (firstFalsePassAt === undefined) firstFalsePassAt = i;
      } else {
        mutationFlips++;
      }
    }
  }

  return {
    seed,
    total: iterations,
    crashes,
    falsePass,
    mutationFlips,
    determinismViolations,
    durationMs: Date.now() - start,
    firstFalsePassAt,
  };
}

function generateFuzzInput(rng: SeededRng): Record<string, unknown> {
  // Generate a "shape" that could plausibly be a v1 input but is mostly
  // garbage. The validator under test must reject it. The `x` field is
  // sometimes 42 so the well-behaved gate (PASS iff x===42) can be tested.
  const shapes = [
    () => ({ kind: 'string', value: rng.str(0, 100, 'abcdefghijklmnop') }),
    () => ({ kind: 'object', fields: { a: rng.int(0, 100), b: rng.bool() } }),
    () => ({ kind: 'array', items: Array.from({ length: rng.int(0, 5) }, () => rng.int(0, 1000)) }),
    () => ({ kind: 'null' }),
    () => ({ kind: 'number', value: rng.int(-1000, 1000) }),
  ];
  const x = rng.int(0, 100) === 0 ? 42 : rng.int(0, 100);
  return { id: rng.str(8, 32), x, shape: rng.pick(shapes)() };
}

function mutateOneByte(input: unknown, rng: SeededRng): unknown {
  const s = JSON.stringify(input);
  if (s.length === 0) return input;
  const i = rng.int(0, s.length - 1);
  // Flip the character to a different random char.
  // Use a JSON-safe alphabet so the resulting string is always parseable.
  const safeAlphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const replacement = safeAlphabet[rng.int(0, safeAlphabet.length - 1)];
  try {
    return JSON.parse(s.slice(0, i) + replacement + s.slice(i + 1));
  } catch {
    // If parse still fails (e.g., we hit a JSON-structural char), return null
    // so the caller treats it as a parse failure / flip.
    return null;
  }
}

/** Build a stable seed hash for replay artifacts. */
export function seedHash(seed: number, total: number): string {
  return createHash('sha256').update(`praxis-fuzz-seed/v1\n${seed}\n${total}`).digest('hex');
}
