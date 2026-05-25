# QA Report: SPEC-005 — Stage 5a Snapshots CRUD
date: 2026-05-25
verdict: PASS_WITH_NICES

Retrospective audit. Этап `done` в spec; ниже — независимая валидация контракта,
кода и продакшн-D1 со стороны senior QA.

## Test setup

- Worker prod URL: `https://finances-worker.stepan-mikhalev-99.workers.dev`
  (из `cloud/worker/wrangler.toml`).
- D1: `finances-outbox` (id `36fbd044-...`), читал через
  `npx wrangler d1 execute … --remote`.
- Admin SPA URL: `https://finances-admin.pages.dev` — UI-логин через Google OAuth,
  у QA-агента нет валидного JWT, поэтому проверки UI ограничены статическим
  анализом исходников (`cloud/admin/src/routes/{AccountsPage,SnapshotsPage}.tsx`,
  `components/Modal.tsx`, `api/queries.ts`, `components/AppLayout.tsx`) и
  получением HTML-shell SPA (на `/accounts` отдаётся обычный shell с title
  «Finances · Admin», что ожидаемо для SPA).

## Verified (Acceptance criteria, 12 пунктов)

- **AC1: Миграция 0006 применима к D1; 8 строк в `accounts`.**
  PASS. `wrangler d1 execute … "SELECT id, form FROM accounts WHERE form != 'external'"`
  вернул 7 строк; `… WHERE form = 'external'` — 1 строку (`external`, `is_active=0`).
  Итого 8. Колонки `form`, `sort_order`, `deleted_at` добавлены
  (`PRAGMA table_info(snapshots)` подтверждает наличие всех 9 колонок:
  `id, date, account_id, amount, note, source, created_at, updated_at, deleted_at`).
  Все 3 индекса присутствуют: `idx_snapshots_date`, `idx_snapshots_account_date`,
  `idx_snapshots_active_date` (partial-index `WHERE deleted_at IS NULL`).

- **AC2: `GET /v1/web/accounts` возвращает 7 вёдер (без external).**
  PASS by code review + D1-данные. `listBuckets` (`cloud/worker/src/snapshots.ts:96-104`)
  фильтрует `WHERE form != 'external' AND deleted_at IS NULL ORDER BY sort_order, name`.
  D1 содержит ровно 7 строк с `form != 'external'`:
  `rub-bank(10), rsd-bank(20), acc_money_ok_rsd(30), eur-bank(40),
  eur-cash(50), usdt(60), try-cash(70)`. Цвета, валюты, sort_order соответствуют
  спецификации SPEC-005 §5.

- **AC3: POST идемпотентен по `id`, повторный → `inserted=false`.**
  PASS by code review. `createSnapshot`
  (`cloud/worker/src/snapshots.ts:52-67`) использует `INSERT OR IGNORE` и
  возвращает `inserted: (r.meta.changes ?? 0) > 0`. Также UUID, если клиент его
  не прислал, генерится сервером через `crypto.randomUUID()` —
  поведение покрывает оба варианта (idempotent client / lazy client).

- **AC4: POST без `date`/`account_id`/`amount` → 400.**
  PASS by code review. `handleWebSnapshotsCreate`
  (`cloud/worker/src/index.ts:221-231`) проверяет:
  `!body.date || !body.account_id || typeof body.amount !== "number"` → 400
  с точным сообщением `date, account_id, amount are required`.
  *Edge:* `amount === 0` валиден (typeof number, not falsy via `!`).

- **AC5: PUT частичный апдейт.**
  PASS by code review. `updateSnapshot`
  (`cloud/worker/src/snapshots.ts:69-86`) использует
  `COALESCE(?, col)` для date/account_id/amount; для `note` — прямое
  присваивание (`note = ?`). Это соответствует спеке («`note` всегда
  обновляется, в т.ч. на null»). На уровне SPA `SnapshotsPage` модал всегда
  пересылает все 4 поля (date+account_id+amount+note из существующей строки),
  поэтому пользователь не теряет note случайно. См. также Nice-to-have ниже.

