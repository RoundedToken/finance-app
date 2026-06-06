---
id: SPEC-027
title: Инвестиции — итерация 2 (цена в USDT, частичный стейкинг, авто-APR с Lido)
status: done
owner: stepan
created: 2026-06-06
updated: 2026-06-06
links:
  - parent: SPEC-026
  - adr: docs/decisions.md#adr-018
  - depends_on: [SPEC-026]
---

# Инвестиции — итерация 2

> Доработка SPEC-026 по фидбэку с живого прода (owner, 2026-06-06): (1) показывать цену/стоимость
> не только в EUR, но и в **USDT**; (2) **частичный стейкинг** — не вся позиция застейкана, нужна
> разбивка «застейкано / свободно» и возможность убрать из стейкинга; (3) **APR авто** — тянуть базовый
> stETH APR с публичного Lido API + ручной override (owner-решение: «Авто из Lido + override»).

## 1. Context & Problem

SPEC-026 показывает стоимость только в EUR; для крипты привычнее видеть и USDT. Стейкинг сделан бинарной
галочкой на всю позицию — но реально часть ETH в стейкинге, часть свободна, а «убрать из стейкинга»
неочевидно (галочка спрятана в модале). APR вводится вручную, хотя базовый stETH-APR публичен у Lido.

## 2. Goals

- **G1** (USDT): на карточке позиции и в KPI «Стоимость портфеля» рядом с EUR показываем USDT-эквивалент
  (цена ETH и стоимость позиции). Конверсия — через `RatesIndex.convertAt(.., 'ETH', 'USDT', today)` (ADR-014,
  клиент не конвертирует). USDT уже есть в курсах (пег к USD).
- **G2** (частичный стейкинг): `investment_settings.staked_qty` (REAL ≥0) — сколько единиц актива в стейкинге.
  `is_staked` становится **производным** (`staked_qty > 0`). Карточка показывает разбивку **застейкано /
  свободно** (`liquid = qty − staked_qty`). Убрать из стейкинга = `staked_qty = 0`. Модал стейкинга:
  поле «сколько ETH в стейкинге» (вместо галочки).
- **G3** (авто-APR Lido + override): Worker cron ежедневно тянет **сглаженный stETH APR** с публичного
  Lido API (`/v1/protocol/steth/apr/sma` → `data.smaApr`, fallback `/last` → `data.apr`) и кладёт в
  `app_config` (key/value). Эффективный APR позиции = `staking_apr_pct` (ручной override, nullable) **??**
  авто-APR Lido. Поле APR в модале необязательное (плейсхолдер = авто-значение Lido).
- **G4**: APR-прогноз (пунктир, forecast) применяется **только к застейканной доле** (свободный ETH не
  растёт от стейкинга). Фактический доход стейкинга по-прежнему из снапшотов (SPEC-026, не меняем).
- **G5**: Без новых внешних секретов; Lido fetch изолирован (как Binance — отдельный try/catch, падение
  не валит фиат/крипто-курсы). Только Web Admin (Mini App не трогаем).

## 3. Non-Goals

- **NG1**: Не тянем APR с Bybit (публично без API-ключа не отдаётся). Auto = базовый Lido APR; разницу
  (Bybit-комиссия) закрывает ручной override.
- **NG2**: `staked_qty` — ручная аннотация (сколько ты застейкал), не отдельный авто-трекаемый баланс.
  Ребейзинг-рост по-прежнему фиксируется снапшотом всей позиции (SPEC-026). Отдельной валюты stETH нет (пег, NG1 SPEC-026).
- **NG3**: Не realized P&L, не другие активы (как в SPEC-026).

## 4. User journeys

### Happy path
1. На `/investments` карточка ETH показывает: стоимость **3 300 € (≈ 3 830 USDT)**, курс **3 142 € · 3 647 USDT**,
   разбивку **застейкано 0.70 · свободно 0.35 ETH**, бейдж «в стейкинге · APR 2.5% (Lido)».
