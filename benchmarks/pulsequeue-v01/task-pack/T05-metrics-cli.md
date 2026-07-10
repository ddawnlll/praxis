# T05 — Metrics ve Dead-Job Replay CLI

## Objective

Operasyonel gözlemlenebilirlik eklenecek: metrics endpoint'i ve
dead job'ları yeniden kuyruğa sokan CLI komutu.

## Acceptance Criteria

1. `GET /metrics` endpoint'i her status için doğru job sayısını döndürür.
2. Metrics endpoint'i read-only çalışır (POST/PUT/DELETE yapamaz).
3. Metrics, mevcut job state'ini yansıtır (cache değil, gerçek zamanlı).
4. `replay-dead` CLI komutu `bun run src/cli/replay-queue.ts replay-dead` ile çalışır.
5. CLI yalnızca `dead` job'ları `queued` yapar; diğer status'lere dokunmaz.
6. CLI exit code ve output deterministiktir (status mesajı + sayılar).
7. CLI gerçek application repository'sini kullanır; ayrı/orphan implementation değildir.
8. `queued` yapılan job'ların attemptCount'u sıfırlanır.
9. CLI, state dosyasını doğrudan değil repository üzerinden değiştirir.
10. Metrics, CLI sonrası güncel durumu yansıtır.
11. Typecheck, targeted tests ve full suite geçer.
12. README'de yalnızca gerçekten çalışan komutlar belgelenir.

## Metrics Response Format

```json
{
  "queued": 5,
  "running": 2,
  "completed": 100,
  "failed": 3,
  "dead": 1,
  "cancelled": 0,
  "total": 111
}
```

## CLI Output Format

```
Replayed 3 dead jobs to queued.
Total dead: 0
Total queued: 8
```

## Mevcut Durum

- `src/cli/replay-queue.ts` — stub halinde, sadece "not implemented" mesajı basar.
- Metrics endpoint'i henüz yok.
- README'de CLI için yalnızca placeholder var.