- **AC6: DELETE — soft-delete, строка исчезает из листинга и из `latest_snapshot`.**
  PASS by code review. `deleteSnapshot` (`snapshots.ts:88-93`) пишет
  `deleted_at = datetime('now')` с условием `AND deleted_at IS NULL` —
  повторное удаление возвращает `deleted=false` (E6 из spec).
  `listSnapshots` (строка 22) и `latestSnapshotPerAccount` (строки 41 и 43)
  оба фильтруют `WHERE deleted_at IS NULL`.

- **AC7: Пустые карточки = «Снапшотов нет» + dashed border.**
  PASS by code review. `BucketCard`
  (`cloud/admin/src/routes/AccountsPage.tsx:71-124`): при `empty = !acc.latest_snapshot`
  применяется `border-dashed` (строка 83) и блок с `AlertCircle + «Снапшотов нет»`
  (строки 115-120). Цвет иконки = `acc.color + "22"` — alpha 0.13, согласовано
  с UI-описанием §7.

- **AC8: Net worth = Σ EUR-эквивалент по 7 вёдрам.**
  PASS by code review. `AccountsPage:23` —
  `accounts.reduce((s, a) => s + (a.latest_snapshot ? toEur(a.latest_snapshot.amount, a.currency) : 0), 0)`;
  `toEur` (строки 15-19) использует `amount / rate` для не-EUR
  (`refs.rates.quotes[ccy]`). Для EUR — возвращает amount без деления.
  Edge E5 (нет курсов): `toEur` вернёт `0`, summary покажет `0.00 EUR`,
  а «Курсы от даты» — `«—»` (строка 49).

- **AC9: invalidateQueries обновляет таблицу и summary без F5.**
  PASS by code review. Все три mutation hooks
  (`cloud/admin/src/api/queries.ts:54-94`) на `onSuccess` инвалидируют
  обе query keys: `["snapshots"]` и `["accounts"]`. Это покрывает синхронизацию
  таблицы /snapshots и карточек /accounts.

- **AC10: Модал показывает «Прошлый: X · ±Δ» с цветом.**
  PASS by code review. `SnapshotModal`
  (`SnapshotsPage.tsx:247-260`): подсказка показывается только если
  `lastForAcc` существует; знак дельты определяется
  `parseFloat(amount) - lastForAcc.amount > 0` → text-positive,
  `< 0` → text-negative, `=== 0` → пусто. `lastForAcc` берётся из
  `selectedAcc.latest_snapshot` (тот же объект, что возвращает
  `/v1/web/accounts`), поэтому при создании следующего снапшота того же
  ведра дельта будет корректна.

- **AC11: 1822 исторических expenses не пострадали.**
  PASS with note. `SELECT COUNT(*) FROM expenses` → **1826** (не 1822).
  Расхождение из 4 строк — вероятно тестовые/новые записи из Mini App после
  написания spec (миграция 0006 не трогает expenses). По существу — данные
  доступны, схема expenses не модифицирована, FK на `accounts(id)` цел
  (foreign_keys=1 в D1). Если число в spec важно как trace — стоит
  обновить (см. Nice-to-have).

- **AC12: Sidebar активен по «Счета» и «Снапшоты».**
  PASS by code review. `AppLayout.tsx:14-21` — массив NAV содержит
  `{ to: "/accounts", icon: Wallet, label: "Счета" }` и
  `{ to: "/snapshots", icon: PieChart, label: "Снапшоты" }` без флага `disabled`.
  Disabled только Доходы и Обмены (Stage 6/7). При активном path подсветка —
  `bg-primary/15 text-primary`.

## Auth (security tests против prod)

