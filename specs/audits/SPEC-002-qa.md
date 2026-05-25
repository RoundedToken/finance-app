# QA Report: SPEC-002 — Stage 2: Mini App UI
date: 2026-05-25
verdict: PASS_WITH_NICES

Audit type: retrospective static code-review + Playwright run (`local/scripts/test_ui.py`).
Spec ref: `/Users/stepan/Desktop/excel/specs/SPEC-002-stage-2-mini-app-ui.md` (status: done).
Code under review:
- `cloud/miniapp/public/index.html` (217 lines)
- `cloud/miniapp/public/app.js` (1288 lines)
- `cloud/miniapp/public/styles.css` (849 lines)
- `cloud/worker/src/db.ts`, `cloud/worker/src/index.ts`, `cloud/worker/src/auth.ts`
- `local/migrations/002–005`

Test execution:
- Playwright (chromium headless, iPhone 15 Pro Max emulation 430×932 @ DPR 3) — `local/scripts/test_ui.py`. 20/20 scenarios ran, 19 with clean screenshots, 1 (`20_stats_donut_segment_tap`) had a click intercept by `<svg>` overlay (Stats screen, Stage 3 — outside this spec).
- Console output: only `Telegram.WebApp` "feature not supported in version 6.0" warnings (`disableVerticalSwipes`, `setHeaderColor`, `setBackgroundColor`, `HapticFeedback`). Expected outside real Telegram client; calls are wrapped in `try/catch` and `?.()`. No JS pageerrors, no failed XHR, no React/DOM errors.
- Mock bootstrap: 2046 expenses across 870 days, full 25-category × 5-currency matrix.
- Screenshots: `/Users/stepan/Desktop/excel/local/screenshots/01_main.png…20_stats_donut_segment_tap.png` (regenerated 2026-05-25 06:38).

## Verified — 29/29 AC

