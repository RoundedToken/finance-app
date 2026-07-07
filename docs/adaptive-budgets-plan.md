# Адаптивные бюджеты (RBAR) — план реализации

> Технический план к **SPEC-023** (`specs/SPEC-023-adaptive-budgets.md`). Статус: **план, не реализация.**
> Механизм: **RBAR — Robust Baseline + Asymmetric Ratchet.** Источник дизайна: research-workflow 2026-05-31
> (8 семейств алгоритмов, верификация на 29 мес данных). Решения owner'а: advisory-first, линза-подсказка,
> `S_MAX=8%` (консервативно), все категории сразу.

---

## 0. TL;DR механизма

Лимит **трекает робастную базовую линию**, а не наоборот. Per-категория:

1. **Классификатор** → архетип (`fixed | recurring | seasonal | lumpy | intermittent | cold-start`) из истории.
2. **Layer 1 — база `B_t`**: damped-Holt (level+trend) на winsorized данных → честный прогноз `B_next`. Умеет расти/падать.
3. **Layer 2 — лимит**: `L = max(FLOOR, B_next·(1+margin))`, поджимаемый асимметричным «давлением экономии», с slew-rate, turbulence-gain, breach-rollback.
4. **Маршрутизация по архетипу**: recurring/seasonal → месячный контур; lumpy → годовой конверт (sinking fund); fixed → трекинг + change-point алерт.

**Anti-drift инвариант (главное):** лимит идёт ВВЕРХ только при подтверждённом росте базы ≥3 мес, НИКОГДА из одного перебора. Без этого наивная асимметрия дрейфует +23–35% из шума и анти-экономит.

**Состояние не хранится** — реплеится из `expenses` (идемпотентно). Всё white-box, O(месяцев·категорий), детерминированно.

---

## 1. Формулы RBAR (референс для `rbar.ts`)

Обозначения: `x_t` — факт траты категории за месяц `t` (EUR, date-aware `toEurAt`). `med`, `MAD` — по trailing-окну `W=min(N,18)`. `σ_MAD = 1.4826·MAD`. `CoV = σ_MAD / max(med, ε)`.

### 1.1 Классификатор архетипа (раз в квартал / при настройке)
Метрики на **winsorized** (Hampel ±3·σ_MAD) ряде. Дерево (порядок важен):
```
N < 6                                            → cold-start   (адаптация off, лимит=med/ручной)
zero_frac ≥ 0.40  OR  (CoV ≥ 1.2 AND med < 0.5·mean) → lumpy   (годовой конверт)
med < 25€ AND mean < 40€                          → intermittent (фикс. потолок, без статистики)
CoV ≤ 0.15 AND |slope_TS|/med < 0.01/мес          → fixed       (трекинг медианы + change-point)
ACF(lag-12) > 0.4   (нужно N≥24)                  → seasonal    (recurring + YoY)
иначе (0.15<CoV<1.2, низкий zero_frac)            → recurring   (полный контур)
```
`slope_TS` = Theil-Sen наклон (робастный, не OLS: на спайке OLS=72 vs TS=8). **Гистерезис:** архетип не меняется, пока метрика не уйдёт за порог на >15% (анти-дрожание границы).

