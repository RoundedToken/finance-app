# Architecture Review: SPEC-003 Stage 3 — Currency rates + Statistics screen
date: 2026-05-25
verdict: APPROVED_WITH_NICES

## Summary

Retrospective audit of Stage 3 (Cron-fetched EUR-based rates + Mini App Stats screen + History pagination). Implementation matches the spec faithfully — all 13 acceptance criteria are met in code, ADR-006 (Google Sheets prokси) is honoured, the EUR-ось conversion model is consistent across Worker, D1, and Mini App. SQL is parameterised in all rates endpoints. The discriminated palette is correct and the donut/cat-list/trend chart logic is clean. Findings are nice-to-have refinements: a few input-validation gaps (`/v1/admin/bulk-rates`), one latent bug in a one-off setup script (`load_env` does not populate `os.environ`), a minor schema-snapshot inconsistency (`DESC` on the index), and a doc-comment in `0005_rates.sql` that still references the pre-pivot source ("open-er-api"). Performance on the 1822-expense dataset is fine for the stated client-side ceiling (~2k). No security blocker, no ADR violation.

## Must-fix (CHANGES_REQUESTED)

None. Spec acceptance criteria are met, no security blocker, no ADR-006 violation, all admin endpoints are auth-gated, all SQL is parameterised.

## Nice-to-have

- [validation/admin] `cloud/worker/src/index.ts:271-285` — `handleBulkRates` accepts the entire `body.rates` array without per-item validation, in contrast to `saveRates` which guards `if (!isFinite(rate) || rate <= 0) continue`. A malformed payload (missing `date`, string `rate`, negative number) will be bound to D1 and either silently inserted as bad data or throw a cryptic batch error. Since the endpoint is protected by `SYNC_TOKEN` (low blast radius), this is not security-critical, but it is the only admin endpoint without input validation. Suggestion: mirror the `saveRates` guard:
  ```ts
  const stmts: D1PreparedStatement[] = [];
  for (const r of items) {
      if (typeof r.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) continue;
      if (typeof r.quote !== "string" || r.quote.length < 3) continue;
      const rate = Number(r.rate);
      if (!isFinite(rate) || rate <= 0) continue;
      stmts.push(env.DB.prepare(...).bind(...));
  }
  ```
  Also worth capping `items.length` (≤ 1000) — spec §6.3 says client batches at 500 but the server has no enforcement, so a future caller could blow past D1's batch limit.

- [migrations/index] `cloud/worker/migrations/0005_rates.sql:14` declares the index as `ON rates(quote, date DESC)` but the snapshot `cloud/worker/schema.sql:76` has it without `DESC`. SQLite ignores the `DESC` qualifier on an index when it can still satisfy the query plan via index walk, so functionally both work for `getRateAt`'s `ORDER BY date DESC LIMIT 1`. Still, the two should match — either drop `DESC` from the migration (since SQLite treats it as documentation only) or add it to the snapshot for parallelism. Pure documentation hygiene, not a runtime issue.

- [migrations/docs] `cloud/worker/migrations/0005_rates.sql:1-3,10` comment block references "open.er-api.com" as the source. ADR-006 picked Google Sheets and the actual code/spec/schema all use `'google-sheets'`. The migration was renamed but the comment was not updated. Fix in-place — migrations are immutable in spirit but comment-only edits are fine.

- [setup/bug] `local/scripts/setup_rates_sheet.py:25-35` calls `load_env()` which returns a `dict[str,str]` but does **not** mutate `os.environ`. Lines 28-29 then call `os.environ.get("RATES_SHEET_TITLE")` / `os.environ.get("RATES_SHEET_OWNER_EMAIL")` — these will only find values if the user manually exported them in shell, not from `.env`. This is a latent bug that only surfaces when the user follows the `.env`-based setup instruction. Two fixes possible: (a) call `os.environ.update(load_env())` once at top, or (b) refactor to use the returned dict explicitly: `env = load_env(); OWNER_EMAIL = env.get("RATES_SHEET_OWNER_EMAIL")`. Option (b) is consistent with `backfill_rates.py:105` (`assert_env` returns a dict).