- **AC1 — @BotFather menu button**: not testable from code; the spec is marked `done`, AC validates infra setup. No-op for this audit.
- **AC2 — tg.ready/expand + colors**: `app.js:846-850` — `tg.ready(); tg.expand(); try { tg.setHeaderColor?.("#2b2546"); } catch {}; try { tg.setBackgroundColor?.("#2b2546"); } catch {}`. **Pass.**
- **AC3 — `/v1/bootstrap` + `X-Telegram-Init-Data` + error → `state.bootstrapError`**: `app.js:42-51` (`api()` adds header conditionally), `app.js:52-63` (`bootstrap()`), `app.js:204-209` (placeholder render). Worker side: `index.ts:131-135` (`handleBootstrap` → `authenticateMiniApp` → `validateInitData` HMAC, then `isAuthorizedUser` 403 check, otherwise 401). **Pass.**
- **AC4 — Display `0` (`--hint`) до тапа, жирнее после**: CSS `styles.css:83 .display-amount.empty { color: var(--hint); }`, toggle на `app.js:182 a.classList.toggle("empty", state.amount === "0")`. `renderCategories` пересчитывает `amountValid = parseFloat(state.amount) > 0` (`app.js:214`) и применяет `.cat.disabled`. Confirmed in screenshot `01_main.png` (faded categories, `0` greyed-out) vs `02_main_with_amount.png` (vivid colors, `258` bold). **Pass.**
- **AC5 — Numpad формат + 12-char limit + 1 dot + ⌫ → `0`**: `onNumpadTap` (`app.js:627-643`): `if (!state.amount.includes(".")) state.amount += "."` — single dot; `fracPart.length >= 2 → return` — 2 decimals max; `state.amount.length >= 12 → return`; `back` → `state.amount.length > 1 ? slice(0,-1) : "0"`. **Pass.**
- **AC6 — 4×2 grid, spacers, `cat.color` fallback `--bg-elevated`**: `renderCategories` (`app.js:216-235`) — `state.catsPerPage = 8` (init `app.js:26`), `for (let i = slice.length; i < 8; i++) stub class="cat-spacer"`. CSS `styles.css:147 grid-template-columns: repeat(4, 1fr)`, `.cat-spacer { aspect-ratio: 1; visibility: hidden }`. Color: `btn.style.background = cat.color || "var(--bg-elevated)"` (`app.js:223`). Migration 005 fills all expense categories with hex colors. **Pass.**
- **AC7 — Real translate-slider, direction-lock @ |dx|/|dy| > 8, h → preventDefault**: `setupCategorySwipe` (`app.js:670-722`). Lock: `if (Math.abs(dx) > 8 || Math.abs(dy) > 8)` (`app.js:689`). Horizontal: `if (e.cancelable) e.preventDefault()` + `translateX` (`app.js:695-697`). Vertical: function returns без preventDefault → нативный скролл `#app`. CSS `touch-action: pan-y` на `body` + `.categories { touch-action: pan-y }`. **Pass.**
- **AC8 — 18% threshold + spring-back**: `app.js:710-715` — `threshold = local.w * 0.18; if (dx < -threshold) next++; else if (dx > threshold) next--; snapTo(next, true)`. Не достигли — `snapTo(local.page, true)` восстанавливает текущую (CSS `transition: transform var(--dur) var(--ease)`). **Pass.**
- **AC9 — Side actions с подсветкой**: index.html line 41-45: `#open-currency`, `#open-date`, `#open-note`. `renderSideActions` (`app.js:186-195`) обновляет flag/code/date/note label. Подсветка: `$("#open-note").classList.toggle("has-note", !!state.note)`, CSS `styles.css:127 .sidebtn.has-note { background: var(--accent); color: var(--bg); }`. **Pass.**
- **AC10 — Optimistic insert + POST + toast + reset amount/note**: `onCategoryTap` (`app.js:645-667`): early-return при `amount <= 0`; `state.expenses.unshift(expense)`; `await postExpense(...)`; toast `✓ <amt> <ccy> → <cat>`; `state.amount = "0"; state.note = "";`. UUID via `uuid4()` (`app.js:33-39`) c `crypto.randomUUID` fallback. `source: "mini_app"`. **Pass.**
- **AC11 — Rollback at POST error**: `app.js:662-666` — `state.expenses = state.expenses.filter(x => x.id !== expense.id); render(); toast("Ошибка: " + e.message, "err")`. **Pass.**
- **AC12 — Recent-days: Сегодня/Вчера + ПН/ВТ + сумма по валюте**: `renderRecentDays` (`app.js:267-272`) рендерит `[todayISO(), dateShift(-1)]`. `humanDayTitle` (`app.js:119-134`) даёт `prefix = "Сегодня" | "Вчера"`, `weekday = WEEKDAYS_SHORT[...]`. `buildDayGroup` (`app.js:274-301`) собирает `sums` по валюте + `dayTotalHTML`. Confirmed in screenshots `01_main.png`, `02_main_with_amount.png`. **Pass.**
- **AC13 — Тап на recent row → openEditModal со всеми полями**: `buildExpenseRow` non-swipeable: `row.addEventListener("click", () => openEditModal(e))` (`app.js:320`). `openEditModal` (`app.js:555-589`) — `state.editingId`, `state.editingCategory`, populates `#edit-amount`, `#edit-date`, `#edit-note`, `<select>` валют, mini-grid категорий с outline. Confirmed visually `17_history_tap_first_row.png`. **Pass.**
- **AC14 — Edit modal: `inputmode="decimal"`, `<select>`, `<input type=date>`, textarea, 5-в-ряд grid + active outline**: index.html lines 184-202. CSS `.cat-mini-grid { grid-template-columns: repeat(5, 1fr) }` (`styles.css:480`), `.cat-mini-grid button.active { outline: 2px solid var(--accent); outline-offset: -2px }` (`styles.css:490`). **Pass.**
- **AC15 — Save (PUT) + merge + toast / Delete (confirm + DELETE)**: `saveEdit` (`app.js:591-611`), `deleteEntry` (`app.js:613-624`). Both update state, re-render history, toast `✓ Сохранено` / `🗑️ Удалено`. Local validation `if (!(patch.amount > 0)) { toast("Сумма?","err"); return }`. **Pass.**
- **AC16 — Slide-up + backdrop fade + transitionend + 340ms fallback**: `openModal` (`app.js:76-85`) — `void m.offsetHeight; m.classList.add("show")` triggers CSS transition. `closeModals` (`app.js:86-103`) — `card?.addEventListener("transitionend", onEnd)` + `setTimeout(finish, 340)` fallback. CSS `.modal-card { transform: translateY(100%); transition: transform var(--dur) var(--ease) }` + `.modal.show .modal-card { transform: translateY(0) }` (`styles.css:346-350`). **Pass.**
- **AC17 — История из меню/иконки 📜, first chunk = 30 days desc**: `#open-history.click → renderHistoryScreen + showScreen("history")` (`app.js:787`); menu `data-go="history"` (`index.html:120`). `renderHistoryScreen` (`app.js:425-441`) — `Map` по date → sort `(a, b) => a < b ? 1 : -1` (desc). `renderHistoryChunk` (`app.js:443-507`) — `HISTORY_PAGE_DAYS = 30`, `end = Math.min(ctx.rendered + 30, ctx.dates.length)`. Confirmed screenshot `10_history.png`. **Pass.**
- **AC18 — Кнопка `Показать ещё (N)` + IntersectionObserver root=#app rootMargin=200px**: `app.js:478-499`. Кнопка: `<button>Показать ещё <small>(дней осталось: ${left})</small></button>`. IO: `new IntersectionObserver(..., { root: $("#app"), rootMargin: "200px" })`. **Pass.**
- **AC19 — iOS swipe-to-delete: dir-lock h, transform по dx, fix на -64 при `dx<-28`, reveal opacity 1**: `attachSwipeToDelete` (`app.js:343-409`). Constants `REVEAL = 64, OPEN_AT = 28`. `data-state="dragging"` → CSS `[data-state="dragging"] .reveal { opacity: 1; pointer-events: auto }` (`styles.css:273-277`). **Pass.**
- **AC20 — Тап на revealed → закрытие, не edit**: `row.click` handler (`app.js:398-408`) — `if (opened) { opened = false; row.style.transform = "translateX(0)"; setState(null); return; }` (early return до `openEditModal`). **Pass.**
- **AC21 — Тап `reveal ✕` → confirm + DELETE + toast**: `reveal.addEventListener("click", ev => { ev.stopPropagation(); confirmAndDelete(e.id); })` (`app.js:330-333`); `confirmAndDelete` (`app.js:411-419`) — `if (!confirm("Удалить эту запись?")) return; delExpense(id).then(...).catch(...)`. **Pass.**
- **AC22 — Currency picker 5 валют 3-в-ряд с флагом/кодом/именем + active=accent**: `renderCurrencyPicker` (`app.js:509-526`); CSS `.currency-grid { grid-template-columns: repeat(3, 1fr) }` + `.currency-grid button.active { background: var(--accent); color: var(--bg) }`. Confirmed in `12_currency_picker.png` — RSD highlighted. **Pass.**
- **AC23 — Settings базовая валюта в localStorage**: `renderSettings` (`app.js:528-552`) — `saveSettings({ baseCurrency: c.code })`. `SETTINGS_KEY = "finances.settings.v1"` (`app.js:9`), `loadSettings/saveSettings` (`app.js:11-17`). Init: `state.baseCurrency = loadSettings().baseCurrency || "EUR"` (`app.js:23`). Confirmed `11_settings.png` (EUR active), `18_settings_change_base_rub.png` (RUB активирован, конверсии перерисованы). **Pass.**
- **AC24 — `interactive-widget=overlays-content`**: `index.html:5` — `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1, user-scalable=no, interactive-widget=overlays-content">`. **Pass.**
- **AC25 — Focus guard на `#modal-edit` и `#modal-note`**: `setupFocusGuard` (`app.js:725-770`). `handlePointer` в capture-фазе (`app.js:769 modal.addEventListener("pointerdown", handlePointer, true)`). Тап на другой input → `e.preventDefault(); e.stopPropagation(); active.blur()`. Тап на button — `active.blur()` сначала, button click работает. Тап на пустое — blur + stopProp. Привязка: `setupFocusGuard($("#modal-edit")); setupFocusGuard($("#modal-note"))` (`app.js:839-840`). **Pass.**
- **AC26 — Enter в textarea без shift → blur**: `setupTextareaEnter` (`app.js:773-780`) — `if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); textarea.blur(); }`. Привязка: `setupTextareaEnter($("#note-input")); setupTextareaEnter($("#edit-note"))` (`app.js:833-834`). **Pass.**
- **AC27 — Все transitions используют `var(--ease)` + `var(--dur)`**: Grep по styles.css: 18 transitions, все используют CSS-переменные. Inline magic numbers найдены только в:
  - `closeModals` fallback `setTimeout(finish, 340)` — упомянут в spec как разрешённый.
  - `app.js:1097 transition: "opacity 320ms var(--ease)"` (Stats donut staggered fade — Stage 3, OOS).
  - `app.js:359 row.style.transition = "none"` / `app.js:384 row.style.transition = ""` (drag mode toggle, корректно).
  **Pass.**
