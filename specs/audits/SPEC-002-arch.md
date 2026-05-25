# Architecture Review: SPEC-002 Stage 2 — Mini App UI
date: 2026-05-25
reviewer: solution-architect (retrospective)
verdict: APPROVED_WITH_NICES

## Summary

Vanilla-JS SPA на 1288 строк закрывает скоп SPEC-002 без бандлера, читается как один связный документ, идиомы JS используются правильно (optional chaining, template literals, `Map`/`Set`, `IntersectionObserver`, `requestAnimationFrame`). SPEC-acceptance criteria AC1-AC29 покрыты в коде. Архитектурных нарушений ADR нет; security-поверхность для own-data/own-bot/own-WebView приемлемая. Несколько уже зафиксированных в spec'е tech-debt пунктов (R4 CSP, R6 optimistic-loss) переходят в backlog. Чистый must-fix отсутствует — те находки, что есть, попадают в nice-to-have / tech-debt.

## Must-fix (CHANGES_REQUESTED)

(пусто — нет блокеров для merge)

## Nice-to-have

### Code quality / читабельность

- [code-quality] `cloud/miniapp/public/app.js:904` — **dead code**: `const monthName = capitalize(MONTHS_GEN[ref.getMonth()].replace(/я$/, "ь").replace(/а$/, ""));` объявляется, но не используется (label в 906 строит через `toLocaleString`). Удалить, чтобы не вводить читателя в заблуждение.

- [code-quality] `app.js:255-261` — двойной `requestAnimationFrame` со снятием класса `dragging` без анимации работает, но непрозрачно. Комментарий «без анимации — снимем dragging после кадра» объясняет «что», а не «зачем» (зачем вообще класс `dragging` нужен на безанимационном snapTo? — чтобы временно отключить CSS-transition). Стоит вынести в `applyTransform(track, page, animate)` и объяснить инвариант в шапке функции.

- [code-quality] `app.js:177` + `app.js:415-621` — `render()` (полная перерисовка main) вызывается из 6+ мест после мутаций state. На 1822-х записях это вполне ок (главный экран показывает только 2 дня), но при росте data set'а или появлении новых блоков на main стоит формализовать «куда render идёт» — например, в одну функцию `mutate(fn)` или в простой pub-sub. YAGNI-приемлемо оставить как есть для одного юзера, но фиксируем.

- [DRY] `app.js:509-552` — `renderCurrencyPicker()` и `renderSettings()` отрисовывают почти одинаковый currency-grid (различие — что делает button click). 3 повтора (вторая mini-grid в `openEditModal:572-587` похожа). При появлении третьего currency-picker — извлечь `buildCurrencyGrid(currencies, activeCode, onPick)`. Сейчас два — терпимо, отмечаем как «следующий повтор → рефактор».

- [DRY] `app.js:288-291` vs `app.js:463-466` — `day-head` template повторяется в `buildDayGroup` и `renderHistoryChunk`. Можно извлечь `buildDayHead(iso, totalHtml)`. Тоже 2 повтора — на грани.

- [code-quality] `app.js:111` — `toast._t` хранит timeout id на функции. Работает, но это «прилепленное» свойство; читатель ждёт переменную модуля. Понятнее `let toastTimer = null;` в module-scope.

- [naming] `app.js:69-70` — `$` / `$$` псевдо-jQuery — общепринято в vanilla, но в коде, который претендует на публичность, лучше `qs`/`qsAll`. Не критично.

### Магические числа

- [magic-numbers] `app.js:101` — `setTimeout(finish, 340)` — fallback на `transitionend`. 340ms = `var(--dur)` (280ms) + safety margin. Стоит вынести в `MODAL_TRANSITION_FALLBACK_MS = 340` рядом с `HISTORY_PAGE_DAYS` (или прочитать из CSS-переменной через `getComputedStyle`).

- [magic-numbers] `app.js:711` — `local.w * 0.18` (18% порога переключения страницы) — в spec'е AC8 явно зафиксировано. Достать в `CATEGORY_SWIPE_THRESHOLD = 0.18`.

- [magic-numbers] `app.js:345` — `REVEAL = 64, OPEN_AT = 28` — локальные `const`, что хорошо, но семантика «28 от чего» неочевидна. Лучше `OPEN_AT_PX` / `REVEAL_WIDTH_PX`. То же — `app.js:368` (`>8` direction lock) и `app.js:374` (`>4` moved-flag).

- [magic-numbers] `app.js:737-742` — `setTimeout(..., 50)` в focusout — почему 50ms? Магия. Комментарий стоит. То же — `app.js:790` (`setTimeout(..., 300)` ожидание закрытия меню перед открытием settings) и `app.js:1277` (`setTimeout(..., 320)` после `closeModals`). Все три — workaround на отсутствие promise-based закрытия модалок. Можно `await closeModalsAsync()` через `transitionend`.

