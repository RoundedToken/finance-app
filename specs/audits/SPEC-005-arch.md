# Architecture Review: SPEC-005 Stage 5a — Snapshots CRUD
date: 2026-05-25
verdict: APPROVED_WITH_NICES

## Summary

Реализация Stage 5a соответствует спецификации и ADR-005 / ADR-011 / ADR-012.
SQL параметризирован, soft-delete консистентен, JWT-гард корректно покрывает
все 5 web-эндпоинтов, INSERT OR IGNORE по UUID идиоматичен для snapshots
(совпадает с семантикой expenses). Серьёзных must-fix не выявлено, но
есть один **функциональный bug в модальном окне** (использован `useMemo`
с side-effects вместо `useEffect`/`useState`-key), а также набор nice-to-have
улучшений: явная серверная валидация `account_id`/`amount<0`/`date`-формата,
типобезопасность результата D1-запросов, потенциальный indexing-gap для
`latestSnapshotPerAccount` и схема логирования input-валидации.

---

## 🔴 Must-fix (CHANGES_REQUESTED)

Нет блокеров для merge.

---

## 🟡 Nice-to-have

### NTH-1. [admin] `SnapshotsPage.tsx:179-184` — `useMemo` для side-effects вместо `useEffect`

Код:
```tsx
const key = `${open}-${editing?.id ?? "new"}`;
useMemo(() => {
    setDate(editing?.date ?? todayISO());
    setAccountId(editing?.account_id ?? accounts[0]?.id ?? "");
    setAmount(editing ? String(editing.amount) : "");
    setNote(editing?.note ?? "");
}, [key]);
```

**Почему это смущает.** `useMemo` не предназначен для side-effects (вызовов
сеттеров стейта). React 19 в строгом режиме может пере-выполнить factory
несколько раз (StrictMode / concurrent rendering / dropped cache), и каждое
выполнение будет дёргать 4 сеттера — это лишние ре-рендеры и нарушение
React-контракта. Возвращаемое значение `useMemo` отбрасывается.

**Наблюдаемые последствия в текущем коде.** Сейчас выглядит «работает»
потому что:
- Модал создаётся условно: `{open && <SnapshotModal ... />}` — нет, на самом
  деле модал монтируется всегда (см. `Modal.tsx:27` — `if (!open) return null`,
  но **сам компонент `SnapshotModal` остаётся примонтированным** через
  цикл рендера `SnapshotsPage`).
- При смене `key` factory выполняется → state сбрасывается → правильное
  поведение. Но это **в принципе** undocumented для useMemo.

**Что лучше.** Самый идиоматичный React 19 паттерн:
```tsx
function SnapshotModal({ open, editing, accounts, onClose, onSubmit }: SnapshotModalProps) {
    return open ? (
        <SnapshotModalForm
            key={editing?.id ?? "new"}
            editing={editing}
            accounts={accounts}
            onClose={onClose}
            onSubmit={onSubmit}
        />
    ) : null;
}
```
И в `SnapshotModalForm` инициализировать стейт **в `useState`-инициализаторе**
(`useState(() => editing?.date ?? todayISO())`). При смене key React сам
размонтирует и заново смонтирует компонент с правильным начальным стейтом —
никаких `useMemo`/`useEffect` для синхронизации не нужно.

Альтернатива (минимально-инвазивная): заменить на `useEffect`:
```tsx
useEffect(() => {
    setDate(editing?.date ?? todayISO());
    setAccountId(editing?.account_id ?? accounts[0]?.id ?? "");
    setAmount(editing ? String(editing.amount) : "");
    setNote(editing?.note ?? "");
}, [open, editing?.id]);
```

Это не блокер (текущий код кажется работает в проде), но это технический
долг и потенциальный источник трудно-уловимых багов при включении
StrictMode или будущих апгрейдах.

---

### NTH-2. [worker] `snapshots.ts:33-50` `latestSnapshotPerAccount` — индекс используется неоптимально

Запрос:
```sql
SELECT s.account_id, s.id, s.date, s.amount
FROM snapshots s
JOIN (
  SELECT account_id, MAX(date || '|' || created_at) AS mx
  FROM snapshots
  WHERE deleted_at IS NULL
  GROUP BY account_id
) m ON m.account_id = s.account_id AND m.mx = s.date || '|' || s.created_at
WHERE s.deleted_at IS NULL
```

