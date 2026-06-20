#!/usr/bin/env python3
"""PRAXIS PlanSpec v0.1 — Schema Pack Validation Script

Validates the canonical schema, all examples, and all fixtures against
the PRAXIS PlanSpec v0.1 schema (Draft 2020-12).

Usage:
    python scripts/validate-planspec-v0.1.py

Requirements (optional, degrades gracefully):
    - PyYAML (pyyaml) — YAML parsing
    - jsonschema (jsonschema) — Draft 2020-12 meta-validation and instance validation

Exit codes:
    0 — All validations pass
    1 — Parse or meta-validation failures
    2 — Instance validation failures
    3 — Missing tooling (optional dependencies not available)
"""

import sys
import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = REPO_ROOT / "schemas" / "planspec.v0.1.schema.yaml"

EXAMPLES = [
    ("examples/planspec/runtime-code.plan.yaml", True),
    ("examples/planspec/documentation.plan.yaml", True),
    ("examples/planspec/test-only.plan.yaml", True),
    ("examples/planspec/library-code.plan.yaml", True),
    ("examples/planspec/cli-command.plan.yaml", True),
]

FIXTURES = [
    # PASS fixtures (should validate)
    ("fixtures/planspec/pass/runtime-code-full.plan.yaml", True),
    ("fixtures/planspec/pass/documentation-no-wiring.plan.yaml", True),
    ("fixtures/planspec/pass/test-only-execution.plan.yaml", True),
    ("fixtures/planspec/pass/library-export-surface.plan.yaml", True),
    # HOLD/FAIL fixtures (should NOT validate — schema must reject)
    ("fixtures/planspec/hold/runtime-code-missing-integration-contract.plan.yaml", False),
    ("fixtures/planspec/hold/library-consumer-or-export-missing-proof.plan.yaml", False),
    ("fixtures/planspec/fail/unapproved-finalgate-criterion.plan.yaml", False),
    ("fixtures/planspec/fail/advisory-finalgate-criterion.plan.yaml", False),
    ("fixtures/planspec/fail/code-artifact-mode-none.plan.yaml", False),
    ("fixtures/planspec/fail/repair-report-inconsistent.plan.yaml", False),
]

GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
BOLD = "\033[1m"
RESET = "\033[0m"

passed = 0
failed = 0
total = 0


def ok(msg):
    global passed
    passed += 1
    print(f"  {GREEN}PASS{RESET} {msg}")


def fail(msg):
    global failed
    failed += 1
    print(f"  {RED}FAIL{RESET} {msg}")


def warn(msg):
    print(f"  {YELLOW}WARN{RESET} {msg}")


def load_yaml(path):
    """Try to load YAML, return (data, error_tuple)."""
    try:
        import yaml
    except ImportError:
        return None, ("NO_YAML_MODULE", "pip install pyyaml")

    try:
        with open(path) as f:
            data = yaml.safe_load(f)
        return data, None
    except Exception as e:
        return None, ("YAML_PARSE_ERROR", str(e))


def validate_against_schema(path, data, validator):
    """Validate instance against schema. Return None on success, error string on failure."""
    try:
        validator.validate(data)
        return None
    except Exception as e:
        return str(e)


