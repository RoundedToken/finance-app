---
id: SPEC-003
title: Stage 3 — Currency rates + Statistics screen in Mini App
status: done
owner: stepan
created: 2026-05-25
updated: 2026-05-25
links:
  - revised_by: [SPEC-014, SPEC-028, SPEC-036]  # stats снят и воссоздан; cron теперь 4×/сутки
  - adr: docs/decisions.md#adr-006
  - roadmap: docs/roadmap.md#этап-3-курсы-валют-и-аналитика-в-mini-app
---

# Stage 3 — Currency rates + Statistics screen

> Retrospective: spec написан после факта, когда Stage 3 уже закрыт. Фиксирует
> что реально было сделано — для будущих stages и для review-инструмента,
> которому нужен «договор» по каждой большой фиче.

## 1. Context & Problem

Mini App после Stage 2 умел только записывать траты, но не показывал ничего
суммарного. У пользователя расходы в 5 валютах (EUR / RSD / RUB / USD / USDT) —
без единой «базовой» цифры история превращается в случайный набор сумм.

Параллельно нужна была инфраструктура курсов: real-time GOOGLEFINANCE-курсы и
исторические для пересчёта старых трат (1822 записи за 2024-01-10..2026-05-23,
импортированные на Stage 4 из «Расходы ОК»). ADR-006 уже зафиксировал источник
(Google Sheets-прокси), но pipeline до D1 не был построен.

Stage 3 — две связанные подзадачи объединены: сначала курсы как фундамент
(без них статистика бессмысленна), потом UI-надстройка статистики в Mini App.

## 2. Goals

- G1: Cron-фетч актуальных курсов EUR→{USD,RUB,RSD,USDT} раз в сутки, источник
  Google Sheets с формулами `GOOGLEFINANCE` (ADR-006).
- G2: Backfill исторических курсов от 2024-01-10 до сегодня в D1, чтобы любую
  старую трату можно было пересчитать в любую базу.
- G3: Mini App конвертирует любую сумму в выбранную пользователем базу через
  EUR-ось (`amount/rEUR→ccy * rEUR→base`). Базовая валюта хранится в localStorage.
- G4: Экран «📊 Статистика» с KPI / donut / списком категорий / trend chart и
  drill-down — поверх уже импортированных 1822 трат.
- G5: Period picker (Нед / Мес / Год / Всё) с навигацией prev/next по периодам.
- G6: Pagination в Истории, чтобы 1800+ строк не крашили iOS Telegram WebView.
- G7: Автоматический Playwright-тестер скриншотит ключевые сценарии под
  iPhone 15 Pro Max — единственный честный способ ловить визуальные регрессии
  под Telegram WebView без 5 минут ручного клика.

## 3. Non-Goals

- NG1: Backfill курсов из ЦБ РФ / ЕЦБ / OpenExchangeRates — ADR-006 уже выбрал
  Google Sheets как единственный источник, фолбэк отложен до момента когда
  Google Sheets реально упадёт.
- NG2: Сравнение бюджет vs факт — нет бюджетов в системе.
- NG3: Аналитика по доходам/snapshots — для них пока нет данных (Stage 5/6).
- NG4: Экспорт статистики (CSV / PDF / share) — скриншот через системный
  Telegram достаточно.
- NG5: Worker-side агрегация / SQL-запросы для статистики. Все вычисления —
  в браузере поверх `state.expenses`, которые приходят разом в `/v1/bootstrap`.
  (Объём ~2000 записей на 5 лет умещается в памяти WebView без проблем.)

## 4. User journeys

### Happy path — посмотреть статистику

1. Пользователь открывает Mini App → видит numpad для ввода.
2. Тапает `☰` → «📊 Статистика».
3. По умолчанию открывается **месяц**, текущий, offset=0.
4. Видит:
   - Сверху — период nav: `‹ Май 2026 ›`.
   - Tab-bar: Нед / Мес / Год / Всё.
   - KPI: total в base + средн./день + кол-во трат + дельта к прошлому периоду.
   - Donut: топ-8 категорий + «Прочее» (если их больше).
   - Список категорий с pct, абсолютом и bar-индикатором.
   - Trend chart: по дням для нед/мес, по месяцам для год/всё.