2. Жму **«Стейкинг»** → поле «Сколько ETH в стейкинге» (текущее `0.70`, макс = `1.05`), поле APR пустое
   с плейсхолдером «авто Lido 2.5%» (можно перебить). Меняю на `1.05` → вся позиция в стейкинге; или на
   `0` → убрал из стейкинга.
3. Прогноз-пунктир на спарклайне растёт по застейканной доле × эффективный APR.

### Edge cases
- **E1** (нет авто-APR, Lido недоступен / ещё не фетчили): эффективный APR = override, иначе прогноз не рисуем
  (как при отсутствии APR). Фактический доход не зависит от APR.
- **E2** (`staked_qty > qty`, напр. после продажи): клампим `staked_qty` к `[0, qty]` при отображении.
- **E3** (legacy `is_staked=1`, `staked_qty` NULL — из SPEC-026): трактуем как «вся позиция застейкана»
  (`staked_qty = qty`) до первого явного задания, чтобы не терять состояние.

## 5. Data model

Миграция **`0015_investments_staking.sql`** (`schema.sql` параллельно).

```sql
-- 0015_investments_staking.sql — SPEC-027
-- Частичный стейкинг: сколько единиц актива в стейкинге (is_staked → производный staked_qty>0).
ALTER TABLE investment_settings ADD COLUMN staked_qty REAL CHECK (staked_qty IS NULL OR staked_qty >= 0);

-- Глобальный key/value конфиг — авто-APR stETH с Lido (cron), и под будущие глобальные значения.
CREATE TABLE IF NOT EXISTS app_config (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- `staking_apr_pct` теперь = **ручной override** (NULL = использовать авто-APR Lido). `is_staked` оставлен
  в схеме (legacy), но не источник истины — `is_staked` выставляется производно (`staked_qty>0`) при upsert.
- `app_config['steth_apr_pct']` — последний сглаженный Lido APR (строкой), обновляется cron + refresh-rates.

## 6. API contract

### `GET /v1/web/investments` (изменено, additive)
Каждая позиция дополняется:
```jsonc
"price_usdt": 3647.0, "value_usdt": 3830.0,
"staked_qty": 0.70, "liquid_qty": 0.35,
"staking_apr_pct": 2.5,            // эффективный (override ?? auto Lido)
"staking_apr_override": null,      // ручной override или null
"staking_apr_auto": 2.5            // авто из Lido или null
```
`summary` дополняется `value_usdt`. `is_staked` = `staked_qty > 0`.

### `PUT /v1/web/investments/settings/:accountId` (изменено)
Body (Zod): `{ staked_qty?: number≥0|null, staking_apr_pct?: number 0..100|null, note?: string|null }`.
Guard: `staked_qty ≥ 0`; `is_staked` выставляется производно. (`is_staked` из тела больше не принимается.)

### Cron / `POST /v1/admin/refresh-rates` (изменено, additive)
После фиата и крипты — **отдельный** try/catch: `fetchLidoStethApr()` → `app_config['steth_apr_pct']`.
Ответ refresh-rates дополняется `lido_apr`/`lido_error` (диагностика).

## 7. UI / UX (Web Admin `/investments`)

- **Стоимость/цена**: EUR — основная, USDT — рядом приглушённо («3 300 € · ≈ 3 830 USDT»; «курс 3 142 € · 3 647 USDT»).
- **Разбивка стейкинга**: строка «застейкано 0.70 · свободно 0.35 ETH» (если позиция есть). Бейдж APR
  показывает источник: «APR 2.5% (Lido)» или «APR 4.0% (вручную)».
- **Модал «Стейкинг»**: поле **«Сколько ETH в стейкинге»** (number, 0..qty; `0` = убрать), поле **APR override**
  (опц., плейсхолдер «авто Lido X%»), заметка. Галочки `is_staked` больше нет.
- **Прогноз-пунктир**: по застейканной доле × эффективный APR (свободная доля не растёт). Легенда/тултип «не реальные деньги» — как в SPEC-026.
- Light/dark, hover, KPI «Стоимость портфеля» += USDT-строка.

## 8. Security

- Lido — публичный read-only API (`eth-api.lido.fi`), без секретов/ключей. Изолированный try/catch.
- Валидация Zod + домен: `staked_qty ≥ 0`, `staking_apr_pct ∈ [0,100]`. SQL параметризован. В логи — только ok/fail.

## 9. Acceptance criteria

- [ ] **AC1** (USDT): позиция и summary возвращают `price_usdt`/`value_usdt`; UI показывает EUR + USDT; конверсия через `convertAt('ETH','USDT')`.
- [ ] **AC2** (staked_qty): `PUT settings` с `staked_qty` сохраняет; `liquid = qty − staked` (кламп ≥0); `is_staked` производный; `staked_qty=0` убирает из стейкинга.
- [ ] **AC3** (legacy E3): `is_staked=1` + `staked_qty` NULL → трактуется как `staked_qty=qty`.
- [ ] **AC4** (авто-APR): cron/refresh пишет `app_config['steth_apr_pct']` из Lido (SMA, fallback last); эффективный APR = override ?? auto; Lido-fetch изолирован (падение не валит курсы).
- [ ] **AC5** (override): `staking_apr_pct` перебивает авто; `staking_apr_auto`/`staking_apr_override` возвращаются раздельно для UI.
- [ ] **AC6** (forecast на staked): прогноз-пунктир считается по застейканной доле, не по всей позиции.
- [ ] **AC7** (регрессии): фактический доход стейкинга (снапшоты), free/invested, cost basis — не изменились; 115+ vitest зелёные.
- [ ] **AC8** (UI): модал стейкинга с amount-полем (без галочки), разбивка застейкано/свободно, USDT, APR-источник; light/dark; миграция 0015 + schema.sql; gitleaks clean.

## 10. Test plan

- **Worker vitest**: Lido APR парсинг (sma/last/ошибка→throw, изоляция), `staked_qty`/liquid/legacy-fallback, эффективный APR (override ?? auto), USDT-конверсия в ответе, регресс доход стейкинга/free.
- **Admin**: Playwright `/investments` light/dark + модал стейкинга (amount) + USDT на карточке.
- **Regression**: SPEC-026 (free, P&L, cost basis, доход стейкинга, guards) не сломан.

## 11. Risks & open questions

- **R1** (Lido API доступность из CF Worker): как и Binance — изолируем; при недоступности эффективный APR = override или прогноз скрыт. Проверить прод-смоук (`lido_apr` в ответе refresh-rates).
- **R2** (auto vs Bybit точность): авто = базовый Lido APR, чуть выше реального Bybit (комиссия). Override закрывает. Осознанно (NG1).
- **OQ1** (resolved): источник APR — **авто Lido + override** (owner 2026-06-06).

## 12. Changelog

- 2026-06-06: создан в `in_progress` после фидбэка с прода (3 пункта) + owner-решения «авто Lido + override».
- 2026-06-06: **выкачено на прод** → `done`. Backup → миграция `0015` (`execute --remote --file`, проверено: `app_config.steth_apr_pct=2.48`, колонка `staked_qty` есть) → worker + admin задеплоены → прод-смоук `/v1/admin/refresh-rates` → `lido_apr=2.48, lido_error=null` (Lido-из-Worker работает) + `crypto_saved=1`.
- 2026-06-06: реализовано. Worker: миграция `0015` (`investment_settings.staked_qty`, `app_config`) + `rates.ts fetchLidoStethApr` (sma→last, изоляция) + cron/refresh пишут `app_config['steth_apr_pct']` + `db.ts` getAppConfig/setAppConfig + `investments.ts` (staked_qty/liquid, USDT price/value через `convertAt`, эффективный APR = override ?? авто, legacy is_staked→full, upsert деривит is_staked) + schemas (staked_qty). Admin: USDT на карточке/KPI, разбивка застейкано/свободно, модал стейкинга с amount-полем (без галочки) + APR-override с авто-подсказкой Lido, forecast по застейканной доле. **119 vitest** (16 investments) + typecheck + admin build + Playwright light/dark/модалки. **Phase 3: qa=PASS_WITH_NICES, arch=APPROVED_WITH_NICES** (без must-fix; закрыты nice-to-have: дрейф data-model.md, Zod `.finite()` на staked_qty, комментарии 0015/rates).
