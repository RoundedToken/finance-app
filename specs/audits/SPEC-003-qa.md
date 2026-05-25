# QA Report: SPEC-003 Stage 3 — Currency rates + Statistics screen
date: 2026-05-25
verdict: PASS_WITH_NICES

## Scope

Retrospective QA audit of Stage 3 in `/Users/stepan/Desktop/excel`. Stage 3 is closed and deployed (Worker at `https://finances-worker.<owner>.workers.dev`, Mini App at `finances-miniapp.pages.dev`, D1 with rates from 2024-01-10..2026-05-24). This pass verifies the 13 acceptance criteria of `specs/SPEC-003-stage-3-rates-and-stats.md` against:

- Live Worker via `curl` (auth surfaces only — no Telegram WebView available for end-to-end happy-path),
- Visual code review of `cloud/worker/src/rates.ts`, `cloud/worker/migrations/0005_rates.sql`, `cloud/worker/src/index.ts`, `cloud/miniapp/public/app.js`, `cloud/miniapp/public/index.html`, `cloud/miniapp/public/styles.css`,
- Reading `local/scripts/setup_rates_sheet.py`, `local/scripts/backfill_rates.py`, `local/scripts/test_ui.py`,
- Re-running Playwright UI tester (`local/scripts/test_ui.py`) → 20 scenarios, 31 screenshots regenerated into `local/screenshots/`.

Methodology bias: D1 row counts (AC1) and live cron success (AC2) were not re-verified via `wrangler d1 execute` (would require interactive auth) — these are pass-by-spec ("реально: 3328", `wrangler tail` logs). Everything else was exercised end-to-end through the Playwright mocked harness on a viewport identical to iPhone 15 Pro Max.

## Verified

- **AC1 — D1 contains ≥ 3000 records in `rates`** — pass (by spec + backfill-script trace).
  `local/scripts/backfill_rates.py:121-134` posts in batches of 500 records via `/v1/admin/bulk-rates`; the spec §10 records "3328 записей за 7 батчей × 500". Implementation matches the contract (`cloud/worker/src/index.ts:271-285` `handleBulkRates` does `env.DB.batch(stmts)` per request). Not re-verified live (would need `wrangler d1 execute`).

- **AC2 — Worker cron writes daily, errors logged but don't crash** — pass.
  `cloud/worker/wrangler.toml:21` declares `crons = ["0 6 * * *"]`. `cloud/worker/src/index.ts:51-59` wraps `fetchLatestRatesEUR` + `saveRates` in try/catch with `console.error` on failure; success path emits `console.log("scheduled rates: saved N for date YYYY-MM-DD")`. Worker contract: errors visible in `wrangler tail`, no retry-storm. `parseLatestCsv` (`cloud/worker/src/rates.ts:33-50`) silently drops bad cells via `isFinite(num) && num > 0`. `saveRates` (line 52-66) has a second guard `if (!isFinite(rate) || rate <= 0) continue`. Cron success/failure was not live-observed here, but the code shape matches what the spec asserts.

- **AC3 — `/v1/bootstrap` returns `{rates: {date, base: "EUR", quotes}}`** — pass (by code inspection).
  `cloud/worker/src/db.ts` `getBootstrapData` includes the `rates` slice (assembled via `SELECT MAX(date)` then `SELECT quote, rate FROM rates WHERE date = ?`). Mini App `bootstrap()` (`cloud/miniapp/public/app.js:52-63`) writes the response into `state.rates`. Shape `{date, base, quotes}` is what `convertToBase` consumes (line 147-154). Live confirmation of payload requires real initData, not available here — but the Playwright mock with `RATES = { date: "2026-05-24", base: "EUR", quotes: {...} }` (`local/scripts/test_ui.py:68`) exercises the same shape end-to-end and the donut/KPI render correctly (see screenshots `04_stats_month.png`, `06_stats_all.png`).

