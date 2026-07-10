# Kol B — Praxis

Aşağıdaki task'ı implemente et.

## Talimatlar

1. Projeyi ve mevcut kodu anla.
2. Task'teki acceptance criteria'ların tamamını karşıla.
3. Testlerini yaz ve çalıştır.
4. TypeScript type check hatasız olmalı.
5. Mevcut testlerde regression olmamalı.
6. İşin bittiğini düşündüğünde "DONE" de.

## Önemli: Completion Authority

Bu kol **Praxis Truth Kernel** tarafından denetleniyor.

"done" dedikten sonra `praxis verify` çalışacak. Eğer HOLD veya FAIL
sonucu alırsan, Praxis bir **repair packet** üretecek. Bu packet'i
dikkatlice oku ve eksikleri düzelt.

En fazla 3 repair turun var. Her turdan sonra tekrar "DONE" diyebilirsin.

Praxis'in belirttiği kısıtlamalara uy:
- Yalnızca izin verilen dosyaları değiştir
- Yasaklı dosyalara dokunma
- Testleri atlama
- Yeni bağımlılık ekleme

## Task Açıklaması

{{TASK_DESCRIPTION}}

## Acceptance Criteria

{{ACCEPTANCE_CRITERIA}}

## Başlangıç

Seed repository hazır. `bun install` yapıldı. Mevcut testler çalışıyor.
Praxis PlanSpec kilitli ve hazır.