### 1.2 Recurring / seasonal — полный контур (шаг месяца)
Состояние (всё реплеится): `B_lvl, B_trd, σ_R, streak_under, streak_baseline_up, L_comfort`.
```
1) winsorize:   x' = clip(x_t, B_lvl − 3·σ_MAD, B_lvl + 3·σ_MAD)
2) damped-Holt (α=0.25, β=0.08, φ=0.9):
     B_lvl' = α·x' + (1−α)·(B_lvl + φ·B_trd)
     B_trd' = β·(B_lvl' − B_lvl) + (1−β)·φ·B_trd
     B_next = B_lvl' + φ·B_trd'
3) target:      margin = 0.05  (→ 0.02 при streak_under ≥ 2)
     L_target = max(FLOOR, B_next·(1 + margin))
4) turbulence:  g = clamp(1 − (CoV − 0.4)/1.6, 0.3, 1.0)
5) slew + decision-deadband:
     Δ = L_target − L_t
     if |Δ| < 0.005·L_t:  HOLD (не двигаем)
     else:  L_raw = L_t + clamp(Δ, −STEP_DOWN·L_t, +g·STEP_UP·L_t)   # STEP_DOWN=0.025, STEP_UP=0.05
6) АСИММЕТРИЯ + ANTI-DRIFT:
     up-move разрешён ТОЛЬКО если streak_baseline_up ≥ 3  ИЛИ  rollback ниже.
     if x_t > L_t AND streak_baseline_up < 3:  L_raw = min(L_raw, L_t)   # запрет роста из перебора
7) breach-rollback (G_up=0.25):
     if x_t > L_t·(1 + G_up):  L_{t+1} = max(L_raw, L_comfort)   # сильный перебор → к комфорту
     else:                      L_{t+1} = L_raw
8) FLOOR = max(floor_eur_ручной, 0.6·med_12)                      # НЕ ratchet от текущей median
9) обновить счётчики:
     streak_under       = (x_t ≤ L_t) ? +1 : 0
     streak_baseline_up = (B_lvl' > B_lvl·1.005) ? +1 : 0
     L_comfort          = робастная (median не-сжатых лимитов за 3 мес)   # НЕ max (риск-фикс из исследования)
     S = накопленное давление, кэп S_MAX = 0.08 (owner: консервативно)
```
**Кэп суммарного сжатия `S_MAX=0.08`:** лимит не может быть сжат относительно базы более чем на 8% накопленно (`L ≥ B_next·(1 − S_MAX)`), даже при длинной серии экономии — реалистичный пол давления.

**Reason-codes** (для `reason_text` и лога): `SAVINGS_STREAK` (поджали после серии), `TRACKING_DOWN` (база падает), `TRACKING_UP` (подтверждённый рост ≥3 мес), `HOLD_AFTER_BREACH` (разовый перебор), `ROLLBACK` (сильный перебор), `FLOOR_HIT`, `COLD_START`.

### 1.3 Детектор сигнал-vs-шум (recurring/seasonal)
One-sided **CUSUM** на detrended-остатках `e_t = x' − B_next`:
```
C_hi = max(0, C_hi + e_t − k),   C_lo = max(0, C_lo − e_t − k),   k = 0.5·σ_MAD
C_lo > h (h=4·σ_MAD) → подтверждённый сдвиг базы ВНИЗ  → разрешить доп. поджатие
C_hi > h             → подтверждённый рост            → разрешить up-move
```
Одиночный winsorized всплеск даёт ≈2.5σ−k ≈ 63% от h → НЕ триггерит (по построению). Seasonal: CUSUM на YoY-остатках `x_t − x_{t−12}`, не месяц-к-месяцу (зимний пик = ожидаемый seas, не сигнал).

### 1.4 Lumpy — годовой конверт (sinking fund)
Месячный лимит НЕ применяется (`med=0, MAD=0 → div-by-zero, floor=0` — доказанный баг).
```
annual_envelope = max( Quantile_0.80({скользящие 12-мес суммы за последние годы}),
                       1.1 · sum(last 12 winsorized) )
accrual_monthly = annual_envelope / 12
accrued(t)      = Σ_{i≤t} accrual − Σ_{i≤t} spent_i      (реплей; cap = 12·accrual)
alert           = (spent_trailing_12m > annual_envelope · 1.15)
```
Сдвиг уровня = CUSUM на скользящей 12-мес сумме (h=5σ, консервативно — окна перекрываются). Lens: «в конверте осталось `accrued` €». Пересчёт envelope раз в квартал, slew-cap ≤10%/квартал.

### 1.5 Fixed — трекинг + алерт
```
L_{t+1} = round(median(last 3 mo))          # без авто-сжатия (это needs)
change-point: Chow/CUSUM на уровне → если подтверждён сдвиг (аренда выросла) → УВЕДОМИТЬ, не двигать.
```

### 1.6 Cold-start / intermittent
- `cold-start` (N<6): рекомендации нет, «собираю данные N/6 мес».
- `intermittent` (мелочь): фиксированный потолок = `p90(ненулевых)` или ручной, без статистики.

---

## 2. Фазовый план реализации

> Реализуем строго по фазам. Каждая фаза = свой pipeline (spec уже есть → impl → двойной gate → push).
> Backup D1 перед миграцией (правило 7). Бэктест (Фаза 1) — **блокирующий gate** перед любым авто-режимом.