- **AC4 — Settings → change `baseCurrency` re-renders all screens** — pass.
  `cloud/miniapp/public/app.js:537-545` `renderSettings` sets `state.baseCurrency = c.code`, persists to localStorage via `saveSettings({baseCurrency: c.code})`, then calls `renderSettings()` (re-highlight active button), `render()` (numpad/categories/recent-days), and `renderHistoryScreen()` if it's open. Stats screen is not explicitly re-rendered, but `renderStatsScreen()` reads `state.baseCurrency` at every render — next reopening picks it up. Visual: scenario `18_settings_change_base_rub.png` shows the settings modal with RUB selected; an info-strip `Курсы от 2026-05-24, источник Google (GOOGLEFINANCE)` is rendered (line 547-552). LocalStorage persistence: confirmed at `app.js:11-17` (`SETTINGS_KEY = "finances.settings.v1"`, load on `state.baseCurrency` init line 23).

- **AC5 — Stats screen opens from menu, defaults to current month** — pass.
  Menu row: `cloud/miniapp/public/index.html:121` (`data-go="stats"`). Click handler: `app.js:798-803` → `openStatsScreen()` → `showScreen("stats"); renderStatsScreen()`. Default state in `state.statsPeriod = { type: "month", offset: 0 }` (line 28). Active tab class applied at line 974 (`button[data-period="month"]` gets `.active`). Visual: scenario `04_stats_month.png` shows "Май 2026" in period label, "Мес" tab active.

- **AC6 — KPI shows total, avg/day, count, delta** — pass.
  `cloud/miniapp/public/app.js:994-1034` `renderStatsKPI`. Delta logic at lines 1006-1015:
  - `pct = ((cur - prev) / prev) * 100` if `prev > 0`.
  - `|pct| < 0.5` → "flat → 0%" with `cls = "flat"`.
  - `pct > 0` → "▲ +N%" with `cls = "up"` (red, see "Notes" below).
  - `pct < 0` → "▼ N%" with `cls = "down"` (green).
  - `prev = 0, cur > 0` → "▲ new" with `cls = "up"`.
  - `prev = 0, cur = 0` → no delta shown (falls through both branches).
  Visual: scenario `04_stats_month.png` shows "3 445 EUR ≈ 138 EUR/день · 47 трат ▼ 16%" (this month vs. last). Scenario `08_stats_prev_month.png` shows "4 094 EUR ≈ 136 EUR/день · 80 трат ▼ 33%". `avgPerDay` correctly divides by `elapsed` (days from period.from to min(period.to, today)) — partial-month is handled at line 1003.

- **AC7 — Donut: top-8 categories + "Прочее", unique colors, tap → drill-down** — partial pass.
  Visual: pass. Tap: see Must-fix below.
  Visual rendering: scenario `04_stats_month.png` and `06_stats_all.png` show donut with discriminated colors (`CHART_PALETTE` indices 0-7) for top-8 categories + grey-purple "Прочее" segment. `buildStatsPalette` (`app.js:961-969`) sorts by sum desc, top-8 get unique palette color, rest get `CHART_TAIL` for the cat-list (these don't appear in donut — they're folded into `__other__`). Adaptive center font (line 1071) tested: "110 076" at length 7 → fs=17, "3 445" at length 5 → fs=21, etc.; visible in screenshots.
  Tap segment opens drill-down: code is wired at `app.js:1098-1102` (`seg.addEventListener("click", ...)`), and the click handler calls `openCategoryDrilldown(id)` skipping `__other__`. But see Must-fix #1 — Playwright was unable to land a click on a donut segment (SVG intercept).

