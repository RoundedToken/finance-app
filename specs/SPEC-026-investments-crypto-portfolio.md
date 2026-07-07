---
id: SPEC-026
title: Инвестиции — крипто-портфель (ETH + стейкинг stETH), дневной курс, исключение из свободных
status: done
owner: stepan
created: 2026-06-06
updated: 2026-06-06
links:
  - revised_by: [SPEC-027, SPEC-028, SPEC-030]  # staked_qty, цепочка провайдеров, autorange
  - adr: docs/decisions.md#adr-006   # источник курсов
  - adr: docs/decisions.md#adr-011   # D1 — источник правды
  - adr: docs/decisions.md#adr-012   # Web Admin scope
  - adr: docs/decisions.md#adr-014   # canonical currency conversion (запас/поток)
  - adr: docs/decisions.md#adr-015   # денежные суммы REAL
  - depends_on: [SPEC-003, SPEC-008, SPEC-011, SPEC-013, SPEC-016]
  - roadmap: docs/roadmap.md#stage-9 (инвестиции) → активируется
---

# Инвестиции — крипто-портфель (ETH + стейкинг stETH)

> **Принцип фичи (owner-решения 2026-06-06, 4 развилки):**
> 1. **Полный портфель** — текущая стоимость (qty × курс), cost basis, P&L, доходность стейкинга.
> 2. **Курс ETH — Binance public API** в Worker cron; **stETH = ETH × 1.0 (пег)**.
> 3. **Доходность стейкинга** — снапшот баланса (ground truth) + прогноз по APR пунктиром между снапшотами.
> 4. **Одна ETH-позиция**; «застейкано» — внутренний признак, **не** обмен. Покупка USDT→ETH остаётся `exchange`.
>
> **Архитектурный фундамент:** холдинг ETH = обычное **ведро** (account). Это даёт net worth, snapshots,
> exchange-покупку, EUR-конверсию и спарклайны **бесплатно**. Раздел «Инвестиции» = **аналитическая
> линза** поверх (как RBAR/бюджеты в SPEC-020/023): cost basis выводится из exchange-транзакций,
> стоимость — из rates, доход стейкинга — из снапшотов. Новый компонент в формуле свободных:
> `free = net − targeted − invested`.

## 1. Context & Problem

Сейчас в системе нет понятия «инвестиция»: вся стоимость вёдер считается **свободными деньгами**
(`free = net − targeted`, SPEC-013). Появился реальный поток: я меняю **USDT → ETH** и кладу ETH в
**стейкинг (stETH, Lido через Bybit)**. Эти деньги по смыслу как фонды — **не свободные**, но при этом
это растущий актив: цена ETH в EUR меняется ежедневно, а стейкинг капает доход (~3–4% годовых через
ребейзинг — количество stETH медленно растёт). Нужно: (а) **ежедневный курс ETH** (как у фиата, но
`GOOGLEFINANCE` крипту не умеет), (б) учёт покупки и стейкинга, (в) **исключение из свободных**,
(г) трекинг стоимости/прибыли/доходности в Web Admin. Раздел инвестиций был намечен как Stage 9
(post-MVP) — теперь приоритезирован.

## 2. Goals

- **G1** (дневной крипто-курс): Worker cron дополнительно фетчит **ETH/EUR с Binance public API** и пишет в
  `rates` (`quote='ETH'`, `source='binance'`) тем же ежедневным расписанием, что и фиат. **stETH пегуется
  к ETH 1:1** (как USDT=USD): отдельной котировки нет, стоимость stETH = по курсу ETH. Историю ETH/EUR
  бэкфиллим (для P&L по дате покупки) через существующий `bulk-rates`.
- **G2** (ETH как валюта + инвест-ведро): добавляем валюту `ETH` в справочник и **инвест-ведро**
  `eth-invest` (currency=ETH). Оно входит в **net worth** (это реальный актив), но помечено
  `is_investment=1`.
- **G3** (исключение из свободных): новый компонент `invested = Σ EUR-стоимость инвест-вёдер (mark-to-market)`.
  Формула становится **`free = net − targeted − invested`** в обоих местах расчёта (`dashboard.ts`,
  `/v1/web/accounts`). Каждый «инвестированный евро» физически лежит в ведре, входящем в net → нет
  двойного счёта, `invested ⊆ net`.
- **G4** (покупка = переиспользование обменов): покупка USDT→ETH — это существующий `exchange`
  (`from=usdt-ведро`, `to=eth-invest`), без нового кода транзакций. Комиссия биржи — штатное
  `fee_amount/fee_currency`. **Никаких новых мутирующих endpoint'ов для покупки.**
- **G5** (стейкинг = признак, не обмен): «застейкано» — внутреннее состояние ETH-позиции (Q4), а **не**
  отдельная валюта stETH и **не** транзакция. Ребейзинг-награда отражается через **ручной снапшот**
  баланса инвест-ведра (Bybit-баланс = ground truth, Q3) — существующий механизм `snapshots`.
- **G6** (полный портфель = линза): раздел `/investments` в Admin показывает по позиции: **количество**
  (qty), **курс сегодня**, **текущую стоимость EUR**, **вложено (cost basis EUR)**, **нереализованный
  P&L (EUR и %)**, **доход стейкинга** (EUR, и APR). Всё — **производные** (cost basis из exchange-истории,
  стоимость из rates, доход из снапшотов), **нового хранимого баланса нет** (в духе SPEC-011/023, G4
  SPEC-023: никакого «второго кошелька, который можно потратить ещё раз»).
- **G7** (доход стейкинга детерминированно): доход = **прирост qty, не объяснённый покупками/продажами**,
  между двумя снапшотами (ground truth). Между снапшотами — **прогноз по APR пунктиром** (forecast,
  memory `dashed-line-means-forecast`); прогноз НЕ входит в net worth (только визуальная подсказка).
