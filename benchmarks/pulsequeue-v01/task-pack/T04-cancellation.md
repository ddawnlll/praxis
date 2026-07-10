# T04 — Cancellation ve Concurrency

## Objective

Job cancellation desteği eklenecek. Hem HTTP endpoint hem de state machine
düzeyinde çalışmalı.

## Acceptance Criteria

1. `POST /jobs/:id/cancel` endpoint'i `queued` veya `retrying` job'ları iptal eder.
2. `running` job için cancel isteği `409 Conflict` döndürür.
3. `completed`, `dead` veya zaten `cancelled` job tekrar iptal edilemez (uygun hata).
4. Aynı job için eşzamanlı cancel ve start işlemleri tutarlı sonuç verir (race condition safe).
5. Cancel endpoint'i server'a bağlanmıştır (curl ile erişilebilir).
6. Cancellation state restart sonrasında korunur (T03 ile uyumlu).
7. Cancelled job worker tarafından çalıştırılamaz.
8. Worker cancel kontrolü yapar: `running` job cancel edilmeye çalışılırsa worker durur.
9. Tüm eski testler geçer.
10. TypeScript type check hatasız geçer.

## Cancellation State Machine

```
queued → cancelled
retrying → cancelled
running → (409 — önce durdur, sonra cancel)
completed → (hata)
dead → (hata)
cancelled → (hata)
```

## Mevcut Durum

Cancel endpoint'i henüz yok. `JobStatus` tipinde `cancelled` zaten tanımlı
(`src/queue/types.ts`). Worker'da cancel kontrolü yok.
