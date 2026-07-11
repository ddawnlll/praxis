// @praxis/protocol — schema validator (hand-rolled, no Ajv)
//
// Validates a JSON value against one of the v1 contracts. The schemas are
// closed (additionalProperties:false) and self-describing, so we can
// implement a focused validator without pulling in Ajv. The validator is
// intentionally minimal — it covers the rules that the protocol needs to
// enforce (type, enum, const, pattern, required, format, minLength, maxLength,
// minItems, additionalProperties).

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMAS_DIR = resolve(__dirname, '..', 'schemas');

export type SchemaName =
  | 'protocol-v1'
  | 'verification-policy-v1'
  | 'candidate-manifest-v1'
  | 'evidence-bundle-v1'
  | 'verification-receipt-v1';

const SCHEMA_FILES: Record<SchemaName, string> = {
  'protocol-v1': 'protocol-v1.schema.json',
  'verification-policy-v1': 'verification-policy-v1.schema.json',
  'candidate-manifest-v1': 'candidate-manifest-v1.schema.json',
  'evidence-bundle-v1': 'evidence-bundle-v1.schema.json',
  'verification-receipt-v1': 'verification-receipt-v1.schema.json',
};

const schemaCache = new Map<SchemaName, Record<string, unknown>>();

function loadSchema(name: SchemaName): Record<string, unknown> {
  const cached = schemaCache.get(name);
  if (cached) return cached;
  const path = resolve(SCHEMAS_DIR, SCHEMA_FILES[name]);
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  schemaCache.set(name, raw);
  return raw;
}

export interface ValidationIssue {
  path: string;
  message: string;
  keyword: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

const HEX64 = /^[a-f0-9]{64}$/;
const ISO8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function validate(name: SchemaName, value: unknown): ValidationResult {
  const schema = loadSchema(name);
  const issues: ValidationIssue[] = [];
  validateValue(schema, value, '', issues);
  return { ok: issues.length === 0, issues };
}

export function assertValid<T>(name: SchemaName, value: T): T {
  const r = validate(name, value);
  if (!r.ok) {
    const detail = r.issues.map((i) => `${i.path}: ${i.message}`).join('; ');
    throw new Error(`Schema ${name} validation failed: ${detail}`);
  }
  return value;
}

function validateValue(
  schema: unknown,
  value: unknown,
  path: string,
  issues: ValidationIssue[]
): void {
  if (typeof schema !== 'object' || schema === null) return;

  // const
  if ('const' in schema) {
    if (!deepEqual(value, (schema as { const: unknown }).const)) {
      issues.push({ path, message: `must be equal to constant ${JSON.stringify((schema as { const: unknown }).const)}`, keyword: 'const' });
    }
  }

  // type
  if ('type' in schema) {
    const t = (schema as { type: string | string[] }).type;
    const types = Array.isArray(t) ? t : [t];
    if (!types.some((tt) => matchesType(tt, value))) {
      issues.push({ path, message: `type mismatch: expected one of [${types.join(', ')}]`, keyword: 'type' });
      return; // don't continue if type is wrong
    }
  }

  // enum
  if ('enum' in schema) {
    const en = (schema as { enum: unknown[] }).enum;
    if (!en.some((e) => deepEqual(e, value))) {
      issues.push({ path, message: `not in enum`, keyword: 'enum' });
    }
  }

  // pattern (strings only)
  if ('pattern' in schema && typeof value === 'string') {
    const re = new RegExp((schema as { pattern: string }).pattern);
    if (!re.test(value)) {
      issues.push({ path, message: `does not match pattern ${(schema as { pattern: string }).pattern}`, keyword: 'pattern' });
    }
  }

  // format (date-time, only for strings)
  if ('format' in schema && typeof value === 'string') {
    const fmt = (schema as { format: string }).format;
    if (fmt === 'date-time' && !ISO8601.test(value)) {
      issues.push({ path, message: `not a valid date-time`, keyword: 'format' });
    }
  }

  // string length
  if (typeof value === 'string') {
    const minLen = (schema as { minLength?: number }).minLength;
    const maxLen = (schema as { maxLength?: number }).maxLength;
    if (minLen !== undefined && value.length < minLen) {
      issues.push({ path, message: `string shorter than minLength ${minLen}`, keyword: 'minLength' });
    }
    if (maxLen !== undefined && value.length > maxLen) {
      issues.push({ path, message: `string longer than maxLength ${maxLen}`, keyword: 'maxLength' });
    }
  }

  // array constraints
  if (Array.isArray(value)) {
    const minItems = (schema as { minItems?: number }).minItems;
    if (minItems !== undefined && value.length < minItems) {
      issues.push({ path, message: `fewer items than minItems ${minItems}`, keyword: 'minItems' });
    }
    const items = (schema as { items?: unknown }).items;
    if (items !== undefined) {
      const seen = new Set<unknown>();
      const unique = (schema as { uniqueItems?: boolean }).uniqueItems;
      for (let i = 0; i < value.length; i++) {
        validateValue(items, value[i], `${path}/${i}`, issues);
        if (unique) {
          const key = JSON.stringify(value[i]);
          if (seen.has(key)) {
            issues.push({ path, message: `duplicate items at index ${i}`, keyword: 'uniqueItems' });
          }
          seen.add(key);
        }
      }
    }
  }

  // object constraints
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const properties = (schema as { properties?: Record<string, unknown> }).properties ?? {};
    const required = (schema as { required?: string[] }).required ?? [];
    for (const k of required) {
      if (!(k in obj)) {
        issues.push({ path: `${path}/${k}`, message: `missing required field`, keyword: 'required' });
      }
    }
    const additional = (schema as { additionalProperties?: boolean | object }).additionalProperties;
    if (additional === false) {
      const allowed = new Set<string>(Object.keys(properties));
      for (const k of Object.keys(obj)) {
        if (!allowed.has(k)) {
          issues.push({ path: `${path}/${k}`, message: `additional property not allowed`, keyword: 'additionalProperties' });
        }
      }
    }
    for (const k of Object.keys(properties)) {
      if (k in obj) {
        validateValue(properties[k], obj[k], `${path}/${k}`, issues);
      }
    }
  }

  // $defs: nothing to do; ref resolution is inline via the schema author.
  // This validator is intentionally closed: every $ref is already inlined in
  // the schema files (we don't use $ref to $defs).
}

function matchesType(t: string, value: unknown): boolean {
  switch (t) {
    case 'null': return value === null;
    case 'boolean': return typeof value === 'boolean';
    case 'string': return typeof value === 'string';
    case 'number':
    case 'integer': return typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) ? t === 'number' : true);
    case 'array': return Array.isArray(value);
    case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value);
    default: return false;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
      return true;
    }
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao);
    const bk = Object.keys(bo);
    if (ak.length !== bk.length) return false;
    for (const k of ak) if (!deepEqual(ao[k], bo[k])) return false;
    return true;
  }
  return false;
}

// Re-export the pattern check above; keeping this to make the file grep-able.
export const PATTERNS = { HEX64, ISO8601 } as const;