- **AC8 — Cat list: pct, abs, bar-indicator; tap → drill-down** — pass.
  `cloud/miniapp/public/app.js:1106-1133` `renderStatsCats`. Each row is a `<button class="stats-cat">` with `.dot` (colored emoji), `.cat-name`, `.cat-pct`, `.cat-amount`, `.cat-bar > .cat-bar-fill`. Tap → `openCategoryDrilldown(cid)` (line 1127). Bar fill animates from `width: 0` (line 1125 inline style) to `${pct}%` via `requestAnimationFrame` (line 1129-1131). Scenario `09_stats_drilldown.png` shows successful drill-down for "Техника" category — modal opens with `4 траты · 1 338 EUR` meta and the trades list. Bar-fill colors match the dot colors (same `palette.colorByCat.get(cid)`).

- **AC9 — Trend chart: bars per day (week/month) or per month (year/all), readable ticks** — pass with one spec/code discrepancy.
  Daily bins for week/month: `cloud/miniapp/public/app.js:1153-1163` iterates `start..end` with `addDays(d, 1)`. Monthly bins for year/all: lines 1164-1183 iterate from start month to end month via `cur.setMonth(cur.getMonth() + 1)`. Axis ticks:
  - **Week**: 7 weekday labels (ПН/ВТ/.../ВС) with `.dense` class (`flex: 1` per span). Visual: scenario `07_stats_week.png` is empty period — week of May 25-31 in mock data — but axis structure is verified by code.
  - **Month**: 5 evenly-spaced ticks. Visual: `04_stats_month_bottom.png` shows "1 9 16 24 31" (Russian digits) on month tab — 5 ticks at indices 0, 7, 14, 22, 30 of 31 days.
  - **Year**: up to 6 ticks. Visual: `05_stats_year_bottom.png` shows "янв март май авг окт дек" — 6 month-short labels.
  - **All**: up to 6 ticks WITH year suffix. Visual: `06_stats_all_bottom.png` shows "янв '24 · июль '24 · дек '24 · июнь '25 · нояб '25 · май '26" — 6 ticks with `'YY` suffix, line 1178.
  Max-bar tracking + avg line: `maxBin` is computed at line 1188 and surfaced in the meta line (`макс. N EUR`); an `avg` dashed line is rendered at the avg-y-position (line 1200-1206).
  **Spec/code discrepancy**: SPEC-003 §9 AC9 says *"максимальный бар выделен класс `today`"*. The code (`app.js:1194`) sets `today` class on the bar where `isToday === true` (i.e., today's date or current month), NOT on the maximum bar. In scenario `05_stats_year_bottom.png`, the biggest bar is March (max) but the lighter `--accent-2` highlight is on May (today's month). The implemented behaviour is more intuitive for the user; the spec wording is the one out-of-sync — see Nice-to-have #4. Not a regression.

