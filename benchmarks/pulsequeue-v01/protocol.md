# PRAXIS A/B Benchmark v0.1 — PulseQueue

Bu benchmark, Praxis Truth Kernel'in completion authority olarak etkinliğini
ölçmek için tasarlanmıştır.

## Deney Tasarımı

İki kol:

- **Baseline (A)**: Agent kendi testleri ve kontrolleriyle "done" der. Praxis yok.
- **Praxis (B)**: Agent "done" dedikten sonra `praxis verify` çalışır. HOLD/FAIL
  durumunda repair packet ile en fazla 3 repair turu.

Her task için 2 bağımsız tekrar (toplam 20 task-run).

## Protocol

1. Seed repository'nin temiz bir clone'u hazırlanır.
2. Task sırası rastgele seçilir (bazı tasklarda önce baseline, bazılarında önce praxis).
3. Agent'a task prompt'u verilir.
4. Agent "done" dediğinde:
   - Baseline: durur, hidden evaluator çalıştırılır.
   - Praxis: `praxis verify` çalışır, HOLD/FAIL durumunda repair packet üretilir.
5. Maximum 3 repair turu.
6. Tüm sonuçlar kaydedilir.

## Adalet Koşulları

Her paired run'da aşağıdakiler aynı olmalıdır:

- Model adı ve sürümü
- Provider
- Thinking seviyesi
- System prompt
- Task prompt
- Tool izinleri
- Network erişimi
- Başlangıç commit'i
- Environment variables
- CPU/RAM sınırı
- Max wall-clock süre
- Max repair turu (3)

## Ölçümler

| Metrik | Açıklama |
|--------|----------|
| False Done Rate | Agent "done" dediği hâlde hidden evaluator başarısız |
| First-claim completion | İlk "done"da tam geçen task sayısı |
| Final completion | Repair turları sonrası geçen task sayısı |
| Praxis false-PASS | Praxis PASS verdiği hâlde hidden evaluator başarısız |
| Repair efficiency | Kaç hidden failure düzelttiği |
| Token/süre/maliyet overhead | Ek maliyet ölçümleri |

## GO/NO-GO Kriterleri

- False Done Rate ≥ %50 azalma
- Final completion anlamlı artış
- Praxis false-PASS = 0
- Ek maliyet kabul edilebilir
- Repair packet'ler gerçek başarısız kriterlere yöneliyor