- [magic-numbers] `app.js:637` — `state.amount.length >= 12` — длина суммы; явно в spec AC5. Вынести `MAX_AMOUNT_LENGTH = 12`.

- [magic-numbers] `app.js:1071` — `totalFs = ... > 8 ? 13 : > 6 ? 17 : > 4 ? 21 : 24` — адаптивный шрифт. Прочитать как лестницу `[(4,24),(6,21),(8,17),(∞,13)]` массивом сделало бы намерение очевиднее. Это код Stage 3 (out of scope), но рядом.

### Безопасность

- [security] `app.js:135` — `escapeHtml` не экранирует `'` (одинарную кавычку). В текущей разметке атрибутов через template-литералы пишутся с двойными кавычками — безопасно. Но в будущем атрибуте `data-foo='${userInput}'` будет уязвимость. Дешёво поправить: добавить `"'":"&#39;"` в map. Tech-debt severity low.

- [security] `app.js:309` — `<span class="icon" style="background:${cat?.color || "var(--bg-elevated)"}">` подставляет `cat.color` в `style` без экранирования. Cat.color приходит из D1, контролируется владельцем — XSS-вектор отсутствует. Однако при будущем переходе на category-edit UI владелец сможет сам себе вписать `red;display:none`. Не блокер. Аналогично `app.js:223, 577, 1121, 1125`.

- [security] `app.js:1086-1093` — donut SVG `innerHTML` с конкатенацией `s.color` (из CHART_PALETTE — статика) и `agg.total` (number) — безопасно. Stage 3 scope.

- [security/privacy] `app.js:12` `localStorage.getItem(SETTINGS_KEY)` хранит только `{baseCurrency}` — корректно по spec'у. PII / финансы не попадают, токены — нет. ОК.

### Доступность

- [a11y] `index.html:42-44` — side-actions кнопки не имеют `aria-label`. Текст внутри (`сегодня`, `описание`, `RSD`) даёт screen-reader'у контекст, но visually это эмодзи + label. Tight enough для AA; для AAA добавить `aria-label="Валюта"`, `aria-label="Дата"`, `aria-label="Описание"`. Spec'ом доступность как goal не описана.

- [a11y] `index.html:60, 106` — back-btn (`<`) — нет `aria-label`. Можно `aria-label="Назад"`.

- [a11y] `index.html:27-38` — numpad-кнопки используют textContent (`1`-`9`, `.`, `⌫`). `⌫` — backspace, для screen-reader непрозрачно. Добавить `aria-label="Backspace"` на `data-key="back"`.

- [a11y] `app.js:1087-1093` — donut SVG имеет `aria-label`, хорошо. Но `<text>` показывает `state.baseCurrency` без эмодзи — комментарий объясняет почему (WebView не рендерит color font в SVG `<text>`). Решение задокументировано.

- [a11y] Динамический UI (toast, swipe-to-delete) — нет `aria-live` regions. Toast сообщения исчезают через 2 сек и screen-reader может пропустить. Стоит `<div id="toast" role="status" aria-live="polite">` (на `#toast` сейчас просто `class="toast"`).

### SOLID / архитектура vanilla SPA

- [SRP] `app.js:267-340` — `renderRecentDays` → `buildDayGroup` → `buildExpenseRow` — нормальная декомпозиция. `buildExpenseRow` принимает `swipeable: bool` — discriminated параметр; для двух callsite'ов терпимо. При добавлении третьего поведения — лучше отдельные функции.

- [OCP] `setupCategorySwipe()`, `attachSwipeToDelete()` — дублируют direction-lock логику (см. строки 367-369 и 688-691). Если когда-нибудь появится третий swipe-handler — извлечь `createSwipeHandler({onHorizontal, onVertical, threshold})`. Пока 2 — терпимо.

- [SRP] `app.js:425-507` — `renderHistoryScreen()` устанавливает `state.historyCtx`, а `renderHistoryChunk()` его читает. Это разделяет «set up» и «render» (хорошо), но `state.historyCtx` живёт в глобальном `state` — кажется чужеродно (это UI-state, не data-state). Допустимо, но можно вынести в локальный модуль `historyView`.

- [YAGNI/state] `app.js:20-29` — единый `state`-объект как «центр истины» — нормальный pattern для vanilla. Никаких прокси/observable — это **правильно** для скоупа. Поощряем.

### Performance

