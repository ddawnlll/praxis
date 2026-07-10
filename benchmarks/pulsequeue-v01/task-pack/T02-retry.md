# T02 — Retry ve Dead-Letter State Machine

## Objective

Worker başarısız job'ları otomatik olarak yeniden denesin. Belirli sayıda
başarısız denemeden sonra job `dead` durumuna geçsin.

## Acceptance Criteria

1. Worker, başarısız job'ları otomatik olarak yeniden dener.
2. Durum geçişleri `queued → running → retrying → dead` şeklindedir.
3. En fazla 3 execution attempt yapılır (ilki dahil).
4. Üçüncü başarısız attempt sonrasında job `dead` olur.
5. Başarılı retry sonrasında job `completed` olur.
6. Retry zamanı fake clock ile deterministik test edilebilir.
7. Unit testlerde gerçek `setTimeout`/`sleep` kullanılmaz.
8. Retry edilen job aynı anda iki worker tarafından çalıştırılamaz (concurrent safety).
9. Job `failed` state'ten `retrying` state'ine geçer, sonra `running` olur.
10. `dead` job'lar tekrar çalıştırılamaz.
11. Tüm eski testler geçmeye devam eder.
12. TypeScript type check hatasız geçer.

## Detaylı State Machine

```
create → queued
         ↓
      running  ←──────┐
         ↓             │
      failed ──retry──┘   (attemptCount < maxAttempts)
         ↓
       dead              (attemptCount >= maxAttempts)

       running → completed  (on success)
```

## Mevcut Worker

`src/queue/worker.ts` — temel `executeJob` var ama retry mantığı henüz
eklenmemiş. Worker'ın `start()` metodu da polling yapmıyor (boş).