- [types/worker] `cloud/worker/src/index.ts:273,276` — `handleBulkRates` uses `body as any` and `r: any` over each item. Combined with the missing validation above, a typed `RateRow` from `cloud/worker/src/rates.ts` would document the contract and catch wrong shapes at edit-time. Suggestion: export `interface RatePayload { date: string; base?: string; quote: string; rate: number; source?: string; }` from `rates.ts` and use `body.rates as RatePayload[]` after `Array.isArray` check.

- [worker/db] `cloud/worker/src/db.ts:185-194` issues two sequential D1 queries to assemble `state.rates`: first `SELECT MAX(date)`, then `SELECT quote, rate FROM rates WHERE date = ?`. The first is in the bootstrap `Promise.all`, but the second runs after the await. Could be one query:
  ```sql
  SELECT quote, rate FROM rates
   WHERE base = 'EUR' AND date = (SELECT MAX(date) FROM rates WHERE base = 'EUR')
  ```
  This trims one D1 roundtrip from `/v1/bootstrap` (the hot path that runs once per Mini App open). Minor — bootstrap is not in the inner loop — but worth noting. Same code exists in `cloud/worker/src/rates.ts:69-85` (`getLatestRates`) and could be DRY-ed onto a shared helper if both stay.

- [worker/dead-code] `cloud/worker/src/rates.ts:88-99` — `getRateAt` is exported but not imported anywhere in `cloud/worker/src/`. The spec §11 OQ1 notes "решено в Stage 5 — да, через тот же `getRateAt`" — so the function is forward-looking infrastructure for Stage 5 snapshots conversion. That's a YAGNI-edge call: by ADR/process rules it should not exist before its caller is written, but in this case it's part of the same architectural cohesion (rates layer). Acceptable, but flag as «infrastructure-ahead-of-caller» tech debt and verify Stage 5 actually plugs it in.

- [worker/dead-endpoint] `cloud/worker/src/index.ts:85,171-176` (`GET /v1/rates`) is wired up and authenticates Mini App, but `cloud/miniapp/public/app.js` only ever calls `/v1/bootstrap` (line 54). The endpoint is dead from the Mini App's perspective. Spec §6.1 acknowledges this: "Не используется напрямую — `/v1/bootstrap` уже включает rates в payload". Two options: (a) document the endpoint as a debug/health check (e.g., for `curl` smoke tests); (b) remove it for less surface area. Either way the dissonance between "exists" and "never used" should be resolved.

- [miniapp/perf] `cloud/miniapp/public/app.js:923-936` (`aggregateForPeriod`) iterates over all `state.expenses` for every render, and `renderStatsScreen` calls it **twice** (current period + previous period) on every tab/period change. With 1822 expenses this is ~3700 iterations per stats interaction. Not a problem at present scale (sub-ms in Chrome on iPhone 15 Pro Max), but at the spec's own R4 ceiling (~10k expenses) it doubles to ~20k iterations per tap. Trivial pre-index by date (e.g., `state.expensesByMonth = Map<YYYY-MM, Expense[]>` computed once on bootstrap) would scale linearly. Not needed today; flag for Stage-10+ when crossing 10k.

- [miniapp/timezone] `cloud/miniapp/public/app.js:31` `todayISO()` uses `toISOString().slice(0,10)` (UTC date) but `getStatsRange` (line 890) starts from `new Date()` with local-time `setHours(0,0,0,0)`. In timezones far from UTC (or late-night UTC boundary), `todayStr` and the local "today" can disagree, leading to off-by-one period boundaries. For a single user in CET (UTC+1/+2) this is largely invisible, but if the spec ever serves a user in UTC+10 or beyond, the trend-chart "today" highlight will be wrong near midnight. Suggest unifying to local-time everywhere (`function todayISO() { const d = new Date(); return ${y}-${m}-${dd}; }`) — match the format used in `isoDate(d)` (line 861).