- [perf] `app.js:438` — `[...byDate.keys()].sort((a, b) => a < b ? 1 : -1)` сортирует ISO-даты лексикографически desc через тернарник. Работает, но `a.localeCompare(b)` или `b.localeCompare(a)` идиоматичнее и не возвращает `-1/0/1` неявно (тернарник возвращает `true|false` → coerced в `1|0|-1` через subtraction… на самом деле `a < b ? 1 : -1` опускает случай равенства и для одинаковых ключей вернёт -1 — это ок для уникальных дат, но семантически некорректно).

- [perf] `app.js:1175` — `for (const [iso, v] of agg.byDate) if (iso.startsWith(ym)) sum += v;` — O(days × months) при year/all. Stage 3 scope. На 1822-х expenses ~ 12-30 месяцев — приемлемо.

- [perf] `app.js:434-441, 425-507` — `renderHistoryScreen` строит `byDate` Map за один проход — O(n). Чанки по 30 дней через `IntersectionObserver` с `rootMargin: 200px` — корректная схема. На 1822-х expenses (~2.5 года = ~900 уникальных дат) первый чанк = 30 дат с их рядами — мгновенно. Хорошо.

- [perf] `app.js:491-499` — `IntersectionObserver` создаётся **каждый раз** в `renderHistoryChunk`. Старый `io` ни в одной ветке явно не disposed (хотя `io.disconnect()` вызывается внутри callback'а после первого `isIntersecting`). При навигации History → main → History — старые observer'ы могли бы leak'нуть, но `list.innerHTML = ""` в `renderHistoryScreen:427` удаляет sentinel'ы, и observer переходит в idle (без targets). GC заберёт. ОК, но `state.historyCtx.observer` для явного `disconnect` в `renderHistoryScreen` — чище.

- [perf] `app.js:1098-1103` — donut segs setTimeout fade-in: на каждом перерендере stats создаёт N setTimeout'ов (N=≤9). Stage 3 scope.

### Telegram WebApp integration

- [tg-integration] `app.js:3-4, 845-851` — `tg = window.Telegram?.WebApp; if (tg) tg.ready(); tg.expand();` — guarded, корректно. `disableVerticalSwipes / setHeaderColor / setBackgroundColor` обёрнуты в `try/catch`. Хорошо — старые версии Telegram могут не иметь этих методов.

- [tg-integration] `app.js:45` — `tg?.initData ? { "X-Telegram-Init-Data": tg.initData } : {}` — если `initData` пуст (открыто вне Telegram), header не отправляется. Worker возвращает 401, bootstrap записывает `bootstrapError`. Согласовано с E4 в spec'е.

- [tg-integration corner] `app.js:846-851` — `tg.ready()` вызывается в `init()`, но `init()` `async`. До `await bootstrap()` `ready/expand/disableVerticalSwipes` вызываются sync — OK. Однако между `bindEvents()` и `await bootstrap()` user может тапать numpad — это сработает (state.amount меняется), но категории ещё `Загрузка категорий…`. После bootstrap'а UI обновится через второй `render()`. Допустимо.

- [tg-integration] `app.js:412, 614` — используется browser native `confirm("Удалить эту запись?")`. Telegram имеет свой `tg.showConfirm(message, callback)` который выглядит нативнее на iOS. Перевод на него — UX improvement, не блокер.

### Code health прочее

- [error-handling] `app.js:62, 610, 623, 665, 418` — все `.catch(e => toast("Ошибка: " + e.message, "err"))` — единообразно. Хорошо.

- [error-handling] `app.js:49` — `api()` throws с `${r.status} ${t.slice(0, 200)}`. Текст ответа сервера попадает в toast — потенциально утечка инфо при 5xx, но это own-Worker, owner видит сам. ОК.

- [naming] `app.js:60` — fallback `{ date: null, base: "EUR", quotes: {} }` дублируется со строкой 22. Извлечь `DEFAULT_RATES = Object.freeze({date:null, base:"EUR", quotes:{}})`.

- [naming] `app.js:25` — `currency: "RSD"` — хардкод дефолта. На `app.js:855-856` он переопределяется из `state.accounts[0]?.currency || "RSD"`. Между bootstrap-fail и переопределением — RSD. R5 в spec'е этого касается.

## What's good

- Чистый ESM-модуль (`<script type="module">`) без bundler'а — соответствует G8.
- Единый `state`-объект, минимум абстракций. Понятно для vanilla SPA.
- `escapeHtml` применяется на каждый user-string перед `innerHTML`. Хотя escaping ' опущен, по текущей разметке OK.
- Направление-lock в swipe handlers (`abs(dx) > 8 || abs(dy) > 8`) — единообразно реализовано в двух местах; vertical-lock не делает `preventDefault`, поэтому диагональный свайп ведёт себя как scroll. AC7 соблюдён.
- Optimistic-insert + rollback по сети (`state.expenses.unshift`, в catch `.filter()`) — корректный pattern.
- Idempotent POST: UUID на клиенте (`uuid4()` с fallback на manual) → Worker делает `INSERT OR IGNORE`. ADR-005 соблюдён.
- `IntersectionObserver` для lazy-load истории + manual button — комбинация feature-detection и UX-fallback. AC18.
- Focus guard (`app.js:725-770`) — нетривиальное решение реальной iOS-проблемы (input-jump между полями). Документировано в spec'е E7, реализация чистая.
- `<meta interactive-widget=overlays-content>` — корректная защита от layout-shift при клавиатуре. AC24.
- Конверсия в base через EUR-pivot (`rateEURto`) — простая, изоморфная конструкция; handles `null` (missing rate) корректно.
- HMR-free кеш-busting через `?v=9` query — простейший и работающий способ. AC29.
- `tg.HapticFeedback.selectionChanged/impactOccurred` — корректные haptic-классы.

## ADR-conformance

- **ADR-009 (silent bot)**: ✓ Не применимо к Mini App (касается text-бота), но Mini App никак не подсказывает unauthorized'у, что система жива — bootstrap возвращает 401 и UI просто рендерит "Ошибка: …" в категориях.
- **ADR-005 (UUID на клиенте + INSERT OR IGNORE)**: ✓ `uuid4()` генерится клиентом перед POST, `source: "mini_app"` метит origin. Идемпотентность гарантируется на Worker'e.
- **ADR-011 (D1-centric)**: ✓ Mini App не имеет локального SQLite/IndexedDB, все CRUD идут через `/v1/expenses`. Соответствует pivot'у.
- **ADR-012 (Mini App scope ограничен)**: ✓ Никаких snapshots/income/exchange/portfolio в Mini App — только expense CRUD + stats. Хотя stats добавлены **в этом** коде, они помечены как Stage 3 и out-of-scope для review.
- **ADR-003 (Telegram Mini App как UI)**: ✓ Через `telegram-web-app.js`, `initData` для auth, нативные haptics.

## Security findings

- **OK**: Auth header `X-Telegram-Init-Data` отправляется на каждый запрос, валидируется Worker'ом (вне scope этого ревью).
- **OK**: Client-side validation (`amount > 0`, length cap 12, regex AC5) — обвес, server-side остаётся source of truth.
- **OK**: `escapeHtml` применён к user-content (`note`, `category.name`, error messages).
- **Tech-debt (R4)**: нет CSP-headers. `innerHTML` используется массово — XSS-вектор минимальный (own-data в D1), но при росте scope (например, импорт чужих CSV) станет уязвим. Фиксируем как принятый риск.
- **Low**: `escapeHtml` не escape'ит `'` — в текущей разметке атрибутов с double-quotes безопасно, но fragile к будущим изменениям.
- **OK**: `localStorage.finances.settings.v1` хранит только `{baseCurrency}`. Нет токенов, PII, финансов.
- **Note**: Worker URL захардкожен (`WORKER_BASE = "https://finances-worker.<owner>.workers.dev"`) — это публичный endpoint, не секрет. Но при появлении dev/staging — extract в `wrangler.example.toml` + env-injection через build step (что противоречит «no bundler»). Принять как есть.

## Technical debt notes

Сознательно оставлено (зафиксировано в spec'е, не требует фикса):
- **R4 (CSP)**: открытый риск, accept'ed для personal scope.
- **R5 (default RSD)**: hardcoded fallback при отсутствии accounts.
- **R6 (optimistic-loss при crash до POST resolution)**: latency 200-500ms делает это редким.
- **NG6 (нет локализации)**: hardcoded русский. Spec'ом исключено из scope.
- **NG7 (тёмный фон зашит, не `themeParams`)**: design-decision, не bug.
- **Stage 3 stats код в файле**: явно out-of-scope per spec section 12; ревью отложено до SPEC-003.

Nice-to-have для следующего полировочного захода Mini App (когда снова откроется этап):
- Унификация magic numbers в module-level `const`.
- Promise-based `closeModalsAsync()` для устранения `setTimeout(..., 300/320/340)`.
- Удаление dead code `monthName` (app.js:904).
- `aria-label` на back-btn и `data-key="back"` numpad-кнопке.
- Extract `buildCurrencyGrid(...)` после третьего повторения.

## Заключение

Vanilla-JS реализация Mini App — образец прагматичного решения для personal-scope проекта. Spec покрыт, ADR соблюдены, security-поверхность принята осознанно с фиксацией в spec'е. Архитектурных long-term проблем не выявлено. Merge approved.