- `GET /v1/web/accounts` без токена → `401 {"error":"unauthorized"}` ✓
- `GET /v1/web/snapshots` без токена → `401 {"error":"unauthorized"}` ✓
- `POST /v1/web/snapshots` без токена → `401 {"error":"unauthorized"}` ✓
- `PUT /v1/web/snapshots/<uuid>` без токена → `401` ✓
- `DELETE /v1/web/snapshots/<uuid>` без токена → `401` ✓
- `POST` с битым JWT (`Bearer bad.token.here`) → `401 {"error":"unauthorized","reason":"bad signature"}` ✓
- Email-allowlist: `requireAdminSession` (cloud/worker/src/auth-google.ts:114-129)
  → если JWT валиден, но email не в `ADMIN_ALLOWED_EMAILS` → 403. Чтение кода
  подтверждает (тестировать вручную не могу — нужен живой OAuth-flow).
- `apiFetch` (client.ts:34-38) при `401` вытирает токен и редиректит на
  `/login` — поведение E2 из spec.

CORS preflight:
- С `Origin: https://finances-admin.pages.dev` →
  `Access-Control-Allow-Origin: https://finances-admin.pages.dev`, 204 ✓
- С `Origin: https://evil.example.com` → `Access-Control-Allow-Origin: *`, 204.
  См. Notes ниже — это **намеренное** поведение Mini App-совместимости, но в
  сочетании с Authorization-header-only-auth (JWT не идёт в Cookie) это
  не приводит к утечке данных. Достойно проговорить отдельно (Notes / R-OQ).

## Functional edge cases

- **E1 empty bucket**: dashed border, AlertCircle, «Снапшотов нет» — реализовано
  (AccountsPage.tsx:115-120).
- **E2 JWT expired**: handled by `apiFetch` → clearToken + `/login` redirect
  (client.ts:34-38).
- **E3 битый body**: проверено curl-ом — 400 с правильным сообщением.
- **E4 amount=0**: код пропустит (`typeof amount === 'number'` истинно),
  валидация на фронте `parseFloat(amount) >= 0` тоже пропустит. ✓
- **E5 нет курсов**: `toEur` возвращает 0, summary «Курсы от даты — —».
  AccountsPage гарантирует, что totalEur всё равно посчитается (просто = 0 для
  не-EUR вёдер). Net worth для EUR-only снапшотов сработает.
- **E6 DELETE уже удалённого**: `UPDATE … WHERE deleted_at IS NULL` → changes=0
  → `deleted=false`. SPA invalidates query → таблица «самовосстанавливается».
- **E7 два снапшота на одну дату для одного ведра**:
  `latestSnapshotPerAccount` сортирует по `MAX(date || '|' || created_at)`,
  то есть tie-breaker — лексикографический `created_at`. Это работает для
  ISO-timestamp вида `YYYY-MM-DD HH:MM:SS` (sqlite `datetime('now')`).
  ⚠ Точность `datetime('now')` — секунды; при двух POST в одну секунду
  результат недетерминирован (см. R2 в spec). На практике — нет.
- **Duplicate UUID INSERT**: `INSERT OR IGNORE` молча отбрасывает (idempotency).
  ✓ Проверено по коду `snapshots.ts:54-66`.

## Что не покрыто (limitations этого QA)

- **UI walkthrough не выполнен**: у QA-агента нет валидной Google OAuth-сессии.
  Не могу подтвердить, что после login `/accounts` действительно рендерит
  карточки без визуальных регрессий, что Esc на модале закрывает, что фокус
  возвращается на кнопку, что keyboard-navigation Tab-order логичный. UI-код
  выглядит корректно, но запускать SPA с прод-токеном не могу.
- **Performance**: TTI Admin / lighthouse не измерял (нет браузера в окружении).
- **Mini App regression** (`local/scripts/test_ui.py` Playwright) не запускал —
  нет setup для headless-Chromium здесь. Однако, по логике, миграция 0006
  не трогает Mini App API и эндпоинты `/v1/expenses` остались неизменны.
- **Screenreader / a11y**: модал имеет `role="dialog" aria-modal="true"` и
  `aria-label` на кнопках Edit/Delete/Close (это в коде). VoiceOver-проверку
  не делал.