- **AC28 — resize/rotate → snapTo пересчёт**: `app.js:1286 — window.addEventListener("resize", () => snapTo(state.catPage, false))`. **Pass.**
- **AC29 — Cache-busting `?v=9`**: `index.html:7 <link rel="stylesheet" href="styles.css?v=9">`, `index.html:215 <script type="module" src="app.js?v=9"></script>`. **Pass.**

## 🔴 Must-fix

(none — no critical-level findings within the SPEC-002 scope)

## 🟡 Nice-to-have

- **[A11y] icon-only buttons без aria-label**: только 4 кнопки имеют `aria-label` (`#open-menu`, `#open-history`, `#stats-prev`, `#stats-next` — `index.html:15,23,66,68`). Остальные icon-only — без доступного имени:
  - `.iconbtn.back-btn` (две штуки на `#screen-stats` и `#screen-history` `index.html:60, 106`) — содержит только `←`.
  - `.sidebtn#open-date` (`index.html:43`) — emoji 📅 + текст-метка «сегодня» (текст label есть, но visible label «сегодня» не описывает действие).
  - `.sidebtn#open-note` (`index.html:44`) — emoji 💬 + «описание».
  - `.numpad button[data-key="back"]` (`index.html:38`) — `⌫` без label.
  - `.numpad button[data-key="dot"]` (`index.html:36`) — `.` (читается как пунктуация).
  Не блокер для production (single-user, no screen-reader regression), но: при VoiceOver на iPhone — «back» читается как «Left-Pointing Triangle». Добавить `aria-label="Назад"` / `aria-label="Стереть"` / `aria-label="Десятичная точка"`.