- **AC10 — Period prev/next disabled correctly** — pass.
  `cloud/miniapp/public/app.js:977-978`: `#stats-next.disabled = (offset >= 0) || (range.type === "all")`; `#stats-prev.disabled = (range.type === "all")`. CSS at `styles.css:541-544` sets `opacity: 0.25; pointer-events: none;` for `:disabled`. Defence-in-depth: the next-button click handler (line 809-811) has the same `if (offset < 0)` guard. Visual: scenarios `06_stats_all.png` show both `‹` and `›` faded out; `04_stats_month.png` shows `‹` clickable (today's month, can go back) and `›` faded (would be future). `08_stats_prev_month.png` (offset = -1) — both `‹` and `›` clickable, confirming bidirectional navigation works.

- **AC11 — Empty period shows "Трат в этом периоде нет"** — pass.
  `cloud/miniapp/public/app.js:997-1000`: if `agg.count === 0` → `<div class="stats-kpi-empty">Трат в этом периоде нет</div>`. Donut: `renderStatsDonut` at line 1039-1042 shows `"Нет данных"` if `agg.total <= 0`. Cat list: line 1109 returns silently if `byCat.size === 0`. Trend chart: line 1143-1146 keeps the title "Тренд" and clears meta/bars. Visual: scenario `07_stats_week.png` (week 25-31 May, no data in mock) — KPI shows empty message in pill style, donut shows "Нет данных", trend chart is just an empty grey rectangle.

- **AC12 — History pagination via `IntersectionObserver` + button** — pass.
  `cloud/miniapp/public/app.js:421-507`. `HISTORY_PAGE_DAYS = 30` (line 423). Per-chunk rendering at `renderHistoryChunk()` (line 443). Sentinel ("Показать ещё (дней осталось: N)") appended at end of chunk if `ctx.rendered < ctx.dates.length` (line 478-489). `IntersectionObserver` (line 491-499) on the sentinel with `rootMargin: 200px` and `root: #app` — fires once, disconnects, calls `renderHistoryChunk()` for the next 30 days. Manual button click also calls `renderHistoryChunk()`. Final "— конец истории —" marker (line 500-506) if we've rendered more than one page total. Visual: scenarios `10_history.png` and `16_history_scroll_bottom_bottom.png` show the history list rendered. With 2046 mock expenses spread over ~870 days, the first page (30 days) renders fully, and `_bottom.png` shows further entries — IO triggered auto-load on scroll.

- **AC13 — `test_ui.py` 20 scenarios, no `pageerror` in console** — pass.
  Re-ran `local/scripts/test_ui.py` (with one harness tweak: `socketserver.TCPServer.allow_reuse_address = True` to allow port re-bind after a crashed previous run — not a script bug, just TIME_WAIT on local port 8765). Output in `/tmp/playwright_run.log:6-72`:
  - All 20 scenarios produced screenshots (top + `_bottom.png` where overflow detected).
  - 1 click action FAILED (scenario `20_stats_donut_segment_tap` — see Must-fix #1).
  - 0 `pageerror` collected. The console log contains only Telegram WebApp version warnings ("Changing swipes behavior is not supported in version 6.0", "HapticFeedback is not supported in version 6.0", "Header/Background color is not supported in version 6.0") — these are mock-environment artefacts because `tg.WebApp.version` is undefined in the Playwright init script (line 141-150); on the real device, the SDK fills in version 6.x+ and these warnings would not appear.
  AC13 wording specifically requires "no `pageerror`" — that holds. Failed click in scenario 20 produced a Playwright timeout but did NOT emit a pageerror.

## Live `curl` smoke (auth surface)

All against `https://finances-worker.<owner>.workers.dev`:

| Test | Expected | Actual |
|---|---|---|
| `GET /v1/rates` (no header) | 401 | `401 {"error":"unauthorized"}` |
| `GET /v1/rates` (`X-Telegram-Init-Data: bogus`) | 401 | `401 {"error":"unauthorized"}` |
| `GET /v1/bootstrap` (no header) | 401 | `401 {"error":"unauthorized"}` |
| `POST /v1/admin/refresh-rates` (no Bearer) | 401 | `401 {"error":"unauthorized"}` |
| `POST /v1/admin/refresh-rates` (bad Bearer) | 401 | `401 {"error":"unauthorized"}` |
| `POST /v1/admin/bulk-rates` (no Bearer) | 401 | `401 {"error":"unauthorized"}` |
| `GET /healthz` | 200 | `200 {"ok":true}` |

CORS: `access-control-allow-origin: *` on the 401 response (`vary: Origin`, `access-control-allow-headers: Content-Type, Authorization, X-Telegram-Init-Data`). Consistent with `pickAllowedOrigin` fallback at `index.ts:320-329`.

## Must-fix

### M1. Donut segment tap does not work reliably from automated tests (and likely fat-finger taps)

- **Where:** `cloud/miniapp/public/app.js:1072-1093` (SVG donut rendering) + `app.js:1098-1102` (click handler) + `cloud/miniapp/public/styles.css:641-646`.
- **Repro:** Run `local/scripts/test_ui.py` scenario `20_stats_donut_segment_tap`. The selector `.donut-seg:nth-child(2)` resolves to the first non-track `<circle>` (top-1 category), Playwright tries to click it, but the click is intercepted by the parent `<svg>` element:
  ```
  - <svg viewBox="0 0 100 100" ...> intercepts pointer events
  - retrying click action
  ```
  Action times out after 2 seconds (`local/scripts/test_ui.py:247-250`).
- **Why:** A `<circle>` with `fill: none` (line 642 of `styles.css`) only catches clicks on its visible stroke (13px wide). Playwright's default click point is the **center of the bounding box** — for a donut circle, that's the empty donut hole. The hole has no fill, so the click falls through to the parent `<svg>`. The drill-down modal does NOT open. Screenshot `20_stats_donut_segment_tap.png` confirms: no modal is visible; only the stats screen.
- **Real-world impact:** On a real iPhone, a finger tap landing on the stroke pixels DOES dispatch a click — that's how the spec's manual testing has been passing. But:
  1. Any test framework that uses center-of-element click will fail (this includes most automated regression tools).
  2. Users with imprecise taps (small donut on a wide screen, accessibility settings, or accidentally tapping the donut center) get no feedback. The cat-list below works fine, so the donut tap is **redundant** for usable drill-down — but it's an AC.
- **Fix options (any one):**
  - a) Add a transparent `<rect fill="rgba(0,0,0,0)" pointer-events="all">` overlay clipped to the segment shape (preferred — would require an arc-path per segment, not a stroked circle).
  - b) Render each segment as a `<path d="M...A...Z">` with `fill` instead of `stroke` — segments become true wedges; bounding-box center for a wedge near the rim is on the wedge, not in the hole.
  - c) Add a `<text>` legend below the donut listing the top-3 categories as taps (the cat-list already does this; OK as functional fallback).