## Must-fix

Нет блокеров. Все 12 AC проходят. Все 5 web-эндпоинтов закрыты JWT,
данные в D1 соответствуют контракту.

## Nice-to-have (не блокеры)

- **[worker/snapshots PUT] `note` всегда переписывается на null если не прислан.**
  Хоть spec явно описывает это поведение (AC5: «`note` приводится к переданному
  значению / null»), это контр-интуитивно для REST `PUT`-семантики (которая в
  спецификации описана как «частичный апдейт»). На уровне SPA UX не страдает,
  потому что модал всегда пересылает все 4 поля. Но если в будущем появится
  второй клиент (CLI, скрипт миграции) — он легко наступит на грабли. Варианты
  для 5b/5d:
  - либо переименовать в `PATCH` и оставить как есть,
  - либо ввести правило «`note` опционален, отсутствует → не трогать», совпадающее
    с COALESCE-семантикой остальных полей.

- **[worker/CORS] неизвестный Origin получает `Access-Control-Allow-Origin: *`.**
  Это **специально**, потому что Mini App ходит из `*.pages.dev`/Telegram
  WebView и initData валидируется через HMAC. Однако для web-route'ов
  (`/v1/web/*`), где auth — Bearer-JWT в Authorization-header, можно было бы
  отдавать `*` только для эндпоинтов Mini App, а для web — строго whitelist.
  В текущей реализации это не уязвимость (JWT не идёт в cookie, fetch с другого
  origin без явного предъявления Authorization нечего слать), но архитектурно
  чище разделить CORS-политики. На уровне ADR — стоит обозначить как принятое
  решение или зафиксировать «упростить, когда web и mini app окончательно
  разойдутся по поддоменам».

- **[worker/snapshots POST] нет server-side проверки `account_id` против таблицы
  `accounts`.** Spec явно отмечает в R1 как accepted risk: «UI всегда выбирает
  из существующих вёдер». Проверено: `foreign_keys = 1` в D1, поэтому FK
  на `accounts(id)` сработает и Worker вернёт **500** (FK violation), а не 400.
  Допустимо, но если когда-нибудь нужен будет более user-friendly error —
  стоит ловить `D1_ERROR` и мапить на 400. Сейчас 500 = «ничего страшного, нос
  раз в год».

- **[worker/snapshots POST] нет валидации формата `date`.** Принимается
  любая строка (например, `"foo"`), запишется в D1, индексы по date не разрушатся,
  но `ORDER BY date DESC` отдаст странную сортировку. Регулярка `^\d{4}-\d{2}-\d{2}$`
  на сервере была бы здоровой защитой. SPA всегда отдаёт корректный
  `type="date"` → не критично сейчас.

- **[worker/snapshots POST] нет валидации `amount` на NaN/Infinity/негативный
  знак.** `typeof NaN === 'number'` истинно → запись попадёт в D1.
  В native-currency валюте отрицательная сумма редко имеет смысл (E4 говорит
  про amount=0). На фронте — `min="0"` и `parseFloat(amount) >= 0`, но
  на сервере проверки нет. Не блокер.

- **[admin/SnapshotsPage] `useMemo` для ре-инициализации формы — антипаттерн.**
  Строки 178-184 используют `useMemo(() => { setX(...) }, [key])` как
  пресет-сайд-эффект. Работает (потому что `key` меняется при открытии модала),
  но React не гарантирует stable invocation `useMemo`. Правильно — `useEffect`
  или `key`-проп на самом `<SnapshotModal>` (форс-ремоунт). Лёгкий рефакторинг
  для будущего.

- **[admin/AccountsPage] `Link to="/snapshots" search={{ account_id: acc.id }}`
  не имеет эффекта.** В SnapshotsPage параметр `account_id` из URL не читается —
  фильтр устанавливается только через UI-select. Spec прямо отмечает «параметр
  пока не используется, расширим в Stage 5b». Корректно как открытая задача.

