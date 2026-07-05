# Day 0 Claude Code Spike Report

**Date:** 2026-07-05T17:03:51.519Z
**Claude Code Version:** 2.1.201
**API Base:** http://localhost:3456
**Verdict:** **GO**
**Pass:** 9 / **Fail:** 0
**Duration:** 134.7s

## Test Results

| T001 | ✅ PASS | allOk=true varianceOk=true hasResult=true median=6449ms |
| T002 | ✅ PASS | preTool=true sessionId=true count=1 |
| T003 | ✅ PASS | postTool=true result=true count=1 |
| T004a | ✅ PASS | result=true stopReason=true |
| T004b | ✅ PASS | result=true stopReason=true |
| T005 | ✅ PASS | writeCaptured=true fileExists=true contentMatch=true |
| T006 | ✅ PASS | sessions=2 isolated=true ids=b195f200-7208-405d-aa7a-1d2ac588452d,d48106aa-8d12-4689-ae00-1fb529d00d12 |
| T007 | ✅ PASS | result=true error=false clean=true |
| T008 | ✅ PASS | events=32 toolUse=1 results=1 |

## GO/NO-GO Criteria

### ✅ GO — Primary path is viable

All tests passed. Claude Code headless mode works reliably with the 3456 proxy. Hook events are captured via stream-json. Stop/reason events are present.

## Evidence Archive

```
spike-results/
├── t001-headless/
├── t002-pretool-hook/
├── t003-posttool-hook/
├── t004-stop-hook/
├── t005-divergence/
├── t006-concurrent/
├── t007-rate-limit/
├── t008-spool-fallback/
└── GO-NOGO-REPORT.md
```