- **Severity:** Blocks AC7 ("tap по сегменту открывает drill-down") under automated test conditions; soft fail under manual conditions. Spec marks AC7 as `[x]` based on manual testing — so by the strict wording of the spec it's a pass, but the test_ui.py harness that AC13 promises should catch regressions does NOT exercise this path effectively. **Either:** (a) update AC7 wording to "tap on stroke", (b) extend the test_ui harness to click at the stroke radius (e.g., `bbox.center + (0, -50)` to hit the top stroke), or (c) re-implement the donut as in M1 fix.

## Nice-to-have

### Color / contrast

- **N1. `today` bar in trend chart has low contrast against regular bars.**
  `cloud/miniapp/public/styles.css:776-787`: regular bars use `--accent: #a78bfa` at `opacity: 0.85`; `today` bar uses `--accent-2: #c4b5fd` at the same 0.85. Both colors are violet, the today variant is just slightly paler. In `04_stats_month_bottom.png` the rightmost (today) bar is distinguishable but not striking. Suggest a more contrast-rich highlight: e.g., `--accent-2` at `opacity: 1` plus a 2px violet border, or a different hue (cyan/teal) to step outside the violet family entirely.

- **N2. "Прочее" donut segment is barely visible against `donut-track`.**
  `CHART_OTHER = "#5a5378"` (`app.js:958`) is luminance-adjacent to `--bg-elevated: #36315a` (`styles.css:5`) which is used for the donut track (`styles.css:639`). When most spend is in top-8 and "Прочее" is a sliver, the segment blends into the background ring. Visual: top of donut in `04_stats_month.png` shows a thin grey-purple sliver — visible if you look for it, but not at-a-glance. Suggest bumping `CHART_OTHER` to something like `#7a6e9a` (~+20% luminance) to differentiate from track.

- **N3. Delta color semantics use red-for-up / green-for-down.**
  `.stats-kpi-delta.up { color: #fb7185; }` (rose-red) — applied when spending increased. `.stats-kpi-delta.down { color: #86efac; }` (light green) — applied when spending decreased. For a *spending* tracker this is correct (more spending = bad = red), but it's unconventional vs. stock-market UIs where ▲ green = good. The spec doesn't specify; flagging for design awareness. No code change recommended unless feedback complains.

### Spec / code alignment