5. Тапает категорию → модал drill-down со всеми тратами этой категории за период.
6. Тапает любую трату в drill-down → открывается edit-modal (как из Истории).

### Happy path — сменить базовую валюту

1. Меню → «Настройки».
2. Выбирает RUB → state.baseCurrency = "RUB", сохраняется в localStorage.
3. Все суммы (Главная, История, Статистика) пересчитываются мгновенно.

### Edge cases

- E1: Курсы не загрузились (Worker лежит) — `state.rates.quotes = {}`,
  `convertToBase` вернёт `null`. KPI показывает `! N без курса` в meta,
  donut/categories считают только те траты, для которых курс есть.
- E2: Период пустой (нет трат) — KPI вместо чисел: «Трат в этом периоде нет»,
  donut/categories пусты, trend chart молчит.
- E3: На «Всё время», когда трат нет вообще — диапазон = сегодня..сегодня.
- E4: `prev_period.total = 0` и `cur.total > 0` — дельта показывается как `▲ new`.
- E5: Длинное total-число в центре donut (например, 12 345 678) — `font-size`
  адаптивно: 13/17/21/24 в зависимости от длины строки.
- E6: Trend chart с одной точкой (`bins.length === 1`) — рисуется один бар,
  ось показывает один тик.

## 5. Data model

### D1 миграция 0005 — таблица курсов

```sql
CREATE TABLE IF NOT EXISTS rates (
    date       TEXT NOT NULL,       -- YYYY-MM-DD (UTC)
    base       TEXT NOT NULL,       -- всегда 'EUR' (фиксированная база)
    quote      TEXT NOT NULL,       -- 'USD' | 'RUB' | 'RSD' | 'USDT' | ...
    rate       REAL NOT NULL,       -- 1 base = rate quote
    source     TEXT NOT NULL,       -- 'google-sheets' | 'backfill' | 'manual'
    fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (date, base, quote)
);
CREATE INDEX IF NOT EXISTS idx_rates_quote_date ON rates(quote, date DESC);
```

### Семантика

- **EUR-ось.** Все курсы хранятся как `1 EUR = rate × quote`. Конверсия
  X→Y делается через EUR: `eur = X / rate(EUR→X); result = eur * rate(EUR→Y)`.
  Выбор EUR как базы — арбитрарный (можно было USD), главное что одна точка.
- **USDT = USD.** Один-в-один пэг, дублируется в backfill (`qs["USDT"] = qs["USD"]`).
  Для EUR→USDT в `latest` лист использует `IFERROR(GOOGLEFINANCE("CURRENCY:EURUSDT"),
  GOOGLEFINANCE("CURRENCY:EURUSD"))` — пэг не всегда есть в GOOGLEFINANCE.
- **EUR=1.** В Mini App `rateEURto("EUR") → 1` хардкодом, в D1 не хранится.
- **PRIMARY KEY (date, base, quote)** + `INSERT OR REPLACE` — идемпотентный upsert.
- **Backfill итог:** 3328 записей за 2024-01-10..2026-05-24 для 4 quotes (USD, RUB,
  RSD, USDT). Дни, когда GOOGLEFINANCE возвращает пусто (праздники / выходные),
  тихо пропускаются — для них `getRateAt` берёт ближайший раньше.

## 6. API contract

### `GET /v1/rates` — Mini App

- Auth: `X-Telegram-Init-Data` (HMAC validated).
- Response 200:
  ```json
  {
    "date": "2026-05-24",
    "base": "EUR",
    "quotes": { "USD": 1.16, "RUB": 82.63, "RSD": 117.41, "USDT": 1.16 }
  }
  ```
- Возвращает **только последнюю** доступную дату (`SELECT MAX(date)`).
- Не используется напрямую — `/v1/bootstrap` уже включает rates в payload.

### `POST /v1/admin/refresh-rates` — system

- Auth: `Bearer ${SYNC_TOKEN}`.
- Дергает Google CSV, парсит, делает `INSERT OR REPLACE`.
- Response 200: `{ "ok": true, "saved": N, "date": "YYYY-MM-DD" }`.
- 401 при неверном токене.
- Также вызывается из cron (см. ниже).

### `POST /v1/admin/bulk-rates` — system (для backfill)