- **G8** (единый слой конверсии): вся конверсия — через `RatesIndex` (ADR-014). ETH в EUR: запас
  (стоимость позиции, net, invested) → курс **на сегодня** (mark-to-market); поток (cost basis покупки)
  → курс **на дату покупки** (date-aware). Клиент не конвертирует.
- **G9** (только Web Admin): фича целиком в Web Admin (ADR-012). Mini App **не трогаем** (scope заморожен,
  CLAUDE.md §11).

## 3. Non-Goals

- **NG1**: Не отдельная валюта `stETH` и не транзакция «стейкинг ETH→stETH». stETH пегуется к ETH, стейкинг —
  внутренний признак позиции (Q4). Если пег сломается (депег) — это known limitation, см. R3/OQ2.
- **NG2**: Не авто-начисление дохода стейкинга транзакциями. «manual = ground truth» (ADR-011, post-mvp 3.7).
  Доход — только из снапшотов (факт) + APR-прогноз (визуал). Никаких авто-interest-tx.
- **NG3**: Не реализованный (realized) P&L / FIFO-лоты / частичные продажи с фиксацией прибыли в этой
  итерации. Только **нереализованный** P&L (стоимость − cost basis по позиции в целом, средневзвешенно).
  Продажа ETH→USDT возможна как обычный `exchange`, но отдельной realized-P&L-отчётности нет (OQ3).
- **NG4**: Не другие классы активов (акции/ETF/облигации/банковский %). Схема расширяема (`is_investment`
  + currency + rates), но в этой итерации — **только ETH/стейкинг**. Stage 9 «yield-счета/holdings» в
  широком смысле — позже.
- **NG5**: Не CRUD инвестиций в Mini App и не read-only подсказка в Mini App (в отличие от бюджетов
  SPEC-020/023 — инвестиции не помогают решению «вводить трату», CLAUDE.md §11). Только Web Admin.
- **NG6**: Не реалтайм-курс. Дневной cron (как фиат) достаточно; внутридневные колебания не трекаем.
- **NG7**: Не мультибиржевой учёт / не привязка к конкретному кошельку-адресу / не on-chain чтение. Учёт
  ручной (exchange + снапшот), как и весь остальной портфель.
- **NG8**: Не меняем `free`-семантику для целей (SPEC-025 остаётся отдельной фичей). `targeted` считается
  как сейчас; добавляется только `invested` рядом.

## 4. User journeys

### Happy path — покупка
1. Купил на бирже ETH за USDT. В Admin → **Транзакции** → **Обмен**: `from = USDT-ведро`, `to = ETH (инвест)`,
   `from_amount = 2000 USDT`, `to_amount = 0.62 ETH`, `fee = 3 USDT`. Сохраняю. Это **существующий** обмен:
   USDT-ведро уменьшается, ETH-ведро растёт, net worth сохраняется. (Можно вызвать тот же обмен кнопкой
   **«Купить ETH»** прямо со страницы Инвестиций — это лишь префилл `to=eth-invest`.)
2. Открываю **/investments**: позиция **ETH 0.62**, курс сегодня (напр. 3180 €/ETH), стоимость **1972 €**,
   вложено **2003 €** (2000 USDT + 3 fee → EUR на дату), P&L **−31 € (−1.5%)**.
3. На **дашборде**: KPI **«Инвестиции» 1972 €** появился; **«Свободные»** уменьшились на эту сумму
   (`free = net − targeted − invested`). Net worth не изменился (USDT ушли, ETH пришли).

### Happy path — стейкинг и доход
4. Застейкал ETH на Bybit (Lido stETH). На странице позиции жму **«Отметить застейканным»** (опц.) и
   задаю **APR ≈ 3.6%** в настройках позиции (для прогноза). Стейкинг **не создаёт транзакцию**.
5. Через месяц на Bybit мой stETH-баланс подрос (ребейзинг). Жму **«Обновить баланс»** → это **снапшот**
   ETH-ведра = фактический баланс с Bybit (напр. 0.622 ETH-экв). Сохраняю.
6. Раздел показывает **доход стейкинга**: `+0.002 ETH ≈ +6 €` за период (прирост, не объяснённый
   покупками). Между снапшотами линия стоимости продолжается **пунктиром** по APR (forecast).

### Happy path — наблюдение
7. На **/investments** вижу карточку позиции: qty, курс, стоимость, вложено, P&L (цвет: зелёный/красный),
   доход стейкинга, спарклайн стоимости за период, бейдж «в стейкинге · APR 3.6%».
8. KPI вверху: **общая стоимость портфеля**, **вложено**, **P&L всего (€ / %)**, **доход стейкинга**.

### Edge cases
- **E1** (нет курса ETH на сегодня): Binance не ответил/новой котировки нет → `RatesIndex.rateAt` берёт
  **последний известный** курс (как фиат, не 0). Стоимость считается по нему; в summary растёт
  `missing_rates`, только если курса нет **вообще** (пустая история ETH).
- **E2** (ETH-ведро без покупок, только снапшот baseline): пользователь завёл ETH «снимком» без exchange-истории
  → cost basis для этого объёма **неизвестен**. Стоимость считается, но cost basis/P&L по этой части помечается
  `cost_basis_known=false` (P&L = «—», не вводим в заблуждение). См. R2.
- **E3** (снапшот < предыдущего из-за продажи, не убытка): прирост qty между снапшотами вычисляется
  **с учётом** exchange-оттоков (продажа ETH→USDT). Доход стейкинга = `Δqty − net_bought`; если результат
  отрицателен (вывел больше, чем накапало) — доход не уходит в минус искусственно: показываем 0 за период и
  помечаем (см. §5 формула, OQ4).
- **E4** (нет снапшотов после стейкинга): доход стейкинга по факту = 0 (нечего сравнивать) → показываем
  **только APR-прогноз** пунктиром с пометкой «ожидаемый, обнови баланс для факта».
