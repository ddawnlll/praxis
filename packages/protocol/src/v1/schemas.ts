// @praxis/protocol — schema loader (Ajv-backed, JSON-Schema 2020-12).
//
// All v1 contracts validate against the JSON Schemas in /schemas/. The
// schemas are loaded once at module init and reused for every validation.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

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

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const validators = new Map<SchemaName, ReturnType<typeof ajv.compile>>();

function load(name: SchemaName) {
  if (validators.has(name)) return validators.get(name)!;
  const path = resolve(SCHEMAS_DIR, SCHEMA_FILES[name]);
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  const validate = ajv.compile(raw);
  validators.set(name, validate);
  return validate;
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

export function validate(name: SchemaName, value: unknown): ValidationResult {
  const validateFn = load(name);
  const ok = validateFn(value) as boolean;
  const issues: ValidationIssue[] = [];
  if (!ok && validateFn.errors) {
    for (const err of validateFn.errors) {
      issues.push({
        path: err.instancePath || '/',
        message: err.message ?? 'unknown',
        keyword: err.keyword,
      });
    }
  }
  return { ok, issues };
}

/** Throws on validation failure; returns the input value for chaining. */
export function assertValid<T>(name: SchemaName, value: T): T {
  const r = validate(name, value);
  if (!r.ok) {
    const detail = r.issues.map((i) => `${i.path}: ${i.message}`).join('; ');
    throw new Error(`Schema ${name} validation failed: ${detail}`);
  }
  return value;
}