- Auth: `Bearer ${SYNC_TOKEN}`.
- Request:
  ```json
  { "rates": [
      { "date": "2024-01-10", "base": "EUR", "quote": "USD",
        "rate": 1.0974, "source": "google-sheets" },
      ...
  ]}
  ```
- Batched через `env.DB.batch(stmts)`. Лимит batch — 500 записей (с клиента),
  это запас под D1 батч-лимит (100 statements в одной транзакции — округлили
  вниз для headroom).
- Response 200: `{ "ok": true, "inserted": N, "attempted": M }`.

### Worker Cron Trigger

- `wrangler.toml`: `crons = ["0 6 * * *"]` — каждый день в 06:00 UTC.
- `scheduled` handler в `index.ts` вызывает `fetchLatestRatesEUR(env)` →
  `saveRates(env, payload)`.
- Логирует `scheduled rates: saved ${n} for date ${date}`. Ошибки попадают в
  `console.error` и видны в `wrangler tail`.

## 7. UI / UX

### Layout статистики (мобильный, viewport 430×~840)

```
┌──────────────────────────────────────┐
│ ‹  Статистика                      ☰│   header (back / title)
├──────────────────────────────────────┤
│         ‹  Май 2026  ›               │   period nav
│   [Нед] [Мес*] [Год] [Всё]            │   tabs (* = active)
├──────────────────────────────────────┤
│   234 567 🇪🇺 EUR        ▲ 12%       │   KPI: total + delta
│   ≈ 7 853 🇪🇺/день · 142 трат        │
├──────────────────────────────────────┤
│              ╭──────╮                │
│            ╭─┤      ├─╮              │   donut (top-8 + Прочее)
│           ╱  │ 234k │  ╲             │
│          │   │ EUR  │   │            │
│           ╲  │      │  ╱             │
│            ╰─┤      ├─╯              │
│              ╰──────╯                │
├──────────────────────────────────────┤
│  🍔 Еда             42%  98 234 🇪🇺  │   stats-cat row
│  ━━━━━━━━━━━━━━━━━━━━━                │   bar-fill 42%
│  🛒 Продукты        28%  65 432 🇪🇺  │
│  ━━━━━━━━━━━━━━━━                     │
│  ...                                  │
├──────────────────────────────────────┤
│ Тренд по дням     средн. 7 853 …    │
│  ▌▎▍▊▆▇▅▍▊▎▌▍▊▎▌▍▊▎▌▍▊▎▌▍▊▎▌▍▊      │   bar chart
│  1 . . 7 . . 14 . . 21 . . 28        │   axis (5 ticks)
└──────────────────────────────────────┘
```

### Тонкости / решения

- **Discriminated palette.** 12 hue-разнесённых цветов (~30° между соседями),
  не пастельные cat.color. Решение: пастельные тайлы категорий на главной
  визуально сливаются на donut (3-4 розовых рядом нечитаемо), а chart нужен
  чёткий контраст. Порядок цветов специально такой, что соседние индексы
  максимально разнесены по hue → даже когда в donut выпали топ-2 категории,
  они не сливаются. Топ-8 получает уникальный цвет, всё остальное —
  `CHART_TAIL` (мягкий лиловый) в списке и `CHART_OTHER` в donut.
- **Adaptive font в центре donut.** `font-size = 13|17|21|24` в зависимости
  от `totalStr.length`. Длинные числа (`12 345 678`) физически не помещаются
  в круг при 24px.
- **Emoji-флаги в SVG.** Telegram WebView не рендерит color-emoji внутри SVG
  `<text>` — показывает пустой плейсхолдер. Решение: в центре donut показываем
  только код валюты (`EUR`), без флага. Флаг — только в KPI и cat-list (HTML).
- **`pointer-events: none` на центральном тексте donut.** Без этого SVG-текст
  перекрывает сегменты и tap по сегменту не работает в зоне за текстом.
- **Period nav state.** `next` disabled когда `offset >= 0` (нельзя в будущее)
  и на `all` (нет смысла). `prev` disabled только на `all`.