- [miniapp/csv-parser/locale-risk] `cloud/worker/src/rates.ts:34-37` — CSV parser splits on `,` with no quote-aware logic. The published Google Sheets CSV uses `,` as separator and `.` as decimal when the Sheet locale is "United States". If a future maintainer changes the Sheet locale (or Google ever returns thousand-separators inside a value), parsing breaks. ADR-006 / `setup.md` document the locale requirement, but there's no programmatic guard. Suggestion: when `parseFloat(raw)` returns NaN, log `console.error("rates csv: cannot parse '${raw}' for ${quote}")` rather than silently dropping — current behavior masks a setup misconfiguration.

- [miniapp/console-noise] `cloud/miniapp/public/app.js:60-62` — `bootstrap()` swallows the error into `state.bootstrapError` but never surfaces a user-visible toast for fetch failures other than what the categories slider displays at first paint. If `bootstrap()` fails *after* a successful first paint (e.g., user reloads the app while CF Worker is throttled), the stats screen will fall back to whatever's in `state.expenses` (empty) without a clear "rates failed to load" indicator. Spec §E1 covers `state.rates.quotes = {}` for the missing-rates case but assumes bootstrap itself succeeded. Minor edge case.

- [security/CORS] `cloud/worker/src/index.ts:320-329` — same finding as SPEC-001 audit: `pickAllowedOrigin` falls back to `"*"`. For `/v1/admin/refresh-rates` and `/v1/admin/bulk-rates` the response body is `{ ok, saved, date }` / `{ ok, inserted, attempted }` — no sensitive data, and these endpoints are Bearer-protected. So functionally OK. But the consistent CORS policy means a future change to that response shape inherits a permissive header. Already on the SPEC-001 backlog; noting that Stage 3 added two more endpoints under the same umbrella.

## What's good

- **ADR-006 honoured.** Google Sheets is the single source for both `latest` (cron) and `history` (backfill) — no exchangerate.host or `open.er-api.com` fallback was silently added. The CSV-export URL is in `env.GOOGLE_RATES_LATEST_CSV` (set in `wrangler.toml` vars), kept out of code.

- **EUR-axis conversion is symmetric and correct.** `cloud/miniapp/public/app.js:142-154` — `convertToBase(amount, currency)` does `amount / rateEURto(currency) * rateEURto(state.baseCurrency)`. When `currency === baseCurrency` early-returns `amount` (no rounding noise). Returns `null` (not `0` or `NaN`) when a rate is missing — and every caller (`dayTotalHTML`, `aggregateForPeriod`, `openCategoryDrilldown`) checks `null` explicitly. EUR is hard-coded as 1 in `rateEURto` (line 143) and **not** stored in D1 — consistent with spec §5.

- **USDT = USD peg propagated everywhere.** Three places enforce it: (a) `cloud/worker/src/rates.ts` not at all — the Worker only writes what comes from Google; (b) `cloud/worker/src/rates.ts` parser via the `IFERROR(EURUSDT, EURUSD)` formula in `setup_rates_sheet.py:112`; (c) `local/scripts/backfill_rates.py:68-70` explicit `qs["USDT"] = qs["USD"]`. Three independent points keep the peg even if GOOGLEFINANCE drops USDT. Bonus: the peg is documented in spec §5 with rationale.

- **SQL fully parameterised.** Every rates query uses `.bind(...)` — `cloud/worker/src/rates.ts:58-60,80,95-97`, `cloud/worker/src/db.ts:185,191`, `cloud/worker/src/index.ts:277-280`. No string concatenation, no template interpolation, even on the SYNC_TOKEN-guarded admin paths. Matches the architect checklist literally.

- **Idempotent upsert via `INSERT OR REPLACE` on composite PK `(date, base, quote)`.** `cloud/worker/src/rates.ts:58`, `cloud/worker/src/index.ts:278`. Re-running cron or backfill is safe — matches ADR-005's idempotency posture (UUID + INSERT OR IGNORE) translated to a natural-key context. Spec §5 explicitly justifies the PK choice.