### Фаза 0 — Фундамент: классификатор + утилиты (read-only, ничего не двигаем)
**Цель:** показать пользователю, как система классифицирует категории; убедиться, что классификатор адекватен.
- `cloud/worker/migrations/0012_adaptive_budgets.sql` + `schema.sql` (таблицы `budget_settings`, `budget_recommendation_log`).
- `cloud/worker/src/stats.ts` (новый): `median`, `mad`, `theilSen`, `hampelWinsorize`, `cov`, `acf`, `quantile`. Чистые, юнит-тестируемые.
- `cloud/worker/src/rbar.ts` (новый, часть 1): `classifyArchetype(history): Archetype` + метрики.
- `GET /v1/web/budgets/archetypes` (index.ts route) + Zod.
- Admin: секция «Как система видит мои категории» (таблица архетипов+метрики, read-only) на `/budgets`.
- Тест: vitest классификатора на векторах; smoke `/archetypes`; Playwright секции.
- **AC покрытие:** AC1, частично AC12, AC14(секция), AC17(миграция).
- **Выход:** пользователь подтверждает классификацию (или правит через override в Фазе 1).

### Фаза 1 — Recurring-контур в режиме SUGGEST + БЭКТЕСТ (advisory, Admin)
**Цель:** считать и показывать рекомендации для recurring/seasonal; доказать отсутствие дрейфа.
- `rbar.ts` (часть 2): `computeRecommendations(history, rates, settings, period)` — полный контур §1.2–1.3, реплей истории (G6). Reason-codes.
- `GET /v1/web/budgets/recommendations` + `PUT /v1/web/budgets/settings/:categoryId` + `POST /.../decision` + Zod.
- Admin: карточки рекомендаций (применить→PUT SPEC-020 / скрыть→decision-log), бейджи архетипов, override архетипа/пола/enabled.
- **БЭКТЕСТ-ГЕЙТ (блокирующий, AC13):** vitest прогоняет RBAR по всем recurring-категориям на 29 мес фикстуры; snapshot траекторий `L_t`; **проверка отсутствия апдрейфа** (AC6) и пробоя floor. Без зелёного бэктеста — фаза не закрыта.
- Тест: vitest сценариев §4 (экономия/HOLD/ROLLBACK/рост/всплеск/turbulence/детерминизм/anti-drift); Playwright карточек.
- **AC покрытие:** AC2–AC7, AC9, AC10, AC11, AC12, AC13, AC14, AC16.
- **Наблюдение 2–3 мес** на реальных данных перед Фазой 3.