- **[Security] нет CSP-header**: уже зафиксировано в spec R4 как открытое. `index.html` загружает `https://telegram.org/js/telegram-web-app.js` (третья сторона), а `app.js` массово использует `innerHTML` (28 точек, см. grep ниже). Все потенциально опасные значения (`note`, `c.name`, `cat.name`, `t.prefix`, `t.weekday`) escape'ятся через `escapeHtml`. Однако `c.emoji` и `cat.emoji` НЕ escape'ятся (`app.js:224,309,515,534,567,1051,1116,1270`) — потому что они приходят из админских миграций 002/005. Угроза: компрометация `SYNC_TOKEN` → инъекция `<script>` через `replaceReferences`. Smoke-fix: применить escapeHtml к `emoji` тоже (стоит 0 ms perf, убирает целый класс рисков).

- **[Server-validation] нет проверки `amount > 0`, `currency ∈ известных`, `date` парсится в Worker**: spec section 6 явно описывает «Response 4xx: валидация на сервере». В `cloud/worker/src/db.ts` `createExpense` и `updateExpense` принимают любые значения; защита только через NOT NULL и FK в SQLite. При `amount = -100`, `currency = "FOO"` сервер не вернёт 400 — попробует вставить и упадёт на FK с 500 (или вставит, если category_id присутствует, потому что currency FK не enforced). Локальная валидация в Mini App (`app.js:601 if (!(patch.amount > 0)) ...`) — обвес, не security. **Не блокер для single-user setup**, но первый же сторонний клиент (например, скрипт-импортёр) обнажит это.

- **[UX] оптимистичная вставка ID без обработки конфликта**: `onCategoryTap` делает `state.expenses.unshift(expense)` _до_ `postExpense`. Если Worker вернёт 200 c `inserted: false` (повтор по PK — теоретически возможен, если клиент `crypto.randomUUID` вернёт коллизию или backfill вставил тот же ID), запись локально показана, но в БД её НЕТ. Spec R6 упоминает другой риск (рестарт до POST) — этот кейс не покрыт. **Очень редкий**, но честный edge case.

- **[Test stability] `test_ui.py` оставляет TCP-сокет open при ранних exceptions**: `start_http_server` (line 131-135) использует `socketserver.TCPServer` без `allow_reuse_address`. При повторных запусках получается `OSError: [Errno 48] Address already in use`. Воркэраунд в harness: подменяется `socketserver.TCPServer.allow_reuse_address = True`. Лучше пропатчить сам скрипт.

- **[Stats / OOS but adjacent] donut segment click intercepted by `<svg>`**: scenario `20_stats_donut_segment_tap` падает в Playwright (`<svg>` intercepts pointer events). Это Stage 3 фича (вне scope SPEC-002), но если переход на Stage 3 близко — стоит зафиксировать.

