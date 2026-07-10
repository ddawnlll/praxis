# PRAXIS A/B Benchmark v0.1

PulseQueue job queue servisi üzerinde Praxis Truth Kernel'in completion
authority olarak etkinliğini ölçen A/B benchmark.

## Hızlı Başlangıç

```bash
# Benchmark yapısını görüntüle
tree benchmarks/pulsequeue-v01/

# Seed repository'yi clone'la (her run için ayrı)
git clone /workspace/pulsequeue-seed /tmp/pulsequeue-run-001
cd /tmp/pulsequeue-run-001
bun install
```

## Dosya Yapısı

```
benchmarks/pulsequeue-v01/
├── README.md                   # Bu dosya
├── protocol.md                 # Deney protokolü
├── seed-manifest.json          # Seed repo metadata
├── task-pack/                  # Task açıklamaları (acceptance criteria)
│   ├── T01-idempotency.md
│   ├── T02-retry.md
│   ├── T03-persistence.md
│   ├── T04-cancellation.md
│   └── T05-metrics-cli.md
├── plans/                      # Praxis PlanSpec dosyaları
│   ├── T01.plan.yaml
│   ├── T02.plan.yaml
│   ├── T03.plan.yaml
│   ├── T04.plan.yaml
│   └── T05.plan.yaml
├── prompts/                    # Agent prompt templates
│   ├── baseline.md
│   └── praxis.md
├── scoring/                    # Scoring ve aggregation
│   ├── result.schema.json
│   ├── score-run.ts
│   └── aggregate-results.ts
├── hidden-evaluator/           # Bağımsız hidden evaluator
│   ├── T01-eval.ts
│   ├── T02-eval.ts
│   ├── T03-eval.ts
│   ├── T04-eval.ts
│   └── run-all.ts
└── results/                    # Run sonuçları
    └── .gitkeep
```