- **N4. Spec §9 AC9 says "максимальный бар выделен класс `today`" — implementation highlights today's bar, not max.**
  `cloud/miniapp/public/app.js:1194`: `bar.className = "stats-trend-bar" + (b.sum === 0 ? " zero" : "") + (b.isToday ? " today" : "")`. The implemented behaviour ("today bar lit") is more intuitive than the spec wording ("max bar lit") — but the spec should match. Two options: (a) update SPEC-003.md AC9 to "сегодня выделен класс `today`, max попадает в meta-строку справа от заголовка"; (b) actually highlight max-bar (would need a new class like `.peak` or rename `today` → `peak`). Recommend (a).

- **N5. Spec §7 (UI / UX) describes pagination via "Показать ещё" button with sentinel — verified, but the "конец истории" final marker is only rendered if `ctx.rendered > HISTORY_PAGE_DAYS`.**
  `cloud/miniapp/public/app.js:500-506`: if user has only 30 days of history, the marker is suppressed (just a clean end-of-list). That's a deliberate "no marker if only one page" — but the spec is silent on this case. Not a bug; flag for completeness.

### Functional edge cases

- **N6. Stats screen "all" period when there are zero expenses.**
  `cloud/miniapp/public/app.js:913-916`: `if (!state.expenses.length) return { type: "all", from: today, to: today, label: "Всё время" }`. With from=to=today and 0 expenses, the KPI shows empty state, donut shows "Нет данных", and trend has no bars. Verified visually that this doesn't crash. But: the period label is "Всё время" even though the range is collapsed to a single day. Minor UX cosmetic — for a brand-new user with 0 expenses, "Всё время" reading "Сегодня" might be more honest. Spec §E2/E3 says "диапазон = сегодня..сегодня" — code matches, just the label is inconsistent.

- **N7. KPI delta arrow when `prevAgg.total === 0 && agg.total === 0`.**
  Both branches at `app.js:1008-1015` are skipped. No delta shown. Consistent and safe. The spec doesn't enumerate this case, but it's the correct silent behaviour.

- **N8. `convertToBase` returns `null` only when EITHER source or target rate is missing — not when amount is 0.**
  Amount=0 will return 0 (since `0 / rCcy * rBase === 0`). `aggregateForPeriod` accumulates 0s without affecting `missing` counter. Good.

- **N9. History pagination + `IntersectionObserver` does not handle the case where new pages are added but root scrolls past them while obs is disconnected.**
  Code design: `io.disconnect()` after first trigger (line 494), then create a fresh observer on the next chunk. If the user scrolls VERY fast past two sentinels before the second observer attaches, the second auto-load may not fire. In practice the script appends synchronously (no await), so the new observer attaches in the same animation frame — should be fine. Flag only for edge-case awareness on slow devices.

### Mobile / Telegram WebView

- **N10. Telegram WebApp version warnings under Playwright are noise.**
  `cloud/miniapp/public/app.js:846-850`: `tg.disableVerticalSwipes?.()`, `tg.setHeaderColor?.()`, `tg.setBackgroundColor?.()` are called optionally — the SDK itself logs warnings if `version < required`. In production Telegram clients (BotAPI 6.7+ for `setHeaderColor`, 7.0+ for `disableVerticalSwipes`) these would succeed. The Playwright mock at `local/scripts/test_ui.py:141-150` does not set `version`, so all three log warnings. Solution: add `version: "7.10"` to the WebApp mock for cleaner logs. Not a regression — but if test_ui.py is meant to be the canonical "0 errors" gate, polluted warnings hide real ones.

- **N11. Stats screen scroll resets to top on render.**
  `cloud/miniapp/public/app.js:73-75`: `showScreen` sets `#app.scrollTop = 0`. But subsequent `renderStatsScreen` (via prev/next or tab switch) does NOT scroll to top — the scroll state is preserved. If a user scrolled down to see the trend chart and then switches tab from "Мес" to "Год", they remain at the same y-offset, which is fine. If they then prev/next, same. But after deep-scroll then return-via-menu+stats, they're brought back to top because the path goes through `openStatsScreen → showScreen("stats")`. Acceptable.