- **CSV parser is robust to N/A / empty / negative.** `cloud/worker/src/rates.ts:46-47` — `parseFloat("#N/A")` → NaN → filtered; empty → NaN → filtered; negative → `num > 0` filter. Plus the column header normalisation `col.startsWith("EUR") ? col.slice(3) : col` handles both `EURUSD` and a bare `USD` header — future-proofs for Sheet renames. Backfill parser `local/scripts/backfill_rates.py:50-66` is even more defensive: `try/except` on every cell, skip zero/negative, skip empty.

- **Cron handler does not throw.** `cloud/worker/src/index.ts:51-59` wraps the scheduled call in try/catch, logs `console.error` but never rethrows — matches `scheduled` Worker contract (errors are visible in `wrangler tail`, no retry storm). Spec AC2 verified.

- **Discriminated palette algorithm is correct.** `cloud/miniapp/public/app.js:961-969` (`buildStatsPalette`) — sort by sum desc, top-8 get palette indices 0-7, rest get `CHART_TAIL`. Donut (line 1047-1054) groups top-8 + "Прочее" with `CHART_OTHER`. The 12-color palette (lines 944-957) has intentional hue offsets (~30° between adjacent) — visually verified via Playwright screenshots. The interleaved hue order (violet → amber → emerald → rose → cyan → lime → pink → sky → orange → light-purple → light-green → light-red) guarantees the top-2 picks are maximally distinct even when only 2 categories exist.

- **Adaptive donut font sizing.** `cloud/miniapp/public/app.js:1071` `totalFs = totalStr.length > 8 ? 13 : ...` handles long base-currency numbers (e.g., RUB at 8-figure scale) without manual layout. The mid-pixel-precision sizes (13/17/21/24) avoid the "between sizes" jitter from a linear formula. Solid practical UX detail.

- **History pagination via `IntersectionObserver` with explicit fallback to button.** `cloud/miniapp/public/app.js:478-499` — `IntersectionObserver` triggers when sentinel approaches with `rootMargin: 200px`, but the visible "Показать ещё" button is still there as a manual fallback for browsers without IO or for users who want explicit control. The page-size constant `HISTORY_PAGE_DAYS = 30` (line 423) is named and at top of section. iOS WebView memory-crash justification is in a comment (line 421-422). Spec AC12 satisfied with comment context for future maintainers.