**Проблемы.**

1. `MAX(date || '|' || created_at)` — **строковая конкатенация** теряет
   возможность использовать индекс `idx_snapshots_account_date`
   (на `account_id, date`). D1/SQLite сделает full-scan по таблице.
   Для текущего scale (десятки снапшотов) — незаметно. На сотнях — тоже
   ок. На тысячах — начнёт замедляться.

2. Tie-breaker `date || '|' || created_at` корректен только пока
   `created_at` всегда формата YYYY-MM-DD HH:MM:SS (лексикографически
   сортируем = хронологически). Это так и есть (`datetime('now')`),
   но это unstated invariant.

3. R2 в spec'е признаёт «недетерминированность при одинаковом
   created_at» — миллисекундная точность в D1 действительно отсутствует,
   `datetime('now')` округляет до секунд.

**Альтернатива (используя индекс).** Window-function:
```sql
SELECT id, account_id, date, amount FROM (
    SELECT id, account_id, date, amount,
           ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY date DESC, created_at DESC) AS rn
    FROM snapshots
    WHERE deleted_at IS NULL
) WHERE rn = 1
```

D1/SQLite поддерживает window-functions с 3.25+ (это в Cloudflare D1 точно
работает). План будет использовать `idx_snapshots_account_date` через
PARTITION BY.

**Вердикт.** Откладываем в backlog; перевести при появлении графиков
балансов (Stage 5b) когда query начнёт вызываться чаще.

---

### NTH-3. [worker] `index.ts:226` — нет валидации `amount < 0`, `account_id`-существования, формата `date`

Текущая проверка в `handleWebSnapshotsCreate`:
```ts
if (!body.date || !body.account_id || typeof body.amount !== "number") {
    return json({ error: "date, account_id, amount are required" }, 400, ...);
}
```

**Что пропускается:**
- `amount = NaN` (typeof "number" true) → попадёт в D1 как NaN/NULL.
- `amount = -50` — spec в E4 говорит «0 валиден», но не оговаривает отрицательные.
  С учётом того что снапшот = текущий баланс ведра, отрицательные имеют смысл
  только для кредитного ведра (которого пока нет). Сейчас принимается.
- `date = "abracadabra"` — попадёт в D1 как TEXT, JS-side сломается при
  парсинге в `new Date(...)`.
- `account_id = "nonsense"` — упирается в FK при INSERT, вернёт 500 (как
  явно зафиксировано в R1).
- `note = очень-длинный-текст` — нет ограничения длины.

**Spec ADR.** В spec'е (Section 8 и R1) явно зафиксировано: «достаточно
для UI, который сам выбирает из существующих вёдер». Это осознанное
решение, поэтому **не must-fix**.

**Рекомендация (nice).** Добавить тонкий слой Zod на boundary:
```ts
const SnapshotCreate = z.object({
    id: z.string().uuid().optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    account_id: z.string().min(1),
    amount: z.number().finite(),
    note: z.string().max(2000).nullable().optional(),
    source: z.string().max(50).optional(),
});
```
Это даст 400 вместо 500 для невалидных payload'ов и закроет публичную
поверхность атак (для уже-аутентифицированных, но всё равно polite).

Аналогичный комментарий — для `handleWebSnapshotsUpdate`: сейчас
никакой validation вообще нет, можно прислать `{ "date": null }` и
оно отработает no-op (COALESCE), что ок, но симметрии с create-схемой
нет.

---

### NTH-4. [worker] `snapshots.ts:19,29,33,96,103` — `any[]` и `as any[]` без объяснения

`listSnapshots` и `listBuckets` возвращают `Promise<any[]>`. Учитывая что в
`api/types.ts` уже есть `Snapshot` и `Account` интерфейсы — стоило бы их
переиспользовать. У snapshot есть лёгкий nuance (там нет `latest_snapshot`-полей
из enriched account), но `Snapshot` тип в admin/api/types подходит 1:1.

Чеклист агента требует «`any` без explicit-комментария» — здесь это
неоправданно. Сделать:
```ts
import type { Snapshot } from "./types"; // или local interface
export async function listSnapshots(...): Promise<Snapshot[]> { ... }
```