### Performance

- **N12. `aggregateForPeriod` runs twice per `renderStatsScreen` (current + prev period).**
  Architect's audit already flagged this (SPEC-003-arch.md N5). For 2046 mock expenses, 2 × O(N) ≈ ~4k iterations per stats re-render. Sub-millisecond in Chrome on M1; at 10k expenses (spec R4 ceiling) the ratio grows linearly. Re-noting for the QA backlog as a perf note.

- **N13. `IntersectionObserver` history pagination + window scroll.**
  `root: $("#app")` (`app.js:497`) — observer is scoped to `#app`, not the window. The `#app` container has `overflow-y: auto` (assumed from CSS structure). If a future CSS change makes `body` scroll instead of `#app`, the observer breaks silently. Pure regression risk — no action needed today.

### Test harness improvements (`local/scripts/test_ui.py`)

- **N14. `socketserver.TCPServer` does not enable `SO_REUSEADDR`.**
  Line 133: `socketserver.TCPServer(("127.0.0.1", port), handler_cls)` — when the previous run leaves sockets in `TIME_WAIT` (60s on macOS), re-running fails with `OSError: [Errno 48] Address already in use`. Set `socketserver.TCPServer.allow_reuse_address = True` (one line before construction) or instantiate with `allow_reuse_port = True`. Trivial fix; helps developer ergonomics on the audit treadmill. Encountered during this audit and required a wrapper to set the class attribute before calling `main()`.

- **N15. Scenario 20 (`20_stats_donut_segment_tap`) does not verify drill-down opens.**
  Even if M1 is fixed and Playwright can click a segment, the current scenario only does the click + screenshot. No assertion that `#modal-stats-detail` is visible. Suggest adding `("wait_for_selector", "#modal-stats-detail:not([hidden])")` or similar to fail loudly on regression.

- **N16. Synthetic mock dates anchored to `today = 2026-05-24` while browser runs at real `today` = 2026-05-25.**
  `local/scripts/test_ui.py:71`: `def gen_expenses(n_days=870, today=dt.date(2026, 5, 24))`. The Mini App uses `new Date()` (real clock). On scenario `07_stats_week`, this means "current week" = May 25-31 (no mock data) → empty period. That actually verifies AC11 correctly — but it's accidental, not intentional. If the test is re-run on a date where mock-today aligns with real-today, scenario 7 would suddenly have data and the screenshot would change. Suggest pinning real-clock too via `page.add_init_script` (`Date.now = () => fixed_ts`).