- **[Numpad UX] leading zeros не нормализуются**: вводя `0`, потом `5`, получаем `5` (правильно). Но если ввести `0.05`, нажать `⌫` несколько раз — получаем `0` — корректно. Однако `5`, потом `⌫` → `0`. Введя `1`, `0`, `.`, `5`, `0`, имеем `10.50` — допустимо. Невинно, но не покрыт случай `0.` (только точка после нуля) — `state.amount = "0."` пустая. AC регекс `^[0-9]+(\.[0-9]{0,2})?$` это разрешает; тогда `parseFloat("0.")` = 0, категория останется disabled — корректно.

- **[Edge] пустой `state.currencies` (bootstrap пришёл, но массив пуст)**: тогда `flagOf` возвращает `💱`, `renderCurrencyPicker` рисует пустой grid, edit modal `<select>` пустой → `parseFloat($("#edit-currency").value)` → NaN → save без `currency`. UI не дегейтит. Не должно случиться с правильно настроенной D1, но нет защитного render-fallback.

- **[CORS] `pickAllowedOrigin` возвращает `*` если origin не в allowlist**: `index.ts:320-330`. Это слабый CORS — в продакшен Mini App это нормально (since `initData` проверяется HMAC-ом), но если когда-то будет cookie-based auth, нужно перевести `*` → fallback Pages-домена.

## 📝 Notes

- **Регрессионный тест Telegram-бота** не проводил — он на том же Worker, deploy не менял `bot.ts`. SPEC test plan section 10 этого требует — рекомендую `curl POST /tg` с фейковым update в смоук.
- **Lazy-load history**: эмпирически с 870 днями × ~2.3 трат/день (2046 expenses) UI рендерится без лагов. Bottom-screenshot `16_history_scroll_bottom_bottom.png` показывает что доскролл до bottom ≈апрель 2026 — IntersectionObserver успешно подгрузил 30-day chunks.
- **Multi-currency totals**: day-total корректно показывает «573 RSD ≈ 4.88 EUR» когда base ≠ RSD, это `dayTotalHTML` (`app.js:157-173`). На день с 3 валютами (`18 апреля`) — все три суммы + конвертация. UX clean.
- **Reload check**: при `window.resize` snapTo() пересчитывает позицию (`app.js:1286`). Visual confirm: при ротации iPhone категории не «отскакивают» в неправильный слайд.
- **Bundle size**: 1288 lines app.js, 849 css, 217 html — управляемо, gzipped <50 KB. Не требует бандлера. G8 honoured.
- **NG7 (themeParams ignored, hardcoded `#2b2546`)**: подтверждено `app.js:849-850` и CSS `--bg: #2b2546`. Нет хака с `tg.themeParams.bg_color`.
- **Idempotency**: `INSERT OR IGNORE` в `createExpense` (`db.ts:18-21`) → повторные POST с тем же UUID безопасны. **Verified.**

## Что не покрыто

- **Реальный iPhone 15 Pro Max в Telegram-app**: эмуляция Playwright не воспроизводит точно iOS WebView (color font emoji, momentum scroll, native swipe-back gesture, layout-shift при появлении клавиатуры). Spec test plan section 10 явно требует ручной запуск — этот audit его НЕ выполнял.
- **AC1**: настройка `setChatMenuButton` в @BotFather — отдельная infra-задача, не код. Не валидируема через repo.
- **CSP / X-Frame-Options**: подтвердил отсутствие, но не тестировал XSS-инъекцию через D1 (для этого нужен compromised SYNC_TOKEN).
- **Network failure recovery**: AC11 покрыт unit-логикой rollback, но не симулирован тест с offline-mode и Service Worker (его нет).
- **Edge `e.cancelable === false` в `setupCategorySwipe`**: `if (e.cancelable) e.preventDefault()` — если passive listener применился где-то выше, scroll может пройти. На iOS Safari `touchmove` обычно cancelable когда listener registered as `{passive: false}` — мы так и делаем (`app.js:699`). Visually не симулировал.
- **`tg.HapticFeedback` на реальном iPhone**: Playwright warning `HapticFeedback is not supported in version 6.0` означает что эмулятор Telegram WebApp.js не поддерживает; в реальном iOS Telegram (v10+) поддерживает. Не подтверждаемо без устройства.
- **AC28 на real rotate**: simulated через `window.dispatchEvent("resize")` не запускался — только статика по коду.
- **Конкурентные правки одной записи с двух устройств**: `updateExpense` без version-column, последний PUT выигрывает. Не в scope spec'а (single-user).