- **E5** (P&L при росте курса): курс ETH вырос → стоимость и `invested` растут **на одну сумму** → `free`
  **не меняется** (нереализованная прибыль ≠ свободные деньги). На дашборде net worth растёт, свободные нет —
  это корректно и должно быть видно (Δ net worth = Δ invested при неизменных потоках).
- **E6** (инвест-ведро как backing цели): если goal_contribution.account_id указывает на инвест-ведро,
  возможен двойной вычет (`targeted` и `invested` пересекаются). **NG/guard**: инвест-ведро **нельзя**
  выбирать как account для goal_contribution (валидация); документируем инвариант `targeted`-вёдра и
  `invested`-вёдра не пересекаются.
- **E7** (Binance geo/403 из Worker): если Binance отдаёт 403/451 на CF-IP — фетч крипты ловит ошибку
  **изолированно** (не валит фиат-фетч), логирует, оставляет вчерашний курс. Fallback-источник — OQ1.
- **E8** (точность qty): ETH хранится с `decimals=6` (как уже в `CURRENCY_DECIMALS`), денежная математика
  REAL + `roundMoney` 8 знаков (ADR-015). Мелкий ребейзинг (6-й знак) не теряется.

## 5. Data model

**Ключевой принцип (как SPEC-023):** новый хранимый **баланс не создаётся**. ETH-позиция — это обычное
ведро (`accounts` + `snapshots` + `transactions`), а cost basis / P&L / доход стейкинга — **производные
on-read** из уже существующих данных. Новое в схеме — минимум: справочная валюта ETH, флаг ведра и
настройки стейкинга (APR). Миграция **`0014_investments.sql`** (`schema.sql` обновляется параллельно —
правило 2).

