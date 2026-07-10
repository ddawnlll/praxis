# T01 — Idempotent Job Creation

## Objective

`POST /jobs` endpoint'ini uygula. Job'lar idempotency key ile yaratılmalı,
eşzamanlı (concurrent) istekler yalnızca tek job oluşturmalı.

## Acceptance Criteria

1. `POST /jobs` geçerli payload ile `201 Created` döndürür.
2. Her job için benzersiz ID oluşturulur.
3. `Idempotency-Key` header'ı zorunludur; eksikse `400 Bad Request`.
4. Aynı key ile tekrar gönderilen istek aynı job ID'sini döndürür (status 201/200).
5. Aynı key ile eşzamanlı iki istek yalnızca tek job oluşturur.
6. Eksik veya geçersiz payload `400` döndürür.
7. Route gerçek server entrypoint'ine bağlanmıştır (curl ile erişilebilir).
8. İlgili tüm testler çalıştırılmış ve geçmiştir.
9. Mevcut tüm testler (health, queue, worker) hâlâ geçmektedir.
10. TypeScript type check hatasız geçer.

## Payload Format

```json
{
  "type": "send-email",
  "payload": {
    "to": "user@example.com",
    "subject": "Hello"
  }
}
```

## Validasyon Kuralları

- `type` alanı zorunlu ve string olmalı
- `payload` optional, object olmalı
- `Idempotency-Key` header'ı zorunlu (string, boş olmayan)
- Geçersiz JSON body → 400 Bad Request

## Varolan Route Dosyası

`src/routes/jobs.ts` — bu dosyada temel bir `createJobRouter` fonksiyonu var
ama **server'a register edilmemiş** olabilir. Wire etmeyi unutma.