### Фаза 2 — Lumpy конверт + fixed/seasonal + Mini App lens
**Цель:** закрыть остальные архетипы; накопительный конверт (фича Stepan'а).
- `rbar.ts` (часть 3): lumpy envelope §1.4, fixed §1.5, seasonal YoY (если N≥24).
- `GET /recommendations` отдаёт `envelope{}` для lumpy, `change_point` для fixed.
- `GET /v1/bootstrap` (additive): `budget_envelopes` для Mini App lens.
- Admin: lumpy-блок (накоплено/годовой/отчисление/алерт), fixed change-point баннер.
- Mini App: read-only бейдж конверта на плитке lumpy-категории (CLAUDE.md §11 — read-only, без CRUD).
- Тест: vitest envelope/fixed/seasonal; Playwright Admin + Mini App; light/dark.
- **AC покрытие:** AC8, AC15, остаток AC12/AC16; CLAUDE.md §11 уточнение.

### Фаза 3 — Авто-применение recurring (opt-in) — ТОЛЬКО после зелёного бэктеста
**Цель:** перевести recurring из suggest в auto (с явным opt-in и историей override).
- Месячный cron (worker `scheduled`): на границе месяца считает `L_{t+1}` для категорий с `adaptive_enabled=1` и opt-in авто, пишет лог, применяет лимит. Idempotency-guard по `(category, period)`.
- Admin: тумблер «авто-применять» per-category; история применённых рекомендаций.
- Quality-gate: `senior-qa` + `solution-architect` ревью контура и крона.
- **Требует:** owner-решение «включаем авто» (сейчас OQ1 = advisory). ADR-016 фиксирует закон.

### Фаза 4 — Калибровка + savings-first слой (после 12+ мес работы)
- Ревизия дефолтов (g-границы, margin, G_up, S_MAX) на расширенной истории.
- Профицит-линза («сэкономил €X/год vs P75», OQ7) — информационно.
- Опционально savings-first / 50-30-20 sanity-cap (нужен доход + savings-target в данных, NG8).
- Опционально change-point реанкоринг базы раз в квартал (Chow/PELT, увеличенный penalty).
- ADR-016 финализируется.

---

## 3. Карта файлов (ожидаемая)

| Файл | Фаза | Что |
|---|---|---|
| `cloud/worker/migrations/0012_adaptive_budgets.sql` | 0 | таблицы settings + reco-log |
| `cloud/worker/schema.sql` | 0 | снапшот схемы |
| `cloud/worker/src/stats.ts` | 0 | робастные примитивы (median/MAD/Theil-Sen/Hampel/ACF/quantile) |
| `cloud/worker/src/rbar.ts` | 0→2 | классификатор + закон + конверт (чистый, тестируемый) |
| `cloud/worker/src/schemas.ts` | 0→1 | Zod для новых endpoint'ов |
| `cloud/worker/src/index.ts` | 0→2 | routes `/recommendations`, `/archetypes`, `/settings`, `/decision`; bootstrap additive |
| `cloud/worker/test/rbar.test.ts` | 0→2 | vitest + **бэктест-фикстура 29 мес** |
| `cloud/admin/src/routes/budgets.tsx` (+ компоненты) | 0→2 | карточки рекомендаций, бейджи, конверт, override-секция |
| `cloud/admin/src/api/*` | 1 | хуки `useRecommendations`, `useArchetypes`, `useBudgetSettings` |
| `cloud/miniapp/src/*` | 2 | read-only lens конверта |
| `docs/decisions.md` (ADR-016) | 1→4 | фиксация закона RBAR |
| `cloud/worker/src/scheduled` | 3 | месячный cron авто-применения |

---

## 4. Источники (research-workflow 2026-05-31)

- **Exp. smoothing / damped Holt** — Hyndman & Athanasopoulos, *Forecasting: Principles and Practice* §7.2 — https://otexts.com/fpp2/holt.html ; §7.3 (Holt-Winters) — https://otexts.com/fpp2/holt-winters.html
- **Robust statistics / MAD / Hampel** — https://en.wikipedia.org/wiki/Median_absolute_deviation ; SAS Hampel identifier — https://blogs.sas.com/content/iml/2021/06/01/hampel-filter-robust-outliers.html
- **SPC / CUSUM** — NIST/SEMATECH e-Handbook 6.3.2.3 (CUSUM) — https://www.itl.nist.gov/div898/handbook/pmc/section3/pmc323.htm ; 6.3.2.4 (EWMA chart) — https://www.itl.nist.gov/div898/handbook/pmc/section3/pmc324.htm
- **Slew-rate / deadband / hysteresis** — https://en.wikipedia.org/wiki/Rate_limiter ; https://en.wikipedia.org/wiki/Deadband ; https://en.wikipedia.org/wiki/Hysteresis
- **Поведенческие методологии** — Guyton-Klinger guardrails (Kitces) — https://www.kitces.com/blog/guyton-klinger-guardrails-retirement-income-rules-extending-the-4-percent-rule/ ; YNAB age-of-money — https://support.ynab.com/en_us/age-of-money-H1ZS84W1s
- **Отвергнуты как ядро** (взяты идеи-компоненты): PID (https://en.wikipedia.org/wiki/PID_controller), Kalman (https://en.wikipedia.org/wiki/Kalman_filter), BOCPD (https://arxiv.org/abs/0710.3742) — причины в SPEC-023 §1 и memory `adaptive-budget-mechanism`.

---

## 5. Эмпирика (наши 29 мес, для бэктест-фикстуры)

Тотал тренд положительный помесячно (рост уровня жизни реален). Архетипы по данным: Жильё→fixed (CoV≪1); Еда/Продукты/Досуг→recurring (CoV средний); Коммуналка→seasonal/recurring; Техника/Одежда/Дом→lumpy (CoV≫1); Подписки/Чаевые→intermittent. Кросс-категорийный профицит vs P75 — существенный (для линзы Фазы 4). Симуляция: плоский EWMA → ратчет-ловушка; damped-Holt держит реальность (лимит «Еды» плавно снижается за 3 мес экономии, настоящие спайки помечаются корректно). Конкретные значения (тренд %, CoV по категориям, €-суммы) — в локальной фикстуре бэктеста, вне публичного репо.