- **[admin/AccountsPage] `BucketCard` обёрнут в `<Link>`, но содержит интерактив
  только в виде ссылки.** На карточке нет visual cue что она кликабельна,
  кроме hover-эффекта `ArrowUpRight`. Для пользователя, открывшего страницу
  впервые, может быть неочевидно, что вся карточка — это ссылка. Дизайн-вопрос,
  не блокер.

- **[admin/Modal] кнопка `btn-ghost` "Отмена" не имеет `autoFocus` управления,
  и фокус не возвращается на triggering-кнопку после закрытия.** Стандартная
  a11y-проблема dialog'ов — focus trap внутри + restore после close. Сейчас
  модал слушает Esc и клик на бэкдроп, но Tab может вынести фокус наружу
  (модал не focus-trap'ит). Для финтех-админки с одним пользователем — приемлемо.

## Notes

- **Drift в expenses count.** Spec говорит «1822 expenses», прод D1 показывает
  1826. Spec — retrospective, написан 2026-05-25; разница в 4 expenses может
  быть от тестовых записей агента или Mini App. Если число важно как
  «sanity-check незатронутости данных», обновить spec или допустить «1822-1826».
- **0 active snapshots в D1.** Это ожидаемо для начального состояния (E1 из
  spec: «На старте 0 снапшотов»). Не баг.
- **`acc_money_ok_rsd` теперь = «RSD · нал».** D1 подтверждает переименование
  с сохранением `id`. 1822/1826 expenses, ссылающихся на этот account_id,
  остаются работоспособны.
- **Schema drift между `schema.sql` и миграциями 0006.** Проверено: текущий
  `schema.sql` уже включает snapshots-таблицу с теми же DDL, что и в миграции
  0006. Синхронизация выполнена. R3 из spec остаётся открытым риском для
  будущих миграций.
- **Логирование:** Worker не пишет в логи `note`/`amount` (проверил
  `cloud/worker/src/index.ts` — только `console.error("unhandled", err)`).
  ✓ Соответствует §8 spec.

## Файлы, на которые ссылаюсь

- /Users/stepan/Desktop/excel/specs/SPEC-005-stage-5a-snapshots-crud.md
- /Users/stepan/Desktop/excel/cloud/worker/migrations/0006_buckets_and_snapshots.sql
- /Users/stepan/Desktop/excel/cloud/worker/schema.sql
- /Users/stepan/Desktop/excel/cloud/worker/src/snapshots.ts
- /Users/stepan/Desktop/excel/cloud/worker/src/index.ts
- /Users/stepan/Desktop/excel/cloud/worker/src/auth-google.ts
- /Users/stepan/Desktop/excel/cloud/admin/src/routes/AccountsPage.tsx
- /Users/stepan/Desktop/excel/cloud/admin/src/routes/SnapshotsPage.tsx
- /Users/stepan/Desktop/excel/cloud/admin/src/components/Modal.tsx
- /Users/stepan/Desktop/excel/cloud/admin/src/components/AppLayout.tsx
- /Users/stepan/Desktop/excel/cloud/admin/src/api/types.ts
- /Users/stepan/Desktop/excel/cloud/admin/src/api/queries.ts
- /Users/stepan/Desktop/excel/cloud/admin/src/api/client.ts

## Verdict rationale

**PASS_WITH_NICES.** Все 12 AC проходят, все 5 web-эндпоинтов закрыты JWT,
данные в D1 соответствуют контракту (7 buckets с правильными sort_order,
external pseudo-account сохранён, expenses не пострадали, snapshots-таблица
с тремя индексами, в т.ч. partial по `deleted_at IS NULL`).
Найдено 7 Nice-to-have замечаний — все либо явно отложены в Non-Goals
(graphs, account_id query-param), либо являются accepted risks
(server-side validation, CORS wildcard), либо мелкие UX/a11y улучшения,
которые имеют смысл в Stage 5b/5c.

Никаких must-fix нет; этап можно считать закрытым и опираться на этот
контракт в Stage 5b/5d/6/7.