Аналогично в `latestSnapshotPerAccount` уже есть generic `all<{...}>` —
красиво, и стоит распространить тот же стиль на остальные функции.

---

### NTH-5. [worker] `index.ts:111-114` — `String(err)` в response утечка детали

```ts
} catch (err) {
    console.error("unhandled", err);
    return json({ error: String(err) }, 500, request, env);
}
```

`String(err)` для FK violations / SQL parse-ошибок может содержать
`UNIQUE constraint failed: snapshots.id` или путь к D1 internals.
Для admin-аудитории (только владелец через JWT) это not critical,
но **в публичный repo выкладывается** — стоит зачистить:

```ts
} catch (err) {
    console.error("unhandled", err);
    return json({ error: "internal error" }, 500, request, env);
}
```

Контекст ошибки уже логируется через `console.error` в Worker logs
(их видит только owner через `wrangler tail`).

---

### NTH-6. [admin] `SnapshotsPage.tsx:188` — `parseFloat(amount) >= 0` пропускает NaN

```ts
const valid = !!date && !!accountId && parseFloat(amount) >= 0;
```

Если `amount = "abc"`, `parseFloat("abc") = NaN`, `NaN >= 0 === false` — ок.
Но если `amount = ""`, `parseFloat("") = NaN` — тоже false, ок. Действительно
работает, но запутанно. Чище:
```ts
const amountN = parseFloat(amount);
const valid = !!date && !!accountId && Number.isFinite(amountN) && amountN >= 0;
```

---

### NTH-7. [admin] `AccountsPage.tsx:22-25` — `useMemo` deps включают `rates` без `toEur`

```tsx
const totalEur = useMemo(
    () => accounts.reduce((s, a) => s + (a.latest_snapshot ? toEur(a.latest_snapshot.amount, a.currency) : 0), 0),
    [accounts, rates],
);
```

`toEur` — closure, captures `rates`. Линтер `react-hooks/exhaustive-deps`
обычно ругается на это (или не ругается, если `toEur` определена внутри
компонента, и тогда нужно `[accounts, toEur]`). На практике работает,
но ESLint warning будет.

Минимум — вынести `toEur` в `useCallback` или сделать lambda inline.

---

### NTH-8. [admin] `AccountsPage.tsx:79` — `search={{ account_id: acc.id } as any}`

`as any` на `search`-параметр Link'а. Spec явно говорит «параметр пока не
используется на `/snapshots`, ссылка ведёт на список — расширим в Stage 5b».
Когда расширим — описать `search` schema в `accountsRoute.validateSearch`
от TanStack Router, тогда `as any` уйдёт.

Технический долг — в backlog Stage 5b.

---

### NTH-9. [admin] `Modal.tsx:42` — отсутствует `aria-labelledby`/`aria-describedby`

`role="dialog"` + `aria-modal="true"` есть, но `aria-labelledby` указывающий
на `<h2>` отсутствует. Для скрин-ридера диалог не озвучит title корректно.
Минимум:
```tsx
<h2 id="dialog-title" className="...">{title}</h2>
// и
<div role="dialog" aria-modal="true" aria-labelledby="dialog-title">
```
(или генерировать уникальный id через `useId()`).

Не блокер, но a11y-чеклист в process.md упоминает ARIA.

---

### NTH-10. [admin] `SnapshotsPage.tsx:45` — `confirm()` в браузере

```ts
if (!confirm(`Удалить снапшот?\n${acc?.name ?? s.account_id} ...`)) return;
```

`window.confirm` блокирует event loop и не поддаётся стилизации. В spec'е
явно зафиксировано «browser confirm», поэтому не претензия. В Stage 5b/6
стоит переехать на `<ConfirmDialog>` через тот же `Modal` — будет
консистентнее с create/edit modal.

В backlog.

---

## ✅ What's good

1. **SQL параметризация.** Все запросы в `snapshots.ts` используют `.bind(...)`.
   Никакой конкатенации user-input в SQL. Проверено в:
   - `snapshots.ts:24-25` — динамический WHERE для `from`/`accountId`
     собирается из фиксированных строк-фрагментов, а значения через `params.push()`.
   - Все UPDATE/INSERT — bind по позиции.