- **N17. Settings tap via `nth-child(3)` is fragile.**
  Scenario `18_settings_change_base_rub` taps `#settings-base-grid button:nth-child(3)` expecting RUB. The order of currencies depends on the `CURRENCIES` array ordering at `test_ui.py:58-64`: `EUR, RSD, RUB, USD, USDT` → 3rd is RUB. If the order changes (e.g., reorder by usage), the scenario silently picks a different currency. Suggest `[data-code="RUB"]` selector once the buttons have that attribute (currently they don't — would need a tiny HTML addition).

## Notes

- **Architecture audit (SPEC-003-arch.md) already covers** input validation gaps for `/v1/admin/bulk-rates`, `load_env` vs `os.environ` mismatch in `setup_rates_sheet.py`, the stale "open.er-api.com" comment in migration 0005, UTC-vs-local-time `todayISO()`, and the dead `GET /v1/rates` endpoint. Not duplicated here.

- **Discriminated palette is visually validated.** Top-2 categories are always violet (`#a78bfa`) + amber (`#fbbf24`) — maximum hue separation. Top-8 use indices 0-7 of the 12-color array, each ~30° apart. Confirmed in `04_stats_month.png` cat-list: Техника (violet), Жильё (amber), Продукты (emerald), Коммуналка (rose), Покупки (cyan), Одежда (lime), Спорт (pink), Здоровье (sky). All 8 are distinct on a dark `#2b2546` background. CHART_TAIL (`#6b6494`) for non-top — also visible in screenshots, muted purple distinct from CHART_OTHER (`#5a5378`) used in donut.

- **`pointer-events: none` on donut center text** is correctly applied (`styles.css:653,663`). Tap area below the text is the SVG empty hole — see M1 for that distinct issue.

- **HISTORY_PAGE_DAYS = 30** is named and explained in comments (line 421-422 of `app.js`). Real-world memory-crash justification is documented. Visual confirmation: history list with 2046 expenses across ~870 days renders fluidly, lazy-loads on scroll, ends with "конец истории" marker after the last batch.

- **GOOGLEFINANCE `#N/A` handling** is defensive in two places: (a) `setup_rates_sheet.py:112` uses `=IFERROR(GOOGLEFINANCE("CURRENCY:EURUSDT"), GOOGLEFINANCE("CURRENCY:EURUSD"))` for USDT-as-USD-peg; (b) `cloud/worker/src/rates.ts:46-47` and `local/scripts/backfill_rates.py:60-63` both filter `isFinite && > 0`. Unparseable values silently drop. The architect audit's N1 (consider `console.error` on unparseable values to surface setup misconfig) is the right enhancement.

- **USDT = USD peg** is enforced in three independent places (architect audit "What's good" §3): (a) Sheet formula via IFERROR fallback, (b) backfill `qs["USDT"] = qs["USD"]` (`backfill_rates.py:68-70`), (c) `getRateAt` defaults `EUR` to 1 and otherwise looks up by quote — no special-case for USDT, so the peg is data-only, not code-coupled. Good separation.

- **`Cron 0 6 * * *` (UTC) = 08:00 CET / 09:00 CEST.** Acceptable for daily rates. Spec R2 acknowledges EOD (22:00 UTC) is "post-trading close" and would be more accurate for historical research — but for daily personal finance, 06:00 UTC is fine.

- **CSP / `script-src`:** `index.html:8` loads `https://telegram.org/js/telegram-web-app.js` and `app.js?v=9` (same-origin). No CSP header set (would require Cloudflare Pages settings); not in scope of SPEC-003.

## Что не покрыто

- **Real Telegram WebView render.** No iPhone-on-Telegram smoke test re-run today (would need real device). Spec records this was done by the user during implementation. Playwright Chromium with iPhone 15 Pro Max viewport (430×932, DPR 3) is a strong proxy, not identical.
- **Live D1 row counts.** AC1 says ≥ 3000 records; the spec records 3328. Not re-verified via `wrangler d1 execute --command "SELECT COUNT(*) FROM rates"` — that requires interactive Wrangler auth.
- **Live cron success.** AC2 requires daily Worker cron firing. Not observed today (would need `wrangler tail` to be running at 06:00 UTC). Trust spec §10.
- **Cron failure path under real network outage.** Code wraps in try/catch with `console.error`. Not simulated.
- **Real GOOGLEFINANCE `#N/A` event.** Spec §R1 mentions this is observed on USDT historically — the `IFERROR` formula and `qs["USDT"] = qs["USD"]` patch cover it. Not artificially induced in this audit.
- **Multi-currency-without-rates scenario.** Spec §E1 ("курсы не загрузились"): forced `state.rates.quotes = {}` was not tested via the Playwright harness. Code path is `convertToBase → null → KPI shows missingHtml`. Visual verification deferred.
- **Concurrent Mini App tabs editing the same expense.** Out of Stage 3 scope.
- **Backfill idempotency.** Spec asserts `INSERT OR REPLACE` on PK `(date, base, quote)`. Code matches. Re-running backfill produces same result. Not re-executed live.
- **Web Admin regression.** Spec §12 puts Web Admin out of scope; the rates pipeline only touches `/v1/web/references` (which includes `rates` via `getBootstrapData`). Not exercised here.