```sql
-- 0014_investments.sql — SPEC-026: инвестиции (крипто-портфель ETH/стейкинг)
--
-- Добавляет:
--   - валюту ETH в справочник (stETH НЕ добавляем — пег к ETH, Q4/NG1);
--   - accounts.is_investment: ведро-актив входит в net worth, но исключается из свободных;
--   - seed инвест-ведра eth-invest;
--   - investment_settings: APR стейкинга (для forecast) + признак "в стейкинге".
-- Курсы ETH пишет cron (source='binance') и бэкфилл (bulk-rates) — без изменения схемы rates.

-- 1) Валюта ETH (decimals=6 — как в CURRENCY_DECIMALS фронта)
INSERT OR IGNORE INTO currencies (code, name, emoji, is_crypto, decimals)
VALUES ('ETH', 'Ethereum', '⟠', 1, 6);

-- 2) Флаг инвест-ведра: входит в net, исключается из free (invested)
ALTER TABLE accounts ADD COLUMN is_investment INTEGER NOT NULL DEFAULT 0;

-- 3) Seed инвест-ведро для ETH (form='digital' → попадает в listBuckets/net worth)
INSERT OR IGNORE INTO accounts (id, name, type, currency, is_active, color, form, sort_order, is_investment)
VALUES ('eth-invest', 'ETH (инвест)', 'crypto', 'ETH', 1, '#627eea', 'digital', 90, 1);

-- 3b) Инвариант «одна позиция на валюту» (G2): не более одного активного инвест-ведра на currency
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_one_investment_per_currency
    ON accounts(currency) WHERE is_investment = 1 AND deleted_at IS NULL;

-- 4) Настройки стейкинга на ведро (APR для прогноза, признак "застейкано")
CREATE TABLE IF NOT EXISTS investment_settings (
    account_id        TEXT PRIMARY KEY REFERENCES accounts(id),
    is_staked         INTEGER NOT NULL DEFAULT 0,   -- 1 = позиция в стейкинге (Q4 признак)
    staking_apr_pct   REAL CHECK (staking_apr_pct IS NULL OR (staking_apr_pct >= 0 AND staking_apr_pct <= 100)), -- напр. 3.6; верх — sanity
    note              TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**Применение миграции** (memory `d1-migrations-apply-via-execute-file`): сначала backup
(`python local/scripts/backup_d1.py`), затем `wrangler d1 execute finances-outbox --remote
--file cloud/worker/migrations/0014_investments.sql` (НЕ `migrations apply`). Идемпотентность:
`INSERT OR IGNORE` + `CREATE … IF NOT EXISTS` + `ADD COLUMN` (повторный прогон `ADD COLUMN`
упадёт — это нормально, колонка уже есть; проверяем `SELECT COUNT(*) FROM currencies WHERE
code='ETH'` = 1 и `…accounts WHERE id='eth-invest'` = 1). `schema.sql` обновляется параллельно.

**`rates.source`**: CHECK-констрейнта нет (TEXT) — `source='binance'` пишется на уровне приложения
(в `fetchCryptoRatesEUR`), миграция схемы `rates` не нужна. **`listBuckets`** (snapshots.ts) и
`/v1/web/accounts` должны явно вернуть `is_investment` (не `SELECT *` — добавить колонку в SELECT и
в тип `Account`/`Bucket`). `is_investment` ведёт себя как мета-флаг: ведро остаётся в net worth.

**Семантика курса ETH (важно — направление!):** в `rates` хранится `rate` как «1 EUR = rate × quote».
Binance `ETHEUR` отдаёт **EUR за 1 ETH** (цена ~3180). Значит `rate_ETH = 1 / price_ETHEUR`. Тогда
`RatesIndex.toEurAt(qty_eth, 'ETH', date) = qty_eth / rate_ETH = qty_eth × price` — корректно. Фетчер
**инвертирует** цену перед записью. stETH: отдельного `quote` нет, везде используем курс `'ETH'` (пег 1:1).

**Производные формулы линзы.** Новый модуль `investments.ts` — чистая логика, тестируемая без D1.
Сигнатура: `computePortfolio(buckets, txs, snapshots, settings, rates: RatesIndex, today): PortfolioResponse`
(вызывающий батч-грузит данные; переиспользует `toEurAt`/`rateAt` из rates.ts и `reconstructBalance`/
`effective_balance` из ledger.ts/snapshots.ts — **без копий конверсии**, G6/G8). Формулы (на позицию):

- `qty(today) = effective_balance(eth-invest, today)` — существующий расчёт (baseline-снапшот + события).
- `value_eur(today) = toEurAt(qty(today), 'ETH', today)` — mark-to-market (запас).
- **cost basis — weighted-average cost (WAC), не FIFO** (NG3): реплеим exchange-события по `eth-invest`
  в хронологии (canonicalTs, SPEC-024). На **покупку** (`to_account=eth-invest`): `qty += to_amount`,
  `cost += toEurAt(from_amount, from_currency, tx.date) + fee_eur(tx)`. На **продажу**
  (`from_account=eth-invest`): списываем cost пропорционально средней цене —
  `avg = cost/qty; cost −= avg × from_amount; qty −= from_amount`. Итог `cost_basis_eur = cost`.
  Realized P&L при продаже = `(toEurAt(to_amount, to_currency, date) − avg × from_amount)` — **не**
  отчитывается в v1 (NG3, OQ3), но WAC-списание обязательно, иначе cost basis «поедет».
- **cost_basis_known**: `false`, если в реплее встретился **baseline-снапшот раньше первой покупки**
  (есть qty без объясняющих exchange — цена входа неизвестна, E2). Тогда P&L в ответе = `null`
  (UI рисует «—»), `value_eur` всё равно считается.
- `unrealized_pl_eur = value_eur − cost_basis_eur` (только если `cost_basis_known`), `_pct = pl/cost_basis`.
- **staking_income (факт, G7)** — на границе «последний снапшот → сегодня»: пусть `s` = последний
  снапшот `eth-invest` с `date ≤ today`. `reward_qty = qty(today) − s.amount − net_bought_after(s, today)`,
  где `net_bought_after = Σ to_amount(покупки) − Σ from_amount(продажи)` для событий **после** `s`
  (порядок по date,created_at — tie-break SPEC-024). `reward_eur = toEurAt(reward_qty, 'ETH', today)`.
  Накопленный доход за всё время — сумма таких приростов между последовательными снапшотами.
  Если `reward_qty < 0` (вывел больше, чем накапало) → **0 за период** (E3, OQ4), не отрицательно.
  Если снапшотов после стейкинга **нет** (E4) — факт = 0 (показываем только прогноз).
- **APR-прогноз (forecast, пунктир, НЕ в net worth)**: `projected_qty(t) = s.amount × (1 + apr/100)^(Δдней/365)`.
  Это **визуальная подсказка** (как профицит-линза в SPEC-023 G4/R6: не создаёт тратимых денег).
- `invested_eur = Σ over buckets [is_investment=1] toEurAt(effective_balance, currency, today)` — компонент free.
  Считается **один раз** и переиспользуется в `/accounts` и `/dashboard` (G8). Для `prev_invested_eur`
  (Δ на дашборде) — та же сумма на `prevAsOf` (конец окна WIN назад) по курсу той даты.

## 6. API contract

Auth: JWT (Bearer) для всех `/v1/web/*`. Все денежные итоги — EUR. Изменения существующих ответов — additive.

### `GET /v1/web/investments` (новый)
Возвращает позиции инвест-вёдер + сводку. Чистый расчёт `investments.ts computePortfolio(accounts, tx, snapshots, ratesIndex, settings, today)` (переиспользует `effective_balance` и `toEurAt`).
```jsonc
{
  "ok": true,
  "as_of": "2026-06-06",
  "currency": "EUR",
  "rates_date": "2026-06-06",
  "summary": {
    "value_eur": 1972.0,         // суммарная стоимость инвест-позиций (= invested_eur)
    "cost_basis_eur": 2003.0,
    "unrealized_pl_eur": -31.0,
    "unrealized_pl_pct": -1.5,
    "staking_income_eur": 6.0,   // факт по снапшотам за всё время в стейкинге
    "missing_rates": 0
  },
  "positions": [
    {
      "account_id": "eth-invest", "name": "ETH (инвест)", "currency": "ETH",
      "qty": 0.622, "price_eur": 3180.0, "value_eur": 1978.0,
      "cost_basis_eur": 2003.0, "cost_basis_known": true,
      "unrealized_pl_eur": -25.0, "unrealized_pl_pct": -1.25,
      "is_staked": true, "staking_apr_pct": 3.6,
      "staking_income_eur": 6.0,            // факт (Δqty − net_bought) × курс
      "staking_income_qty": 0.002,
      "last_snapshot_date": "2026-06-05",
      "value_series": [ { "date": "2026-05-01", "value_eur": 0 }, ... ]  // спарклайн (как net_worth_series)
    }
  ]
}
```

### `PUT /v1/web/investments/settings/:accountId` (новый)
Body (Zod `investmentSettingsSchema`): `{ is_staked?: boolean, staking_apr_pct?: number|null, note?: string|null }`.
UPSERT в `investment_settings`. Guard: `accountId` существует и `is_investment=1`. 200 `{ ok:true }` | 400 | 404.

### `POST /v1/admin/refresh-rates` (изменено, additive)
Существующий ручной рефреш дополнительно тянет крипту (Binance) вместе с фиатом. Тело/ответ совместимы.

### `GET /v1/web/accounts` (изменено, additive)
В `summary` добавляется `invested_eur`, а `free_eur` пересчитывается:
```jsonc
"summary": {
  "net_worth_eur": 8000.0, "targeted_eur": 1200.0,
  "invested_eur": 1972.0,                 // НОВОЕ
  "free_eur": 4828.0,                     // = net − targeted − invested
  "missing_rates": 0, "rates_date": "2026-06-06"
}
```
Каждое инвест-ведро в `accounts[]` получает `is_investment: true`.

### `GET /v1/web/dashboard` (изменено, additive)
В `kpi` добавляются:
```jsonc
"invested_eur": 1972.0,            // Σ EUR инвест-вёдер на сегодня (mark-to-market)
"prev_invested_eur": 0.0,          // та же Σ на prevAsOf (конец окна WIN назад), по курсу той даты
"free_net_worth_eur": 4828.0,      // ПЕРЕСЧИТАНО: net − targeted − invested
"prev_free_net_worth_eur": 4900.0  // ПЕРЕСЧИТАНО: prevNet − targeted − prev_invested
```
**Важно для Δ:** `prev_free` обязан вычитать `prev_invested` (иначе при росте курса ETH Δ свободных
завышается на прирост инвестиций — must-fix из stress-test). `prev_invested` считается тем же
`balanceAt(bucket, prevAsOf)` для `is_investment=1` вёдер, конвертированным по курсу `prevAsOf`.
В `net_worth_series` точка дополняется `invested_eur` (слой «инвестиции» на графике Net worth, как
`by_form`/`by_currency`).

### Покупка/продажа/стейкинг-баланс — **без новых endpoint'ов**
- Покупка USDT→ETH и продажа ETH→USDT — существующий `POST/PUT/DELETE /v1/web/transactions` (`type=exchange`).
  Условие работы: валюта `ETH` есть в `currencies` (seed миграции 0014 — применить **до** первой покупки).
  `transactions.validateStep` дополнительно проверяет, что `from_currency`/`to_currency` существуют в
  `currencies` (сейчас проверки нет — добавить guard, иначе опечатка валюты пройдёт молча).
- Обновление баланса (ребейзинг) — существующий `POST /v1/web/snapshots` на `eth-invest`.
  `createSnapshot` дополнительно проверяет существование `account_id` (как `transactions.ts` — сейчас нет).
- Валидация (новое доменное правило, E6): guard в create/update **goal_contribution** (`goals.ts`) —
  если `account_id.is_investment=1` → `400 {"error":"нельзя привязать вклад цели к инвест-ведру"}`.
  Гарантирует `targeted`-вёдра и `invested`-вёдра не пересекаются (нет двойного вычета из free).
- Инвест-ведро **исключается** из пикеров счёта при вводе расхода/дохода (`is_investment=1` отфильтровать
  в селекторах ExpenseModal/IncomeModal — инвестицию не «тратят» как обычный счёт; в exchange/snapshot — видно).

## 7. UI / UX

### Worker / cron
- `rates.ts`: новая `fetchCryptoRatesEUR(env)` → Binance `GET /api/v3/ticker/price?symbol=ETHEUR`,
  парсит `price`, проверяет `price>0` (иначе пропуск), **инвертирует** `rate = 1/price`, пишет
  `quote='ETH', date=today(UTC), source='binance'`. Вызывается в `scheduled` (cron) и в
  `/v1/admin/refresh-rates` **после** фиата, в **отдельном** try/catch (падение крипты не валит фиат, E7).
- **Geo/IP-риск (R1):** Binance может отдать `451/403` на CF-IP. Обработка: try/catch → лог `ok/fail+http`
  (без сумм) → вернуть `{rates:{}}` (saveRates пропускает пустое) → курс остаётся вчерашним. Хост по
  умолчанию `api.binance.com`; при систематическом блоке — `data-api.binance.com` или fallback-источник
  (CoinGecko/Coinbase), OQ1. Существование/ликвидность пары `ETHEUR` на Binance проверить при импле; если
  её нет — `ETHUSDT × (USDT→EUR из rates)` как деривация (тот же EUR-base).
- Бэкфилл истории ETH/EUR — локальный скрипт `local/scripts/backfill_crypto_rates.py` (симметрично
  `backfill_rates.py`): Binance `GET /api/v3/klines?symbol=ETHEUR&interval=1d&startTime&endTime`, диапазон
  по умолчанию **с 2024-01-10** (первая дата курсов в системе) до сегодня; берём `close` каждого дневного
  бара; sanity `0 < price < 100000`; инверсия `rate=1/price`; отправка батчами в существующий
  `POST /v1/admin/bulk-rates` (идемпотентно: `INSERT OR REPLACE` по PK `(date,base,quote)`). Ошибка Binance →
  скрипт падает с ненулевым кодом (не молчит), повтор безопасен.

### Web Admin — новый раздел `/investments`
- Пункт меню **«Инвестиции»** (icon `TrendingUp`/`Coins`) в `AppLayout` NAV.
- **KPI-строка** (как на дашборде): Стоимость портфеля · Вложено · P&L (€ и %, цвет) · Доход стейкинга.
- **Карточка позиции** (каркас `BucketCard`/`KpiCard` + `Sparkline`):
  - заголовок: «⟠ ETH (инвест)» + бейдж «в стейкинге · APR 3.6%» (если `is_staked`);
  - крупно: стоимость EUR + qty ETH; курс сегодня;
  - строка P&L: «вложено 2003 € · P&L −25 € (−1.25%)» (зелёный/красный). **Если `cost_basis_known=false`** —
    «вложено —» + ⓘ-тултип: «Затратная цена неизвестна: ETH занесён снимком без обмена. Чтобы считать P&L,
    заносите покупки через обмен USDT→ETH». P&L = «—», не вводим в заблуждение.
  - строка стейкинга: «доход стейкинга **+6 € (+0.002 ETH)** · факт на 05 июн» (с датой последнего снапшота).
  - спарклайн стоимости с **легендой**: «──── факт (из снапшотов/курса) · · · · прогноз по APR». Тултип на
    пунктире: «Прогноз, не реальные деньги. Точные цифры — после обновления баланса». (Пунктир = forecast,
    memory `dashed-line-means-forecast`; защита от восприятия прогноза как накопленных денег, ср. SPEC-023 R6.)
  - действия: **«Купить ETH»** (ExchangeModal с новым prop `initialTo='eth-invest'`),
    **«Обновить баланс»** (SnapshotModal с новым prop `initialAccountId='eth-invest'`),
    **«Стейкинг…»** (модал настроек: тумблер `is_staked`, поле APR 0..100, заметка → `PUT /investments/settings`).
- Состояния: `isLoading` скелетон; `isError` → `ErrorState(onRetry)`; **empty** (нет покупок) → онбординг
  «Сделайте первый обмен USDT→ETH, чтобы начать трекинг»; **E4** (застейкано, но нет снапшота после) — жёлтый
  баннер «Обновите баланс с биржи, чтобы зафиксировать доход стейкинга (пока показан только прогноз)».
- **Устаревший курс (R1/OQ1):** если `rates_date < today` — жёлтый баннер «Курс ETH от {rates_date}; цифры
  могут устаревать» (только информационно, не блокер).
- KPI-карта = один сигнал (memory `kpi-card-one-signal`): цвет P&L, Δ, заливка — по одному окну.
- Hover-отклик на строках (memory `ui-hover-feedback`). Light/dark обязательно.
- **Фронт-типы:** `Account += is_investment?: boolean`; `AccountsSummary += invested_eur: number`; новые
  `InvestmentPosition`/`InvestmentsResponse`/`InvestmentSettingsPayload`; query-хуки `useInvestments`,
  `useUpdateInvestmentSettings`; маршрут `/investments` (routeTree) + пункт NAV (AppLayout).

### Web Admin — дашборд
- Новый KPI **«Инвестиции»** (`invested_eur`, Δ к прошлому окну). **«Свободные»** теперь
  `net − targeted − invested` — подпись-тултип объясняет компоненты.
- На графике Net worth — опц. слой/линия «инвестиции» (из `net_worth_series[].invested_eur`).

ASCII-набросок карточки позиции:
```
┌────────────────────────────────────────────────┐
│ ⟠ ETH (инвест)            [в стейкинге·APR 3.6%] │
│ 1 978 €            0.622 ETH  · курс 3 180 €     │
│ вложено 2 003 €   ·   P&L −25 € (−1.25%)         │
│ доход стейкинга +6 € (+0.002 ETH)               │
│ ╭─ стоимость ───────────────────╮  ╭ прогноз ╮  │
│ │      ╱╲      ╱╲___╱            │  ┄┄┄┄┄┄    │  │
│ ╰───────────────────────────────╯  ╰─────────╯  │
│ [ Купить ETH ]  [ Обновить баланс ]  [ Стейкинг ]│
└────────────────────────────────────────────────┘
```

## 8. Security

- Все `/v1/web/investments*` — за `requireAdminSession` (Bearer JWT, allowlist email, правило 4/10).
- Binance: вызывается **только публичный** read-only endpoint (`/api/v3/ticker/price`), без ключей/секретов.
  Никаких новых secrets. Ответ парсится строго (число цены), при аномалии (`price<=0`/NaN) — пропуск (как фиат).
- Валидация: Zod (shape) + доменные guard'ы (`account` существует и `is_investment=1`;
  `staking_apr_pct ∈ [0,100]` (Zod `.min(0).max(100)` + CHECK); `goal_contribution.account_id` не инвест-ведро;
  `from_currency`/`to_currency` обмена существуют в `currencies`). Ошибки → 400 без stack-leak.
- SQL параметризован. В логи не пишем суммы/балансы (только факт fetch ok/fail и http-статус Binance).
- Денежная корректность (ADR-015): REAL + `roundMoney`; направление курса (инверсия Binance) покрыто тестом,
  чтобы не записать ETH «вверх ногами» (катастрофический mis-valuation).

## 9. Acceptance criteria

- [ ] **AC1** (курс ETH): cron и `/v1/admin/refresh-rates` пишут свежий `quote='ETH', source='binance'` в `rates`;
  записанный `rate` = `1/price_ETHEUR` (тест направления: `toEurAt(1,'ETH',d)` ≈ цена Binance).
- [ ] **AC2** (изоляция фетча, E7): падение крипто-фетча (мок 403/timeout) **не** ломает фиат-фетч; вчерашний
  курс ETH остаётся; `refresh-rates` возвращает успех по фиату.
- [ ] **AC3** (бэкфилл): `backfill_crypto_rates.py` заливает дневную историю ETH/EUR; `RatesIndex.rateAt('ETH', past)`
  возвращает курс на дату покупки (date-aware, не сегодняшний).
- [ ] **AC4** (ETH-ведро в net): инвест-ведро входит в `net_worth_eur` (mark-to-market по курсу сегодня).
- [ ] **AC5** (free): `free_eur = net − targeted − invested` в `/v1/web/accounts` **и** `dashboard`; `invested_eur`
  присутствует в обоих; при росте курса ETH `free` не меняется, `net` и `invested` растут одинаково (E5).
  На дашборде `prev_free_net_worth_eur = prevNet − targeted − prev_invested_eur` (Δ свободных не завышается на прирост инвестиций).
- [ ] **AC6** (покупка переиспользует exchange): обмен USDT→ETH (`to=eth-invest`) уменьшает USDT-ведро,
  увеличивает ETH-ведро, сохраняет net worth; комиссия учтена; **без нового endpoint'а**.
- [ ] **AC7** (cost basis WAC): `cost_basis_eur` = Σ EUR покупок по курсу **даты покупки** + fee; при продаже
  ETH→USDT cost списывается по средневзвешенной цене (`avg=cost/qty`); P&L = стоимость − cost basis; знак/проценты
  верны на фикстуре (покупка дешевле/дороже; покупка → частичная продажа → cost basis не «поехал»).
- [ ] **AC8** (cost basis unknown, E2): ETH из baseline-снапшота без exchange-истории → `cost_basis_known=false`,
  P&L не вводит в заблуждение («—»), стоимость считается.
- [ ] **AC9** (стейкинг — признак, не tx): `PUT /investments/settings` ставит `is_staked`/`apr`; **нет** транзакции
  и нет валюты stETH; стоимость stETH-доли считается по курсу ETH (пег).
- [ ] **AC10** (доход стейкинга факт, G7): после снапшота с приростом qty, не объяснённым покупками, `staking_income_qty`
  = Δqty − net_bought, `_eur` по курсу; при выводе больше накопленного — 0 за период (E3), не отрицательно.
- [ ] **AC11** (прогноз APR, forecast): между снапшотами проекция qty по APR рисуется **пунктиром** и **не**
  входит в net worth/invested/free (только визуал).
- [ ] **AC12** (инвариант без двойного счёта, E6): `goal_contribution.account_id` = инвест-ведро отвергается (400);
  `invested` и `targeted` не пересекаются.
- [ ] **AC13** (единый модуль, G6/G8): `investments.ts` — чистая функция, переиспользует `toEurAt`/`effective_balance`,
  без копий конверсии; `invested_eur` считается один раз и используется в accounts+dashboard.
- [ ] **AC14** (UI Admin): раздел `/investments` (KPI, карточка позиции, спарклайн факт+прогноз, действия
  Купить/Обновить/Стейкинг); дашборд KPI «Инвестиции» + свободные с тултипом; loading/empty/error; toast+инвалидация
  (`['investments']`, `['accounts']`, `['dashboard']`, при обмене также `['transactions']`, при снапшоте `['snapshots']`).
  Скриншоты light/dark (memory `frontend-test-locally-before-deploy`).
- [ ] **AC15** (vitest): курс-инверсия, изоляция фетча, cost basis (с/без продаж, baseline-unknown), P&L,
  staking income (прирост/вывод/нет снапшотов), invested/free, guard goal_contribution.
- [ ] **AC16** (docs): миграция `0014` + `schema.sql`; ADR (исключение invested из free — расширение SPEC-013;
  Binance как источник крипто-курсов — расширение ADR-006); `data-model.md` (инвариант free, is_investment);
  roadmap Stage 9 → отмечен; CLAUDE.md (инвест-ведро, free-формула); `gitleaks dir` clean.
- [ ] **AC17** (деплой миграции): `0014` применяется через `wrangler d1 execute … --remote --file` (после backup,
  NOT `migrations apply`); идемпотентность проверена (`COUNT currencies.ETH`=1, `COUNT accounts.eth-invest`=1,
  уникальный индекс на инвест-ведро на валюту работает). Прод после деплоя: `/v1/web/investments` отвечает.
- [ ] **AC18** (guards/инварианты): APR вне `[0,100]` → 400; обмен с несуществующей валютой → 400;
  снапшот/вклад на несуществующий account → 400; второе активное инвест-ведро на ту же валюту → отклонено
  (уникальный индекс); инвест-ведро не появляется в пикерах счёта расхода/дохода.

## 10. Test plan

- **Worker (vitest, in-memory — основное)**:
  - `rates`: инверсия Binance-цены, изоляция крипто-фетча от фиата (мок fetch 200/403/timeout), запись `source='binance'`.
  - `investments.ts`: cost basis (только покупки; покупки+продажа; baseline без истории), P&L (±), staking income
    (прирост; вывод>дохода→0; нет снапшотов→0 факт), `invested_eur`, value_series.
  - `free`: net/targeted/invested/free на фикстуре; E5 (рост курса не меняет free).
  - guard: goal_contribution на инвест-ведро → 400.
- **Worker (curl smoke)**: `GET /v1/web/investments`, `PUT /investments/settings`, `POST /admin/refresh-rates`
  (содержит ETH), `/v1/web/accounts` summary с `invested_eur`/`free_eur`.
- **Admin SPA** (`local/scripts/test_admin_ui.py`, Playwright + mock JWT + mock эндпоинтов): раздел Инвестиции
  (позиция, KPI, спарклайн факт+прогноз, модалы Купить/Обновить/Стейкинг, empty/error), дашборд KPI «Инвестиции» +
  свободные; light/dark.
- **Regression**: SPEC-008 обмены (не сломаны новым `to=eth-invest`), SPEC-013/016 dashboard/accounts free
  (теперь минус invested), SPEC-003 фиат-курсы (cron не сломан крипто-фетчем), снапшоты (baseline инвест-ведра).

## 11. Risks & open questions

- **R1** (Binance из Cloudflare Worker): возможны 403/451 по гео/IP-репутации CF. Митигация: try/catch изоляция,
  fallback на вчерашний курс; при систематическом блоке — OQ1 (альтернативный источник CoinGecko/Coinbase).
- **R2** (cost basis без exchange-истории): если первый ETH занесён снапшотом (а не обменом) — cost basis неизвестен.
  Митигация: помечаем `cost_basis_known=false` (E2/AC8); рекомендация в UI «занеси покупку обменом для P&L».
- **R3** (депег stETH): пег stETH=ETH×1.0 завышает/занижает стоимость при депеге (исторически до ~0.93 в стрессе
  2022). Для MVP допустимо (Bybit/Lido стабильны). Митигация — OQ2 (отдельная котировка stETH позже).
- **R4** (доход стейкинга = «прирост минус покупки»): требует дисциплины снапшотов; редкие снапшоты → доход
  «скачками». APR-прогноз сглаживает визуально (пунктир). Это осознанно (manual=ground truth, NG2).
- **R5** (perf): полный реплей exchange/snapshot-истории на каждый `/investments` — single-user, копейки (как RBAR R5).
- **OQ1** (resolved → Binance): источник крипто-курса — **Binance** (owner 2026-06-06). Если CF-блок —
  переключение на CoinGecko/Coinbase обсуждается отдельно, не блокирует спеку.
- **OQ2** (resolved → пег): stETH = ETH×1.0 (owner). Отдельная котировка stETH/EUR — будущая итерация при депеге.
- **OQ3**: realized P&L при продаже ETH→USDT — нужен ли отдельный учёт (фиксация прибыли/налог)? Спека:
  **только нереализованный** в v1 (NG3); продажа уменьшает qty и cost basis средневзвешенно. Realized — позже.
- **OQ4**: `staking_income_qty < 0` (вывел больше, чем накапало) — показывать 0 за период (спека) или
  «net withdrawal»-метрику? Спека: **0 за период**, доход не отрицательный; вывод виден как падение qty/стоимости.
- **OQ5**: «застейкано» как доля позиции (частичный стейкинг) или весь баланс? Спека: **признак на позицию**
  (`is_staked` весь баланс), т.к. на практике стейкается всё купленное. Частичная доля — позже, если понадобится.
- **OQ6**: seed `eth-invest` сразу или дать создавать инвест-ведра в UI? Спека: **seed одно** (как 7 базовых вёдер);
  generic-создание инвест-вёдер (другие активы) — NG4/позже.

## 12. Out of scope для review

- Realized P&L / FIFO-лоты / налоговые отчёты, другие классы активов (акции/ETF/банк%), частичный стейкинг,
  отдельная котировка stETH, реалтайм-курс, on-chain/мультибиржевой учёт, Mini App-подсказка — сознательно
  отложены (NG3–NG7). Review не ругает их отсутствие.
- Точность APR-прогноза — это визуальная подсказка (forecast), не финансовая гарантия.

## 13. Changelog spec'а

- 2026-06-06: создан в `draft` после discovery-workflow (7 параллельных исследователей подсистем: rates,
  фонды/free, обмены, портфель, data-model, admin-арх, roadmap/specs) и 4 product-развилок, зафиксированных
  owner'ом: (1) полный портфель с P&L+доходностью, (2) курс ETH через Binance + пег stETH, (3) доход стейкинга
  из снапшотов + APR-прогноз пунктиром, (4) одна ETH-позиция с признаком «застейкано» (не обмен). Архитектура —
  ETH-холдинг как ведро + аналитическая линза поверх; `free = net − targeted − invested`. Реализация фазируется
  внутри спеки: Фаза 0 (курс+валюта+бэкфилл) → Фаза 1 (ведро+free+покупка+линза P&L) → Фаза 2 (стейкинг+доход+прогноз).
- 2026-06-06: реализовано (Фазы 0+1+2). Worker: миграция `0014` (валюта ETH, `accounts.is_investment`, seed `eth-invest`, уникальный индекс, `investment_settings`) + `rates.ts` (Binance `fetchCryptoRatesEUR`, инверсия, изоляция от фиата) + `investments.ts` (линза: WAC cost basis, P&L, доход стейкинга, value_series) + `free = net − targeted − invested` в `dashboard.ts`/`/v1/web/accounts` (+ `prev_invested`) + endpoint'ы `/v1/web/investments[/settings/:id]` + guard'ы (createSnapshot account, exchange currencies, goal_contribution не инвест-ведро, `db.ts` replaceReferences несёт form/sort_order/is_investment). Admin: раздел `/investments` (KPI + карточка позиции + спарклайн факт/прогноз + модалки Купить/Обновить/Стейкинг), дашборд (Net worth breakdown «Инвестиции», free), AccountsPage breakdown, фильтр инвест-вёдер из пикеров расхода/дохода/цели. Local: `backfill_crypto_rates.py`. **115 vitest** (12 investments) + typecheck чист + admin build зелёный + Playwright light/dark (admin-investments-{light,dark,buy,staking}). **Phase 3: qa=FAIL→PASS, arch=CHANGES_REQUESTED→APPROVED.** Оба рецензента независимо нашли 1 must-fix (E2-смешанный: manual-снапшот раньше первой покупки не детектился → `cost_basis_known` ложно true → катастрофическое завышение P&L и дохода стейкинга на opening balance). Закрыт сразу: `cost_basis_known=false` при снапшоте до первой покупки (P&L и доход стейкинга автоматически `null`); +тест на смешанный кейс. Nice-to-have (N+1 в getInvestments, `positions: any[]`, APR-прогноз на клиенте) — осознанный долг (R5/§12).
- 2026-06-06: **выкачено на прод** → `done`. Backup D1 → миграция `0014` применена (`execute --remote --file`, проверено: ETH=1, eth-invest=1, investment_settings=1) → worker + admin задеплоены → бэкфилл ETH/EUR (879 дней, 2024-01-10..2026-06-06) → прод-смоук Binance-из-Worker (`/v1/admin/refresh-rates` → `crypto_saved=1, crypto_error=null` — гео-блок R1 не сработал) → `/v1/web/investments` отвечает 401 без auth (роут+auth ок). roadmap Stage 9 ✅.
- 2026-06-06: hardening после adversarial stress-test (workflow: 4 рецензента × верификация по реальному коду,
  ~1.7М токенов). Впитаны 12 находок: prev_invested для корректного Δ свободных; WAC-списание cost basis при
  продаже; точная формула дохода стейкинга на границе «снапшот→сегодня» + случаи E4/нет-снапшота; уникальный
  индекс «одна инвест-позиция на валюту»; APR ∈ [0,100] (CHECK+Zod); UI cost_basis_known=false; легенда
  факт/прогноз + тултип (анти-восприятие прогноза как денег); детали backfill-скрипта; деплой миграции через
  `execute --file --remote` (AC17); усиление Binance geo-block + баннер устаревшего курса; сигнатура
  `investments.ts`, `listBuckets` отдаёт `is_investment`, исключение инвест-ведра из пикеров расхода/дохода;
  guard'ы валют/account в существующих обмене/снапшоте/вкладе (AC18). Отклонены ~18 «находок» вида
  «код ещё не написан» (это план Phase 2, не дефект спеки). Статус — `draft`, ждёт одобрения owner'а (Phase 1 gate).
- 2026-07-07: обратный superseded-маркер (аудит 2026-07, SPC-08): §5/§7 устарели точечно: `is_staked` теперь производный от `staked_qty>0` (SPEC-027); `source='binance'` → цепочка Binance→Coinbase→CoinGecko + `rate_ticks` (SPEC-028/ADR-019); период графика → autorange + начисление стейкинга (SPEC-029→SPEC-030).