2. **`INSERT OR IGNORE` идемпотентность.** `createSnapshot` берёт client-side
   UUID если есть, иначе генерит `crypto.randomUUID()`. Это в полном
   соответствии с ADR-005. Возврат `{ id, inserted }` позволяет клиенту
   понять, был ли это реальный insert или повтор.

3. **Soft-delete консистентен.** `deleted_at IS NULL` присутствует в:
   - `listSnapshots` (read)
   - `latestSnapshotPerAccount` (read, в обоих под-запросах outer и inner)
   - `updateSnapshot` (нельзя редактировать удалённый)
   - `deleteSnapshot` (повторный delete возвращает `deleted=false`, не fail)
   - `listBuckets` (фильтр soft-deleted accounts)

   Все 5 точек прохода snapshots через soft-delete покрыты. Хорошо.

4. **Авторизация на mutating endpoints.** Все 5 web-эндпоинтов
   (`GET/POST /v1/web/accounts`, `GET/POST/PUT/DELETE /v1/web/snapshots`)
   защищены `requireAdminSession` first thing в handler'е. Mini App
   initData **не принимается** для этих путей — отдельная auth-схема,
   как требует ADR-012.

5. **Композиция `Promise.all([listBuckets, latestSnapshotPerAccount])`.**
   В `handleWebAccounts` (`index.ts:203`) — две независимые query
   запускаются параллельно. Маленькая, но правильная оптимизация для
   CPU-budget в free-tier Workers.

6. **React Query invalidation корректна.** В `queries.ts` все три
   мутации (`useCreateSnapshot`, `useUpdateSnapshot`, `useDeleteSnapshot`)
   инвалидируют **обе** queryKeys: `["snapshots"]` и `["accounts"]` —
   это обязательно, потому что `/v1/web/accounts` содержит `latest_snapshot`,
   который меняется при любой мутации snapshots. Без `["accounts"]`
   карточки на `/accounts` бы stale-нились.

7. **`form != 'external'` фильтр.** `listBuckets` правильно скрывает
   legacy `external` pseudo-account, не уничтожая историю expenses на нём.
   Это решает AC2 и Non-Goal NG4.

8. **Schema snapshot обновлён.** `cloud/worker/schema.sql:78-92` содержит
   `snapshots` table и индексы, синхронно с миграцией `0006`. Колонки
   `form`, `sort_order`, `deleted_at` в `accounts` тоже отражены
   (`schema.sql:20-22`). Правило ADR-013 / CLAUDE.md #2 соблюдено.

9. **Index `idx_snapshots_active_date` — partial index** с предикатом
   `WHERE deleted_at IS NULL` (`0006_buckets_and_snapshots.sql:54`).
   Это оптимально для горячего пути `listSnapshots` который фильтрует
   soft-deleted.

10. **Типы зеркалированы.** `cloud/admin/src/api/types.ts:41-50` содержит
    `Snapshot`-интерфейс, поля совпадают с D1-схемой. Если в будущем
    кто-то добавит колонку в snapshots — тип будет needing-update, что
    хорошо видно.

11. **TTL JWT 30 дней + `isExpired` client-side check.** `routeTree.tsx:26-31`
    делает `beforeLoad` redirect на /login если токен expired — pleasant UX,
    не дожидаемся 401 от сервера.

12. **Никаких новых secrets в repo.** Проверены `snapshots.ts`, `index.ts`,
    SPA-файлы: ни Google client_secret, ни JWT secrets, ни Telegram token —
    всё в `env`. CLAUDE.md правило 5 соблюдено.

---

## 📐 ADR-conformance

- **ADR-005 (UUID на клиенте + INSERT OR IGNORE):** ✓
  - `snapshots.id` TEXT PRIMARY KEY (`0006:41`)
  - `createSnapshot` использует `crypto.randomUUID()` если клиент не прислал id
    (`snapshots.ts:53`)
  - `INSERT OR IGNORE` идемпотентно
  - Spec явно опирается на это в Section 6 (POST `inserted=true/false`)