# ---------------------------------------------------------------------------
# VALIDATION START
# ---------------------------------------------------------------------------
def main():
    global total

    print(f"{BOLD}PRAXIS PlanSpec v0.1 — Schema Pack Validation{RESET}")
    print(f"Schema: {SCHEMA_PATH}")
    print()

    # Check tooling
    try:
        import yaml
    except ImportError:
        print(f"{RED}FATAL: pyyaml not installed. Cannot parse YAML files.{RESET}")
        print("Install: pip install pyyaml jsonschema")
        sys.exit(3)

    try:
        import jsonschema
    except ImportError:
        print(f"{RED}FATAL: jsonschema not installed. Cannot validate schema.{RESET}")
        print("Install: pip install pyyaml jsonschema")
        sys.exit(3)

    # -----------------------------------------------------------------------
    # VAL-001: Schema YAML parses
    # -----------------------------------------------------------------------
    print(f"{BOLD}[VAL-001] Schema YAML parse{RESET}")
    schema_data, err = load_yaml(SCHEMA_PATH)
    if err:
        fail(f"Schema YAML parse: {err[1]}")
    else:
        ok("Schema YAML parsed successfully")
    total += 1

    # -----------------------------------------------------------------------
    # VAL-002: All examples parse
    # -----------------------------------------------------------------------
    print(f"\n{BOLD}[VAL-002] Examples YAML parse{RESET}")
    example_data = {}
    for rel_path, _ in EXAMPLES:
        path = REPO_ROOT / rel_path
        data, err = load_yaml(path)
        if err:
            fail(f"Example '{rel_path}' parse: {err[1]}")
        elif data is None:
            fail(f"Example '{rel_path}' is empty or None")
        else:
            ok(f"Example '{rel_path}' parsed")
            example_data[rel_path] = data
        total += 1

    # -----------------------------------------------------------------------
    # VAL-003: All fixtures parse
    # -----------------------------------------------------------------------
    print(f"\n{BOLD}[VAL-003] Fixtures YAML parse{RESET}")
    fixture_data = {}
    for rel_path, _ in FIXTURES:
        path = REPO_ROOT / rel_path
        data, err = load_yaml(path)
        if err:
            fail(f"Fixture '{rel_path}' parse: {err[1]}")
        elif data is None:
            fail(f"Fixture '{rel_path}' is empty or None")
        else:
            ok(f"Fixture '{rel_path}' parsed")
            fixture_data[rel_path] = data
        total += 1

    # -----------------------------------------------------------------------
    # VAL-004: Schema meta-validates as Draft 2020-12
    # -----------------------------------------------------------------------
    print(f"\n{BOLD}[VAL-004] Schema meta-validation (Draft 2020-12){RESET}")
    try:
        jsonschema.Draft202012Validator.check_schema(schema_data)
        ok("Schema meta-validates as Draft 2020-12")
    except jsonschema.SchemaError as e:
        fail(f"Schema meta-validation failed: {e.message}")
    total += 1

    # -----------------------------------------------------------------------
    # VAL-005: All internal $refs resolve
    # -----------------------------------------------------------------------
    print(f"\n{BOLD}[VAL-005] $ref resolution{RESET}")
    refs = set()

    def collect_refs(node):
        if isinstance(node, dict):
            if "$ref" in node:
                refs.add(node["$ref"])
            for k, v in node.items():
                if k != "$ref":
                    collect_refs(v)
        elif isinstance(node, list):
            for v in node:
                collect_refs(v)

    collect_refs(schema_data)
    def_keys = set(schema_data.get("$defs", {}).keys())
    unresolvable = [r for r in refs if r.replace("#/$defs/", "") not in def_keys]

    if unresolvable:
        fail(f"Unresolvable $refs: {unresolvable}")
    else:
        ok(f"All {len(refs)} $refs resolve ({len(def_keys)} $defs)")
    total += 1

    # Create validator
    validator = jsonschema.Draft202012Validator(schema_data)

    # -----------------------------------------------------------------------
    # VAL-006: PASS examples validate against schema
    # -----------------------------------------------------------------------
    print(f"\n{BOLD}[VAL-006] PASS examples validate against schema{RESET}")
    for rel_path, expects_pass in EXAMPLES:
        data = example_data.get(rel_path)
        if data is None:
            fail(f"Example '{rel_path}' — skipped (parse failed)")
            total += 1
            continue
        err = validate_against_schema(REPO_ROOT / rel_path, data, validator)
        if err and expects_pass:
            fail(f"Example '{rel_path}' — REJECTED (expected PASS): {err[:120]}")
        elif not err and expects_pass:
            ok(f"Example '{rel_path}' — PASS (as expected)")
        elif not err and not expects_pass:
            fail(f"Example '{rel_path}' — PASSED (expected FAIL)")
        elif err and not expects_pass:
            ok(f"Example '{rel_path}' — correctly rejected")
        total += 1

    # -----------------------------------------------------------------------
    # VAL-007: Fixtures — PASS fixtures validate, negative fixtures fail
    # -----------------------------------------------------------------------
    print(f"\n{BOLD}[VAL-007] Fixtures — expected pass/fail validation{RESET}")
    for rel_path, expects_pass in FIXTURES:
        data = fixture_data.get(rel_path)
        if data is None:
            fail(f"Fixture '{rel_path}' — skipped (parse failed)")
            total += 1
            continue
        err = validate_against_schema(REPO_ROOT / rel_path, data, validator)
        if err and expects_pass:
            fail(f"Fixture '{rel_path}' — REJECTED (expected PASS): {err[:120]}")
        elif not err and expects_pass:
            ok(f"Fixture '{rel_path}' — PASS (as expected)")
        elif not err and not expects_pass:
            fail(f"Fixture '{rel_path}' — PASSED (expected FAIL / schema_invalid)")
        elif err and not expects_pass:
            ok(f"Fixture '{rel_path}' — correctly rejected")
        total += 1

    # -----------------------------------------------------------------------
    # VAL-008: No v0.1 required model references forbidden legacy terms
    # -----------------------------------------------------------------------
    print(f"\n{BOLD}[VAL-008] Legacy field absence check{RESET}")
    import subprocess
    try:
        result = subprocess.run(
            ["rg", "-c", "p45Bridge|v411AdapterRequired|runtimeContractVersion|workerMustEchoWorkspaceLockHash",
             str(SCHEMA_PATH)],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode == 0 and result.stdout.strip():
            fail(f"Forbidden legacy terms found in schema: {result.stdout.strip()}")
        else:
            ok("No forbidden legacy terms found in schema")
    except Exception:
        # rg not available, check manually
        schema_text = SCHEMA_PATH.read_text()
        forbidden = ["p45Bridge", "v411AdapterRequired", "runtimeContractVersion", "workerMustEchoWorkspaceLockHash"]
        found = [t for t in forbidden if t in schema_text]
        if found:
            fail(f"Forbidden legacy terms found: {found}")
        else:
            ok("No forbidden legacy terms found in schema")
    total += 1

    # -----------------------------------------------------------------------
    # VAL-009: Key concepts present in schema
    # -----------------------------------------------------------------------
    print(f"\n{BOLD}[VAL-009] Key concepts presence check{RESET}")
    schema_text = SCHEMA_PATH.read_text()
    required_concepts = [
        "artifactPolicy", "integrationContract", "WiringGate", "gateVerdict",
        "repair", "locking", "failedCriteriaOnly", "mayModifyAcceptanceCriteria"
    ]
    missing_concepts = [c for c in required_concepts if c not in schema_text]
    if missing_concepts:
        fail(f"Missing required concepts: {missing_concepts}")
    else:
        ok(f"All {len(required_concepts)} required concepts present in schema")
    total += 1

    # -----------------------------------------------------------------------
    # VAL-010: Schema identity check
    # -----------------------------------------------------------------------
    print(f"\n{BOLD}[VAL-010] Schema identity check{RESET}")
    id_checks = [
        ("planSpecVersion", schema_data.get("properties", {}).get("planSpecVersion", {}).get("const") == "0.1.0"),
        ("kind=ImplementationPlan", schema_data.get("properties", {}).get("kind", {}).get("const") == "ImplementationPlan"),
        ("profile=praxis-v0.1", schema_data.get("properties", {}).get("profile", {}).get("const") == "praxis-v0.1"),
    ]
    all_ok = True
    for name, result in id_checks:
        if result:
            ok(f"{name}")
        else:
            fail(f"{name}")
            all_ok = False
    total += 1

    # -----------------------------------------------------------------------
    # SUMMARY
    # -----------------------------------------------------------------------
    print()
    print(f"{BOLD}{'='*60}{RESET}")
    print(f"{BOLD}VALIDATION SUMMARY{RESET}")
    print(f"{'='*60}")
    print(f"Total checks: {total}")
    print(f"Passed:       {GREEN}{passed}{RESET}")
    print(f"Failed:       {RED}{failed if failed > 0 else 0}{RESET}")
    print()

    if failed == 0:
        print(f"{GREEN}{BOLD}ALL VALIDATIONS PASS{RESET}")
        print("Schema pack is ready for lock.")
        sys.exit(0)
    else:
        print(f"{RED}{BOLD}VALIDATION FAILURES DETECTED{RESET}")
        print(f"Fix {failed} failing check(s) before locking schema pack.")
        sys.exit(2)


if __name__ == "__main__":
    main()