- **Trend axis adaptive ticks.**
  - `week` → 7 weekday-меток (ПН/ВТ/…/ВС), плотно (`.dense`).
  - `month` → 5 равномерных тиков (1, 7, 14, 21, 28-31).
  - `year` / `all` → до 6 тиков, для `all` к label добавляется `'YY` (год обязателен).
  Решение: длинные label (`май '26`) не помещаются под каждый bar — отрисовываем
  axis отдельным flexbox с space-between, бары рисуем отдельным flexbox.
- **Stagger fade-in donut.** Сегменты появляются с задержкой `40 + i*35` ms —
  premium-feel.
- **Cat-bar анимация.** `width: 0` → `width: ${pct}%` через `requestAnimationFrame`.
- **Drill-down модал.** Список трат в категории за период, тап → edit-modal
  (`closeModals(); setTimeout(openEditModal, 320)` — ждём transition).
- **History pagination.** `HISTORY_PAGE_DAYS = 30`. Рендерим 30 дней, дальше —
  sentinel + кнопка «Показать ещё». `IntersectionObserver` авто-подгружает
  следующую страницу при `rootMargin: 200px`. Причина: 1800+ строк с
  swipe-handlers крашили iOS WebView (память + слишком много touch-listeners).

## 8. Security

- **Mini App API (`/v1/rates`, `/v1/bootstrap`).** `X-Telegram-Init-Data` HMAC
  + проверка `isAuthorizedUser(env, user_id)` — те же правила что для expenses.
- **Admin endpoints (`/v1/admin/refresh-rates`, `/v1/admin/bulk-rates`).**
  `Bearer ${SYNC_TOKEN}` — только для локального backfill / ручного refresh.
- **Cron handler.** Запускается Cloudflare без авторизации, но `env` доступен
  только Worker'у — никаких внешних входов.
- **Google Sheet.** Расшарен `anyone with link → reader` для CSV-экспорта.
  Сам Sheet содержит только курсы валют (публичная инфа), service account —
  writer (только для setup). Service-account JSON-ключ — на MacBook в
  `~/.config/finances/`, в git не попадает (см. MEMORY.md).
- **Input validation.** В `parseLatestCsv` — проверка `header[0]==="date"`,
  `isFinite(num) && num > 0`. В `saveRates` — `if (!isFinite(rate) || rate <= 0)
  continue`. В backfill — `try/except` на каждой ячейке.
- **PII.** Курсы валют — public data. В логи (`console.log`) попадают только
  count + date. Конкретные суммы пользователя в rates-pipeline не задействованы.

## 9. Acceptance criteria

- [x] AC1: D1 содержит ≥ 3000 записей в `rates` за период 2024-01-10..сегодня
      по 4 quotes (USD, RUB, RSD, USDT). _Реально: 3328._
- [x] AC2: Worker cron `0 6 * * *` пишет новую запись в `rates` каждый день;
      на отсутствие котировки в источнике — лог `console.error`, не падает.
- [x] AC3: `/v1/bootstrap` возвращает `{rates: {date, base: "EUR", quotes}}` —
      используется Mini App для всех конверсий.
- [x] AC4: Mini App: смена `baseCurrency` в Settings мгновенно перерисовывает
      все экраны (Главная, История, Статистика) в новой базе.
- [x] AC5: Экран «📊 Статистика» открывается из меню, по умолчанию — текущий
      месяц.
- [x] AC6: KPI показывает total в base, ≈ avg/день, кол-во трат, дельту к
      прошлому периоду (`▲ +12%` / `▼ −5%` / `→ flat` / `▲ new`).
- [x] AC7: Donut визуализирует топ-8 категорий + «Прочее» отдельным сегментом;
      каждый сегмент получает уникальный цвет из 12-цветной палитры; tap по
      сегменту открывает drill-down.
- [x] AC8: Список категорий: pct, абсолют, bar-индикатор с цветом сегмента;
      tap → drill-down.
- [x] AC9: Trend chart рисует bars по дням (week/month) или месяцам (year/all);
      ось X имеет читабельные ticks (7 / 5 / 6); максимальный бар выделен класс
      `today`, средняя линия — `stats-trend-avg`.
- [x] AC10: Period prev/next корректно отключается (`next` нельзя в будущее,
      `all` не имеет соседей).
- [x] AC11: На пустом периоде KPI показывает «Трат в этом периоде нет», donut
      и список молчат.