- **ADR-011 (D1-centric):** ✓
  - Никаких новых локальных SQLite-файлов или sync-скриптов в `local/`
  - Snapshots живут только в D1 (миграция 0006)
  - SPA читает через Worker, никакого прямого доступа к D1

- **ADR-012 (Web Admin / OAuth):** ✓
  - JWT через `requireAdminSession` на всех `/v1/web/*` (включая 5 новых)
  - `ADMIN_ALLOWED_EMAILS` allowlist валидируется в `isAllowedEmail`
  - Mini App endpoints (`/v1/expenses` и т.д.) **не** изменены — scope
    Mini App ограничен расходами, как требует ADR
  - Snapshots **не** доступны через initData auth

- **ADR-009 (silent bot):** ✓ (вне scope этого SPEC'а, но проверено —
  bot.ts не изменён, fallback'ов для unauthorized нет)

---

## 🔒 Security findings

- **Auth.** Все mutating endpoints (POST/PUT/DELETE snapshots) защищены
  Bearer JWT через `requireAdminSession`. Проверено в `index.ts:222,234,243`.
- **SQL injection.** Не обнаружено — все queries параметризованы через
  `.bind()`. Динамические WHERE-фрагменты собираются из const-строк,
  значения подаются параметрами.
- **Authorization scope.** Снапшоты не привязаны к `user_id` (как expenses).
  Это **корректно** для admin-only пространства: токен подтверждает
  владельца через `ADMIN_ALLOWED_EMAILS`, разделение по user'ам не нужно.
  Если в будущем появится multi-tenant — потребуется добавить колонку.
- **CORS.** Для admin Worker возвращает Origin строго из `ADMIN_ALLOWED_ORIGINS`
  (`index.ts:320-330`), для остальных — `*` (что ок для Mini App с HMAC,
  но **`jsonResponse` в `auth-google.ts:188-197` всегда ставит
  `Access-Control-Allow-Origin: *`** — это потенциальный leak header'ов
  для admin-сессии. Не приоритет, но в backlog.).
- **Информация в ошибках.** `String(err)` в `index.ts:113` может утечь
  D1-detail. См. NTH-5.
- **PII в логах.** В snapshots-handlers нет `console.log` сумм или `note` —
  чисто. В `auth-google.ts:93` логируется email при denied login — это
  ok (это admin audit trail).
- **Note field XSS.** В SnapshotsPage.tsx note рендерится через
  `{s.note}` — React по умолчанию escape'ит, XSS невозможен. Хорошо.

---

## 📦 Technical debt notes

Сознательно оставлено в коде (зафиксировать в backlog):

1. **R1 в spec'е**: account_id не валидируется на сервере. Принято
   как trade-off (UI выбирает из существующих вёдер). См. NTH-3.

2. **R2 в spec'е**: latest snapshot tie-breaker по `created_at` с
   секундной точностью — недетерминирован при идентичной секунде.
   Stage 5b может потребовать `inserted_seq INTEGER`. См. NTH-2.

3. **R3 в spec'е**: `schema.sql` сейчас синхронизирован с `migrations/`,
   но это ручная работа. Митигируется правилом из CLAUDE.md #2.

4. **OQ1 в spec'е**: два снапшота за одну дату для одного ведра разрешены.
   Если станет проблемой — UNIQUE(account_id, date) в Stage 5b.

5. **`useMemo` для side-effects** в `SnapshotsPage` (NTH-1) — функциональный
   smell, но **видимо работает** в текущем React 19. При следующем
   touching этого компонента — переделать на `key`-pattern или `useEffect`.

6. **`any[]` в return types** worker-функций (NTH-4) — закрыть при
   следующем touch.

7. **`confirm()` для delete** (NTH-10) — в backlog Stage 5b/6, заменить
   на стилизованный ConfirmDialog.

8. **a11y `aria-labelledby` в Modal** (NTH-9) — для accessibility-pass.

---

## Итог

- Verdict: **APPROVED_WITH_NICES**
- Must-fix: 0
- Nice-to-have: 10 (см. выше)
- Spec coverage: 100% (все G1-G6, все AC1-AC12 покрыты кодом)
- ADR coverage: 4/4 проверенных ADR соблюдены
- Push: можно делать сразу. Nice-to-have — в roadmap Tech debt / в Stage 5b.