- **Period nav state is enforced correctly.** `cloud/miniapp/public/app.js:977-978` — `next` disabled when `offset >= 0` (can't navigate into the future) OR `range.type === "all"`. `prev` disabled only on `"all"`. Click handler on `#stats-next` (line 809) has the same `< 0` check as a defence-in-depth. Spec AC10 met.

- **Stagger fade-in done with `setTimeout` not `animationDelay`.** `cloud/miniapp/public/app.js:1095-1103` — uses inline `style.opacity = "0"` + `style.transition` + scheduled `setTimeout(... 40 + i*35)`. This dodges Telegram WebView's known buggy CSS-animation-delay behaviour for SVG circles. Pragmatic.

- **EUR base assumption is queried, not hard-coded in D1 reads.** Both `getLatestRates` (`cloud/worker/src/rates.ts:80`) and `getRateAt` (line 95) use `WHERE base = 'EUR'`. If a future ADR ever introduces a second base, the conversion path is encapsulated. The hard-code only lives in two consistent places: the spec, and the Mini App's `rateEURto`. Reasonable balance.

- **Playwright UI tester covers all 13 ACs.** `local/scripts/test_ui.py` — 20 scenarios, including the must-test combos (drill-down, year+prev, donut-segment-tap, history-scroll-bottom, base-currency-change). Console errors are captured per-scenario and printed at the end (lines 322-328). Mock bootstrap (line 120-128) uses real category list + real RATES shape, so the tester is not building a fake structure. iPhone 15 Pro Max viewport (430×932, DPR 3) is the Telegram-WebView reference device. Top + bottom screenshots when overflow (line 258-265) handles long stats screens.

## ADR-conformance

- **ADR-006 (Google Sheets для курсов):** ✓ — `cloud/worker/src/rates.ts` фетчит CSV из `env.GOOGLE_RATES_LATEST_CSV`; `local/scripts/setup_rates_sheet.py` использует GOOGLEFINANCE формулы (EURUSD/EURRUB/EURRSD/EURUSDT с IFERROR); `local/scripts/backfill_rates.py` использует тот же Sheet, лист `history`. Никаких сторонних API, никакого скрейпинга.
- **ADR-011 (D1-centric):** ✓ — все курсы в D1, никакой локальной SQLite-копии в `local/scripts/`. Mini App читает из `/v1/bootstrap`, edit-flow не задействован.
- **ADR-005 (idempotency):** ✓ для rates через PK `(date, base, quote)` + `INSERT OR REPLACE`. Композитный natural key вместо UUID — корректное отклонение для time-series data (UUID не дал бы идемпотентности).
- **ADR-009 (silent bot):** N/A для Stage 3 — изменений в bot.ts не делалось, авторизация по `isAuthorizedUser` остаётся.
- **ADR-012 (Web Admin / OAuth):** N/A для Stage 3 — все новые endpoints под `/v1/admin/*` Bearer SYNC_TOKEN, `/v1/web/*` JWT не затронут.

## Security findings

- **Auth coverage:** Все mutating endpoints защищены. `/v1/admin/refresh-rates` и `/v1/admin/bulk-rates` — `checkBearer(env.SYNC_TOKEN)`. `/v1/rates` — Mini App initData. Cron `scheduled` запускается Cloudflare, без HTTP-входа. Никаких public-write путей.
- **No secrets in repo:** `env.GOOGLE_RATES_LATEST_CSV` — публичный URL (Sheet расшарен «anyone with link» — ADR-006). `SYNC_TOKEN` — из wrangler secret. GCP service account key — в `~/.config/finances-gsheets/key.json`, не в repo (см. `_common.py:21`). `.gitignore`-чек: подтверждаю по структуре.
- **Input validation:** В `parseLatestCsv` — проверка header, `isFinite && > 0` на числе. В `saveRates` — повторная защита. В `bulk-rates` — пропущена (см. nice-to-have выше). В backfill Python — `try/except` на каждой ячейке.
- **PII в логах:** Чисто. `console.log` пишет только count + date (`scheduled rates: saved ${n} for date ${date}`). Никаких финансовых сумм через rates-pipeline.
- **CORS:** Стандартный fallback на `*` для всех роутов (см. nice-to-have CORS). Для bulk-rates / refresh-rates — auth-gated Bearer, body не содержит чувствительной инфы — функционально OK.

## Technical debt notes

- `cloud/worker/src/rates.ts:88-99` `getRateAt` — экспортируется до использования (Stage 5 будет его caller). Acceptable, но если Stage 5 пойдёт другим путём, удалить.
- `cloud/worker/src/index.ts:85,171-176` `GET /v1/rates` — endpoint существует, но Mini App не использует. Решить: doc as debug или удалить.
- `local/scripts/setup_rates_sheet.py:25-35` `load_env` + `os.environ.get` рассогласован — bug в bootstrap-сценарии (запускается один раз, но при regression возможен).
- `cloud/worker/migrations/0005_rates.sql:1-3,10` — комментарий ссылается на pre-pivot источник «open.er-api». Косметика, но мисляйднинг для будущих review.
- `cloud/miniapp/public/app.js:923-936` `aggregateForPeriod` — O(N) на render, два прохода за один renderStats. OK на 1.8k, проверить на 10k.
- `cloud/miniapp/public/app.js:31` vs line 861 `isoDate(d)` — UTC vs local-time несогласованность для пограничных таймзон.
- `cloud/worker/src/index.ts:271-285` `handleBulkRates` — нет server-side validation и нет cap на размер массива.