- [x] AC12: История: после 30 дней появляется sentinel «Показать ещё»,
      `IntersectionObserver` авто-подгружает следующую пачку при scroll.
- [x] AC13: `local/scripts/test_ui.py` рендерит 20 сценариев и не выдаёт
      `pageerror` в console-сборщике.

## 10. Test plan

### Что протестировано

- **Worker rates.** `setup_rates_sheet.py` запущен → Sheet создан, формулы
  записаны, CSV-URL'ы в `.env`. Затем `wrangler dev` → `POST
  /v1/admin/refresh-rates` с Bearer → проверено что `rates` пополняется (через
  `wrangler d1 execute --command "SELECT COUNT(*) FROM rates"`).
- **Backfill.** `python local/scripts/backfill_rates.py --dry-run` → виден
  payload. Затем без `--dry-run` → 3328 записей в D1 за 7 батчей × 500.
- **Cron.** В `wrangler tail` ловится daily вызов `scheduled rates: saved 4
  for date 2026-05-XX`.
- **Mini App stats.** `local/scripts/test_ui.py` под iPhone 15 Pro Max (430×932,
  DPR=3) с моком на 870 дней синтетических трат:
  - `04_stats_month` — текущий месяц.
  - `05_stats_year` / `06_stats_all` / `07_stats_week` — все периоды.
  - `08_stats_prev_month` — навигация назад.
  - `09_stats_drilldown` — тап по категории в списке.
  - `19_stats_year_back_2025` — комбо tab + prev.
  - `20_stats_donut_segment_tap` — tap по segment в donut.
  Скриншоты сохраняются в `local/screenshots/` (top + `_bottom` для overflow).
  Console-логи собираются и печатаются — нет errors / warnings на финальном
  прогоне.
- **Регрессия.** История 16 / 17 — pagination + tap на первую строку. Settings
  18 — смена base на RUB → все суммы пересчитались.

### Что **не** протестировано в Stage 3

- Реальное поведение GOOGLEFINANCE в нерабочие дни / большие праздники
  (наблюдаем на проде месяцами).
- Что произойдёт если Google Sheet будет удалён случайно — нужен alert на
  failed cron (откладываем до Stage 10 AI Coach).

## 11. Risks & open questions

- R1: GOOGLEFINANCE может тихо возвращать `#N/A` для некоторых валют (видели
  на USDT). Решено через `IFERROR(...)` в формуле + пэг USDT=USD при backfill.
  Остаточный риск: новый quote (например, BTC) может потребовать ручной
  настройки.
- R2: Cron `0 6 * * *` ловит курс на 06:00 UTC = 08:00 CET. Этого достаточно
  для дневной точности, но «курс по итогам торгов» Google публикует около
  22:00 UTC. Если когда-нибудь понадобится EOD — переключить cron.
- R3: Backfill заполняет только торговые дни. В выходные / праздники
  `getRateAt(quote, date)` возвращает последний доступный курс. Это
  «приближение», для исторических трат на ±1 день погрешность <0.5%.
- R4: ~2000 трат в памяти Mini App — нормально. При 10k+ потребуется
  серверная агрегация. Сейчас просто фиксируем потолок: client-side всё.
- OQ1 (решено в Stage 5): нужны ли курсы для `snapshots` тоже? Да, через тот
  же `getRateAt`. Это переиспользует фундамент Stage 3.

## 12. Out of scope для review

- Web Admin не имеет своего экрана статистики — это Stage 8 (главный дашборд).
  Сейчас в Web Admin есть только список трат (TanStack Table) — без
  агрегации.
- TypeScript типизация `rates.ts` лёгкая (`Record<string, number>`) — без
  строгой валюты-union. Сознательно, чтобы не таскать enum через все слои.

## 13. Changelog spec'а

- 2026-05-25: создан в `done` ретроспективно после фактического закрытия
  Stage 3 (по факту реализован в течение ~10 дней до даты создания spec'а).
- 2026-07-07: обратный superseded-маркер (аудит 2026-07, SPC-08): экран «📊 Статистика» (vanilla) снят при SPEC-014 и воссоздан в React SPEC-036 (`revives`); cron курсов теперь 4×/сутки `0 */6 * * *` (SPEC-028), не 1×/сутки `0 6 * * *` из этой спеки.
