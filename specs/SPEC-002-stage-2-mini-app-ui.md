---
id: SPEC-002
title: Stage 2 — Mini App UI (ввод трат с iPhone, история, edit)
status: done
owner: stepan
created: 2026-05-25
updated: 2026-05-25
links:
  - superseded_by: SPEC-014  # vanilla Mini App удалён при React-rewrite
  - adr: docs/decisions.md
  - parent: SPEC-001  # Stage 1 заложил Worker + endpoints, на которые опирается UI
  - depends_on: []
---

# Stage 2 — Mini App UI

## 1. Context & Problem

После Этапа 1 цепочка `iPhone → Worker → D1` работала только через текстовый Telegram-бот: «съел в кафе 500 RSD» — парсер угадывал категорию и валюту. Это годится для смоук-теста, но не для повседневного ввода: бот ошибается с категорией, не показывает остаток дня, и нельзя поправить запись задним числом. Нужен «настоящий» UI калькулятор-стайла, как в «Расходы ОК», но внутри Telegram (чтобы не плодить отдельные приложения и не возиться с App Store). Telegram Mini Apps дают именно это: HTTPS-страница в WebView, авторизованная через подписанный `initData`, с нативными хаптиками и темой.

## 2. Goals

- **G1**: Ввод одной траты с iPhone — ≤ 5 тапов от запуска (сумма + категория, валюта/дата/описание опциональны).
- **G2**: Сетка категорий с эмодзи и пастельными цветами, листается свайпом, как в «Расходы ОК».
- **G3**: Мульти-валютность поддерживает все 5 валют системы (EUR / USD / RUB / RSD / USDT) с флагами и переключателем; запись хранит исходную валюту.
- **G4**: Редактирование и удаление прошлых трат прямо из Mini App — без захода в Admin/Telegram-бот.
- **G5**: История трат прокручивается без лагов даже на 1800+ записях (lazy-load чанками).
- **G6**: UI не «прыгает» при появлении мобильной клавиатуры (не layout-shift'ит сетку категорий и history).
- **G7**: Авторизация только через Telegram `initData` (HMAC-проверка на Worker'е), никаких отдельных логинов.
- **G8**: Никакого бандлера — чистый HTML/CSS/vanilla JS, чтобы деплой на Cloudflare Pages был просто `wrangler pages deploy public`.

## 3. Non-Goals

- **NG1**: Аналитика / графики / KPI — это Stage 3.
- **NG2**: Курсы валют и конвертация в базовую валюту — Stage 3 (Mini App в Stage 2 показывает суммы только в исходной валюте).
- **NG3**: Доходы, снапшоты счетов, обмены — Web Admin (Stage 5+).
- **NG4**: Офлайн-очередь (outbox в localStorage с ретраями). В Stage 2 при network-failure делается оптимистичный rollback + toast «Ошибка», заново отправлять руками.
- **NG5**: Поддержка Android / Desktop Telegram. Целевая платформа — iPhone WebView (iOS 16+).
- **NG6**: Локализация. UI русскоязычный hardcoded.
- **NG7**: Темизация под `themeParams` пользователя. Тёмный фиолетовый фон зашит в `--bg: #2b2546`.

## 4. User journeys

### Happy path — ввести трату

1. Пользователь открывает Telegram, тапает на меню-кнопку бота `@finances_bot`. Mini App запускается в полноэкранном WebView.
2. `bootstrap()` тянет `/v1/bootstrap` → грузит категории, валюты, аккаунты, существующие траты, курсы (для будущего использования).
3. Видит экран: вверху display `0 🇷🇸 RSD`, под ним numpad 1–9/0/./⌫, кнопки `Валюта / Дата / Описание`, сетка из 8 категорий-плиток с эмодзи на пастельном фоне, точки-пагинации, и блок «Сегодня / Вчера» с уже-сделанными тратами.
4. Тапает `5` `0` `0` на numpad — display показывает `500`, категории перестают быть disabled.
5. (Опционально) тапает плитку «🇪🇺 EUR» в боковых действиях → открывается currency picker → выбирает `EUR`.
6. (Опционально) тапает `📅 сегодня` → выбирает «Вчера» или произвольную дату через `<input type="date">`.
7. (Опционально) тапает `💬 описание` → вводит «обед с N», тапает OK.
8. Тапает плитку «☕ Кафе» — срабатывает haptic, оптимистично добавляется запись в state.expenses, идёт `POST /v1/expenses`, toast `✓ 500 EUR → Кафе`, сумма сбрасывается на `0`, описание очищается.
9. В блоке «Сегодня» появилась новая строка `☕ Кафе · обед с N · 500 🇪🇺 EUR`.

### Happy path — отредактировать прошлую трату

1. Пользователь свайпает категории влево, видит вторую страницу. Открывает hamburger `☰` → «📜 История».
2. Появляется экран `История` со скроллом по дням от свежих к старым, чанками по 30 дней.
3. На строке делает свайп влево — справа открывается красная кнопка `✕` (iOS-style swipe-to-delete).
4. Тап на саму строку (а не на reveal) — открывается bottom-sheet modal с полями `Сумма / Валюта / Дата / Описание / Категория` и кнопками `Удалить / Сохранить`.
5. Меняет сумму, тапает категорию в mini-grid, тапает `Сохранить`. Идёт `PUT /v1/expenses/:id`, modal закрывается с slide-down анимацией, toast `✓ Сохранено`, история перерисовалась.

### Edge cases

- **E1: Категорию тапнули при пустой сумме (`0`).** Плитки в categories отрисованы с классом `.cat.disabled` (opacity 0.35, pointer-events none) — клик не сработает; на бэкап-случай если кто-то всё же дотянулся через клавиатуру — `onCategoryTap` ранний return + toast «Введите сумму».
- **E2: Ошибка сети при POST.** Оптимистичная запись откатывается (`state.expenses = state.expenses.filter(x => x.id !== expense.id)`), `render()` перерисовывает блок «Сегодня», toast `Ошибка: <message>` (kind=err, красная полоска слева).
- **E3: Bootstrap упал (401 / 5xx / no network).** `state.bootstrapError` пишется, сетка категорий отрисовывается с placeholder «Ошибка: …»; numpad и боковые кнопки остаются рабочими, но категории нельзя тапнуть (их нет в state).
- **E4: Не залогинен (нет initData).** Telegram не передаёт `initData` если открыть страницу вне Telegram → header `X-Telegram-Init-Data` пустой → Worker отвечает 401 → bootstrap записывает ошибку. Видна загрузка-фейл, UI частично рабочий (numpad крутится впустую).
- **E5: Свайп начат вертикально по сетке.** Direction lock в `setupCategorySwipe`: пока `|dx|, |dy| < 8` — направление не определено, как только определилось `v` — горизонтальный transform не применяется, обычный scroll работает.
- **E6: Открыли клавиатуру в edit modal над input.** `interactive-widget=overlays-content` в `<meta name=viewport>` → клавиатура накладывается поверх контента, layout не «прыгает», сетка категорий не уезжает.
- **E7: В edit modal тапнули по другому input/select мимо текущего сфокусированного.** Focus guard (`setupFocusGuard`) перехватывает pointerdown в capture-фазе, делает `blur()`, не активирует чужой input — иначе iOS Safari прыгал бы клавиатурой между полями.
- **E8: История > 30 дней.** Чанки по 30 дней, sentinel-кнопка «Показать ещё (N дней осталось)» + IntersectionObserver на корне `#app` с rootMargin `200px` — авто-подгрузка при подходе к концу.
- **E9: Удалили запись.** В Истории — кнопка `✕` reveal'ится свайпом → confirm() → `DELETE /v1/expenses/:id` (soft-delete на сервере) → `state.expenses.filter()` локально → toast `🗑️ Удалено`.
- **E10: Тап на сегмент donut/категорию в Stats.** (Stage 3 — за scope этого spec'а, но Mini App уже отрендерен с этим UI; здесь упоминается только потому что соседствует.)

## 5. Data model

Stage 2 **не добавляет** новых таблиц. Использует существующие из Stage 1 + миграции, специфичные для UI:

- **003_seed_for_ok_import.sql** (выполнена в Stage 4 хронологически, но категории нужны и Stage 2 для полной сетки) — добавляет 7 категорий: `sport / housing / utilities / electronics / leisure / clothing / beauty`. Также создаёт аккаунт `acc_money_ok_rsd` (синтетический cash-источник).
- **004_extend_categories_v2.sql** — добавляет 4 категории: `tips / government / debts / adult`.
- **005_category_colors.sql** — UI-only миграция: проставляет `categories.color = '#RRGGBB'` (пастельная палитра), и `currencies.emoji` (флаги 🇪🇺 🇺🇸 🇷🇺 🇷🇸 💎 для EUR/USD/RUB/RSD/USDT).

После всех миграций в expense-сетке Mini App видны 25 категорий типа `expense` (32 всего, минус 5 income + 2 system). При 8 категорий на страницу — это 4 страницы с пагинацией.

```sql
-- Снимок DDL, релевантный для UI (детали в local/schema.sql)
CREATE TABLE categories (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL CHECK (type IN ('expense','income','system')),
    emoji       TEXT,
    color       TEXT,          -- hex #RRGGBB, добавлено для Mini App
    sort_order  INTEGER DEFAULT 999
);

CREATE TABLE currencies (
    code        TEXT PRIMARY KEY,    -- EUR/USD/RUB/RSD/USDT
    name        TEXT NOT NULL,
    emoji       TEXT                 -- флаг страны
);

CREATE TABLE expenses (
    id            TEXT PRIMARY KEY,  -- UUID v4 (генерится на клиенте — идемпотентность POST)
    date          TEXT NOT NULL,     -- ISO YYYY-MM-DD
    amount        REAL NOT NULL,
    currency      TEXT NOT NULL REFERENCES currencies(code),
    category_id   TEXT REFERENCES categories(id),
    note          TEXT,
    source        TEXT,              -- "mini_app" — заполняется клиентом
    created_at    TEXT,
    updated_at    TEXT,
    deleted_at    TEXT               -- soft-delete
);
```

**Семантика**:
- `expenses.amount` хранится как `REAL` в исходной валюте; никакой конвертации на запись. Конверсия в base — на чтении (Stage 3).
- `expenses.id` — UUID v4, генерится клиентом через `crypto.randomUUID()`; на Worker'е — `INSERT OR IGNORE` по PK, поэтому повторный POST после flaky-network безопасен.
- `expenses.source = "mini_app"` отличает записи от Telegram-бота (`tg_text`) и импорта (`ok_import`).
- `categories.color` — пастельный hex, используется только как `background` плитки в сетке и в icon-кружке в day-row. Donut/stats use chart-палитру (Stage 3).

## 6. API contract

Все endpoint'ы реализованы в Stage 1; Stage 2 — только их потребитель. Auth: HMAC-подпись Telegram `initData` в header `X-Telegram-Init-Data` (см. `cloud/worker/src/auth.ts`).

### `GET /v1/bootstrap`
- Auth: `X-Telegram-Init-Data`.
- Response 200:
  ```json
  {
    "accounts":    [{"id":"acc_money_ok_rsd","name":"…","type":"cash","currency":"RSD",...}],
    "categories":  [{"id":"food","name":"Еда","type":"expense","emoji":"🍔","color":"#FFB199","sort_order":10}, ...],
    "currencies":  [{"code":"EUR","name":"Euro","emoji":"🇪🇺"}, ...],
    "expenses":    [{"id":"…","date":"2026-05-25","amount":500,"currency":"RSD",...}, ...],
    "rates":       {"date":"2026-05-24","base":"EUR","quotes":{"USD":1.08,"RUB":98.4,...}}
  }
  ```
- Response 401: пустой `initData` или истёкший / тампированный. Mini App пишет в `state.bootstrapError` и рендерит placeholder.

### `POST /v1/expenses`
- Auth: `X-Telegram-Init-Data`.
- Body:
  ```json
  {"id":"<uuid>","date":"YYYY-MM-DD","amount":<num>,"currency":"<CODE>",
   "category_id":"<id>","note":"<str|null>","source":"mini_app","created_at":"<iso>"}
  ```
- Response 200: созданная запись (echo).
- Response 4xx: валидация на сервере (`amount > 0`, `currency` ∈ известных, `date` парсится).

### `PUT /v1/expenses/:id`
- Auth: `X-Telegram-Init-Data`.
- Body (partial): `amount / currency / date / note / category_id`.
- Response 200: обновлённая запись.

### `DELETE /v1/expenses/:id`
- Auth: `X-Telegram-Init-Data`.
- Soft-delete: `UPDATE expenses SET deleted_at=now() WHERE id=?`.
- Response 200: `{"ok": true}`.

## 7. UI / UX

Цветовая схема (CSS-переменные в `:root`):
- `--bg #2b2546` — фиолетовый фон (заголовок Telegram и body синхронизированы через `tg.setHeaderColor`/`setBackgroundColor`).
- `--bg-elevated #36315a`, `--bg-card #322c54` — слои.
- `--accent #a78bfa` — фиалковый акцент (active states, primary buttons).
- `--success #86efac`, `--danger #fb7185` — toast и destructive.

Анимации: `--ease cubic-bezier(.32, .72, 0, 1)`, `--dur 280ms`, `--dur-fast 180ms` — едины для всех transitions.

### Экраны

**Main (`#screen-main`)** — стек:
```
┌─────────────────────────────────────┐
│  ☰     ┃ 500          ┃     📜    │  topbar (hamburger / display / history)
│        ┃ 🇷🇸 RSD       ┃            │
├─────────────────────────────────────┤
│  1   │   2   │   3                  │
│  4   │   5   │   6                  │  numpad 3×4
│  7   │   8   │   9                  │
│  .   │   0   │   ⌫                  │
├─────────────────────────────────────┤
│ 🇷🇸RSD │ 📅сегодня │ 💬описание      │  side-actions
├─────────────────────────────────────┤
│  🍔   🛒   ☕   🚗                  │
│ Еда  Прод  Кафе Транс               │  categories 4×2 (страница), свайп влево/вправо
│  🛍️   🎬   ⚕️   🏠                  │
│ Шоп  Развл Здор  Дом                │
│        • ○ ○ ○                      │  pager dots
├─────────────────────────────────────┤
│ СЕГОДНЯ  ВТ              123 🇷🇸 RSD│  day-group
│ ☕ Кафе · обед     500 🇷🇸 RSD       │
│ ВЧЕРА    ПН              —          │
└─────────────────────────────────────┘
```

**History (`#screen-history`)** — список day-group'ов, начиная с сегодня, чанками по 30 дней. iOS swipe-to-delete на каждой строке.

**Stats (`#screen-stats`)** — KPI карточка + SVG donut + список категорий с прогресс-барами + bar-chart по дням. Period picker `Нед / Мес / Год / Всё` + prev/next. **Stage 3.**

**Modals (bottom sheets)**: 7 штук — `menu / settings / currency / date / note / edit / stats-detail`. Все слайдятся снизу через `transform: translateY(100%) → 0` за `var(--dur)`, backdrop опако-fade'ится. При закрытии — обратное.

### Состояния

- **Loading**: `state.bootstrapped = false` → плитки заменяются на «Загрузка категорий…».
- **Error**: `state.bootstrapError` → «Ошибка: <msg>».
- **Empty (история)**: «Пока пусто.»
- **Empty (день)**: `—` в `day-total`.
- **Disabled категории**: `amount === 0` → `opacity 0.35 + pointer-events: none`.

### Микро-взаимодействия

- Тап на numpad: `tg.HapticFeedback.selectionChanged()`.
- Тап на категорию (успех): `tg.HapticFeedback.impactOccurred('light')`.
- Toast'ы появляются с `animation: toastIn` (fade + translateY), исчезают через 2 сек.
- Свайп категории < 18% ширины viewport — отскок назад. > 18% — переход на следующую страницу.
- Swipe-to-delete: открыт при `dx < -28px`, фиксируется на `-64px`. `reveal` кнопка имеет `opacity:0 + pointer-events:none` до начала drag — иначе во время scroll бы мерцала.

## 8. Security

- **Auth**: каждый запрос несёт `X-Telegram-Init-Data` (raw query string от `Telegram.WebApp.initData`). Worker валидирует HMAC-SHA256 с `BOT_TOKEN` (см. ADR-009). Если `initData` старше суток или подпись не сходится — 401, никаких фолбэков.
- **Whitelist**: Worker отдельно проверяет `user.id` ∈ `authorized_users` таблицы D1. Не в whitelist → 403, в логи `unauthorized_user_id`. Mini App видит это как обычную 401/403 и ничего не показывает (placeholder ошибки в категориях).
- **Input validation на клиенте** — обвес, не security: `amount > 0`, `state.amount.length <= 12`, `fracPart.length <= 2`, escapeHtml на любых user-strings перед `innerHTML`.
- **Input validation на сервере** — единственный источник истины: тип/диапазон каждого поля, FK на категорию/валюту.
- **PII / финансы в логах**: записи самих трат не логируются Worker'ом (только counts и user_id). LocalStorage хранит только `{baseCurrency: "EUR"}`, никаких токенов.
- **CORS**: Mini App открывается с домена `finances-miniapp.pages.dev`, Worker — `finances-worker.workers.dev`. Worker отдаёт CORS-headers с allowed-origin для Pages-домена.
- **CSP**: не настроен (откладывается; см. risks).

## 9. Acceptance criteria

- [x] AC1: Бот в @BotFather имеет настроенный `setChatMenuButton` → URL `https://finances-miniapp.pages.dev`. Тап на кнопку открывает Mini App в полноэкранном WebView.
- [x] AC2: При запуске вызывается `Telegram.WebApp.ready() + expand()`, header и body окрашиваются в `#2b2546`.
- [x] AC3: `GET /v1/bootstrap` стучит с `X-Telegram-Init-Data`. В случае 200 — заполняются `state.accounts/categories/currencies/expenses/rates`. В случае ошибки — `state.bootstrapError` отображается в сетке категорий.
- [x] AC4: Display показывает `0` (полупрозрачное `--hint`) до первого тапа numpad. После любого digit — display жирнее, категории становятся кликабельными.
- [x] AC5: Numpad поддерживает только формат `^[0-9]+(\.[0-9]{0,2})?$`, максимум 12 символов; backspace `⌫` доводит до `0`; точка `.` ставится только один раз.
- [x] AC6: Сетка категорий имеет ровно 8 ячеек на страницу (4×2), spacers заполняют неполные страницы; цвет плитки = `categories.color` (пастель из миграции 005), фолбэк на `--bg-elevated`.
- [x] AC7: Свайп категорий — настоящий drag с translateX (не slick/swiper), direction-lock включается при `|dx| > 8 || |dy| > 8`, при `dir = 'h'` — `preventDefault` на touchmove (блокирует вертикальный scroll viewport'а).
- [x] AC8: Threshold переключения страницы — 18% ширины viewport; threshold не достигнут → отскок на текущую с CSS transition.
- [x] AC9: Side-actions: `🇷🇸 RSD` (currency picker), `📅 сегодня/вчера/MM-DD` (date), `💬 описание/есть` (note); кнопка note подсвечивается `--accent` если есть описание.
- [x] AC10: Тап на категорию при `amount > 0`: оптимистично вставляет запись в `state.expenses` через `unshift`, рендерит recent-days, шлёт `POST /v1/expenses` с UUID и `source: "mini_app"`. После успеха — toast `✓ <сумма> <ccy> → <кат>`, сумма и note сбрасываются.
- [x] AC11: При POST-ошибке — запись откатывается из state, toast `Ошибка: <msg>`.
- [x] AC12: Recent-days отображает СЕГОДНЯ и ВЧЕРА с заголовком «Сегодня / Вчера + ПН/ВТ/…», сумма по валюте.
- [x] AC13: Тап на строку в recent-days → открывается edit-modal со всеми полями заполненными из выбранной траты.
- [x] AC14: Edit modal: numeric input для суммы (`inputmode="decimal"`), `<select>` для валюты, `<input type="date">` для даты, textarea для описания, mini-grid 5-в-ряд для категории (тап → подсвечивает outline = `--accent`).
- [x] AC15: Save в edit modal: `PUT /v1/expenses/:id`, локальный merge, render, toast `✓ Сохранено`. Delete: `confirm()` → `DELETE` → state filter → toast `🗑️ Удалено`.
- [x] AC16: Modals slide-up снизу за `var(--dur)` через transform; backdrop fade. При close — обратная анимация; `transitionend` + 340ms fallback ставят `hidden`.
- [x] AC17: История открывается из меню или иконки `📜`. Первый чанк — последние 30 дней по `date desc`.
- [x] AC18: Кнопка `Показать ещё (N дней осталось)` + IntersectionObserver на root `#app`, rootMargin `200px` — авто-подгрузка следующего чанка.
- [x] AC19: iOS swipe-to-delete: touchstart захватывает X/Y, при `|dx| > |dy|` (dir-lock = h) — transform по dx, при `dx < -28` на touchend — фиксируется на `-64px`, `reveal` кнопка `✕` становится opacity 1 + pointer-events auto.
- [x] AC20: Тап на открытую (revealed) строку без свайпа — закрывает её обратно, а не открывает edit.
- [x] AC21: Тап на `reveal ✕` — `confirm("Удалить эту запись?")` → `DELETE` → toast.
- [x] AC22: Currency picker модалка показывает 5 валют (EUR/USD/RUB/RSD/USDT) в гриде 3-в-ряд с флагом, кодом и названием; активная — фон `--accent`.
- [x] AC23: Settings модалка позволяет выбрать `baseCurrency`, значение сохраняется в `localStorage.finances.settings.v1`.
- [x] AC24: `<meta name="viewport" ... interactive-widget=overlays-content>` — клавиатура накладывается поверх контента, не меняет layout-высоту body.
- [x] AC25: Focus guard на `#modal-edit` и `#modal-note`: при сфокусированном input, тап на другой input/select — `preventDefault + stopPropagation + active.blur()` (не активирует чужой input). Тап на button — даёт сработать, но первым делом `blur`.
- [x] AC26: Enter в textarea (без shift) — `blur()` вместо вставки newline.
- [x] AC27: Все transitions (modals, swipe row, categories drag, pager dots, toast) используют `var(--ease)` + `var(--dur)`/`var(--dur-fast)` — нет inline magic numbers (кроме `--dur` fallback 340ms в closeModals).
- [x] AC28: При rotate / resize окна — `snapTo(state.catPage, false)` пересчитывает translateX по новой ширине viewport'а.
- [x] AC29: Кеш-busting: `<link href="styles.css?v=9">` и `<script src="app.js?v=9">` — версии bumpятся при деплое.

## 10. Test plan

- **Worker** (уже покрыт Stage 1): curl smoke `POST /v1/expenses` с разными UUID — проверка идемпотентности; 401 на пустой `initData`.
- **Mini App ручное (iPhone 15 Pro Max в Telegram-app)**:
  - Ввод траты в 5 валютах × 3 категории.
  - Свайп категорий вправо/влево; диагональный свайп — должен скроллить вертикально, не уезжать.
  - Edit modal: смена amount/ccy/date/note/category + save; delete с confirm.
  - История 1800+ записей — scroll до конца, lazy-load кнопки и observer.
  - Открыть-закрыть клавиатуру в edit modal — категории на main не должны прыгать (нужно сделать через swipe-back на главный экран).
  - iOS swipe-to-delete: открыть-закрыть-открыть, потом тап на сам row.
- **Playwright (`local/scripts/test_ui.py`)** — добавлен в Stage 3, эмулирует iPhone 15 Pro Max, дёргает Worker mock'ом, делает скриншоты состояний.
- **Regression**: после деплоя Mini App проверять что Telegram-бот (text-flow) всё ещё работает (тот же Worker).

## 11. Risks & open questions

- **R1 (закрыт)**: длинные истории (>1500 строк) с swipe-handler крашили iOS Telegram WebView. → решено пагинацией по 30 дней + IntersectionObserver.
- **R2 (закрыт)**: emoji-флаги в SVG `<text>` не рендерились как color font в Telegram WebView — пустые квадраты. → в donut'е center показывает только код валюты (без флага). Решение зашито в `renderStatsDonut`.
- **R3 (закрыт)**: тап на input через другой input в edit modal вызывал перепрыгивание клавиатуры и иногда залипание фокуса. → focus-guard перехватывает pointerdown в capture-фазе.
- **R4 (открыт)**: нет CSP-header'ов. В Mini App `innerHTML` используется массово, escapeHtml применяется только к user-content (note/name) — но XSS-вектор минимальный (own-data, own-bot, own-WebView), пока живём так.
- **R5 (открыт)**: при первом запуске на новом устройстве `state.currency` устанавливается из `state.accounts[0].currency` — но если у пользователя 0 non-external аккаунтов, дефолт хардкод-«RSD». Допустимо для одного пользователя.
- **R6 (открыт)**: оптимистичная вставка трат держится в памяти и localStorage не используется. При перезапуске Mini App до завершения POST — запись «потеряется» (но Worker её получил, если запрос отправился). На практике latency 200-500ms делает это редким.
- **OQ1 (закрыт)**: использовать ли Telegram `MainButton` / `BackButton`? — Решено: нет. Свой topbar даёт больше контроля (см. ADR в notes).
- **OQ2 (закрыт)**: бандлер? — Нет. ES2023 + vanilla JS без сборки, файл `app.js` 1288 строк — управляемо для одного человека.

## 12. Out of scope для review

- Любые stats-куски (`renderStatsScreen`, `renderStatsDonut`, …) — это Stage 3, ревьюится в SPEC-003.
- Конверсия в base через `convertToBase` — Stage 3.
- Worker `/v1/rates` + cron — Stage 3.
- Web Admin — Stage 4+.

## 13. Changelog spec'а

- 2026-05-25: создан retrospective как `done`. Stage 2 закрыт в коде минимум за месяц до этого, но spec не писали.
- 2026-07-07: обратный superseded-маркер (аудит 2026-07, SPC-08): vanilla Mini App целиком заменён React-переписыванием (SPEC-014) и удалён из репо; AC этой спеки непроверяемы против текущего кода. UI-паттерны переехали в `cloud/miniapp/src/`.
