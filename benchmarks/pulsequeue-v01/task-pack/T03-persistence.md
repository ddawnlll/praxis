# T03 — Restart Persistence

## Objective

Job state diske kaydedilecek ve server restart sonrasında geri yüklenecek.

## Acceptance Criteria

1. `queued`, `retrying`, `completed`, `dead` ve `cancelled` job'lar diske kaydedilir ve restart'ta korunur.
2. Restart sırasında `running` durumundaki job tekrar `queued` yapılır (crash recovery).
3. Eksik state dosyası boş state olarak kabul edilir (hata değil).
4. Bozuk JSON dosyası açık ve kontrollü hata mesajı üretir; process crash olmaz.
5. Yazma işlemi geçici dosya + rename ile atomik yapılır (write atomicity).
6. İki eşzamanlı write state dosyasını bozamaz (concurrent write safety).
7. Restart sonrası server çalışmaya devam eder.
8. State dosyası, yeni job yaratıldığında veya status değiştiğinde güncellenir.
9. Tüm eski testler geçer.
10. TypeScript type check hatasız geçer.

## Persistence Detayları

- State dosya yolu: `process.env.STATE_PATH ?? "./pulsequeue-state.json"`
- Format: JSON array of Job objects
- Atomic write: dosyayı önce `.tmp` uzantısıyla yaz, sonra rename
- Okuma: dosya yoksa → boş state; dosya bozuksa → hata logla + boş state

## Mevcut Durum

Repository yalnızca in-memory. `InMemoryJobRepository`'nin diske yazma
yeteneği yok. Agent ya repository'e persistence eklemeli ya da wrapper
bir `PersistentJobRepository` oluşturmalı.
