# SPEC-007 — QA audit

**Verdict:** PASS_WITH_SHOULDS
**Auditor:** senior-qa subagent
**Date:** 2026-05-25

## Summary

Stage 7 (Goals) реализован близко к спецификации. Worker и SPA полностью покрывают создание/перечисление целей, manual contributions, привязку incomes → goal, cascade-удаление, Net worth split. Auth, idempotency, индексы и батч-каскад выглядят корректно.

Однако **в UI отсутствуют две заявленные в SPEC §7 операции редактирования**: edit goal и edit contribution. Хук `useUpdateGoal` / `useUpdateContribution` экспортирован, но не привязан к каким-либо модалкам/обработчикам. Иконка `Pencil` импортирована в `GoalDetailPage.tsx`, но не отрисовывается. Спецификация явно показывает «[✎]» в header детализации и колонку «✎ 🗑» для manual-контрибуций. Это попадает в **Should-fix** (тест AC §9 формально не требует edit, но UI/UX-контракт §7 нарушен).

Остальные issues — minor: пропущенный goal_id query-filter в `/v1/web/incomes`, отсутствие validate enum status, отсутствие click-outside на меню Goal Detail, missing isError-стейты, и неиспользуемый `Pencil` импорт.

## Must-fix (M)

Нет блокеров релиза. Backend целостен, security корректен, AC §9 проходимы через curl + минимальные SPA-операции.

## Should-fix (S)

- **[admin/GoalDetailPage]** Нет Edit Goal модала. Спецификация §7 (line 391: `[✎]`) и §4.4 («Modal: создание/**редактирования** goal») требует возможность изменить name/emoji/color/target/deadline/note из UI. Сейчас единственный путь — `PUT /v1/web/goals/:id` через curl. **Импорт `Pencil` есть в `GoalDetailPage.tsx:3`, но JSX его не использует** — dead-import + явная сигнатура «работа не завершена».
- **[admin/GoalDetailPage]** Нет Edit Contribution UI. SPEC §7 (line 396, столбец `✎ 🗑`): для manual-контрибуций должна быть кнопка edit. Сейчас `ContribRow` (line 192–228) рендерит только Trash2 для manual. `useUpdateContribution` экспортирован в `queries.ts:251`, но никем не вызывается.
- **[admin/IncomesPage]** `GoalSelector` использует `useGoals("active")` (line 290). При **редактировании** income, который привязан к goal со статусом `achieved`/`archived`, цель **исчезнет** из dropdown — выбор покажется как «— не привязано —», и если пользователь нажмёт «Сохранить» без явного выбора цели, `goal_id` останется prev value на бэке (backend честно `COALESCE`, но визуально пользователь думает что отвязал). Решение: при `editing.goal_id !== null` подгружать также non-active или показывать orphan-опцию.
- **[worker/incomes]** `handleWebIncomesList` (index.ts:304) **не парсит** `goal_id` query-param, хотя `listIncomes` в `incomes.ts:35,46` поддерживает `goalId`. Сейчас фильтрация incomes по goal_id со стороны Admin невозможна (например, для будущей странички «по цели»).
- **[worker/goals]** `updateGoal` (goals.ts:288) биндит `patch.name ?? null` без `.trim()`. Создание (line 247) делает `payload.name.trim()`, обновление — нет. Inconsistent: можно записать `"   New name   "` через PUT. Должно быть `patch.name?.trim() ?? null`.
- **[worker/goals]** `listGoals` (goals.ts:138) **не валидирует** значение `opts.status`. `?status=foo` → SQL `WHERE status = 'foo'` → пустой массив. Должно быть 400 при неизвестном статусе (или whitelist).
- **[worker/goals]** `setGoalStatus` (goals.ts:312) выполняет UPDATE и возвращает `updated=false` если goal не существует. Этого достаточно, но лучше различать «not found» (404) и «no-op». Не блокер.
- **[admin/GoalsPage,GoalDetailPage]** Нет `isError`/`error` стейта. При 500 от Worker `GoalsPage` навсегда показывает skeleton + 0 целей, `GoalDetailPage` после загрузки покажет «Цель не найдена» (false negative — она существует, просто API упало). См. `useGoals`/`useGoalDetail` — `retry: false` нигде не отключён, но при сетевом сбое UI хрупкий.
- **[admin/GoalDetailPage]** Меню «···» (`menuOpen`, line 29, 72–93) **не закрывается** на клик вне меню или Escape. Нужен ref + listener `mousedown` + cleanup.
- **[admin/GoalDetailPage]** Кнопка `MoreVertical` имеет `aria-label="Меню"`, но dropdown без `role="menu"` / `role="menuitem"`. A11y: screenreader не объявит контекст.
- **[admin/GoalsPage]** Useesia `useMemo` для re-init form-state при `open` (line 187–192) — это **анти-паттерн**: `useMemo` для side effects. Гарантий нет, что React не вызовет повторно. Должно быть `useEffect`. В `GoalDetailPage.tsx:251` та же ошибка для ContributionModal. (В `IncomesPage.tsx:370` корректно через `useEffect` — есть inconsistency между файлами.)
- **[admin/AccountsPage]** Net worth split: `g.target_currency ? toEur(g.balance, g.target_currency) : g.balance` (line 31). Goal **без** `target_currency` (разрешено backend'ом, см. validateGoalPayload — required only when target_amount set) суммирует `g.balance` как EUR, что неверно если контрибуции были в RUB. Сейчас R3 в spec говорит «требуем target_currency на goal» — но backend не enforce'ит при создании goal без target_amount. Либо ужесточить backend (target_currency NOT NULL on goal), либо обрабатывать null в UI как EUR-эквивалент через какое-то soft-default.
- **[admin/GoalsPage,GoalDetailPage]** Прогрессбар отрендерен с min-width 2% (`Math.max(2, percent!)`), при balance=0 → визуальный полузалив, что некорректно. Должно быть `Math.max(percent!, 0)` + min-width только для percent > 0 (т.е. показывать совсем пустой бар как 0%).
- **[admin/GoalsPage]** Иконка `Currency` рисуется внутри `formatAmount` строки как `<Currency code={ccy} size="xs" />` (line 123). Это нарушает chunking числа — `Currency` рендерится JSX внутри text-node. Работает, но ассистивные технологии не услышат валюту вместе с суммой. Косметика.

## Nice-to-have (N)

- **[worker/goals.ts]** `listGoals` запрашивает все incomes и все contributions для всех goals в одном scan по `goal_id IN (...)` — это **2 query**, как и заявлено в spec OQ1. Хорошо. Однако `getGoalDetail` делает 2 отдельных query (incomes + contributions), мог бы UNION ALL для one round-trip. Microopt.
- **[worker/goals.ts]** `loadRates` (line 62) — sub-query coordinated подход. Для D1 не проблема при <50 валютах, но при росте можно кэшировать в `caches` API.
- **[admin/GoalsPage]** Selected-state цвета в picker'е (`border-foreground scale-110`) — нет фокус-индикатора (только outline по умолчанию). Дополнительная подсветка для keyboard nav желательна.
- **[admin/GoalsPage]** Палитра COLOR_PALETTE захардкожена (line 17), как и в AccountsPage. SPEC §7.4 («same set + добавим pastel») — текущие цвета не соответствуют пастельному набору из accounts.
- **[admin/GoalsPage]** При AC E2 (overdue): подпись «до DD.MM.YYYY» становится красной, но deadline-text дублирует formatDate. Не сказано «просрочено» (`overdue` шильдик), как требует SPEC §7 (line 376: «Overdue (deadline < today) — красная подпись»). Только в GoalDetailPage есть текст «просрочено на N дн.».
- **[admin/IncomesPage]** Таблица доходов не показывает иконку goal у row, даже если `goal_id != null`. Полезно при scrollthrough, не блокер.
- **[admin/GoalsPage]** В IncomeModal goal-селект не учитывает emoji + color goal'а в выпадающем списке (только emoji). Минорно.
- **[worker/goals.ts]** Status enum обновляется через `setGoalStatus` — нет проверки FK на самой колонке (CHECK status IN ('active','achieved','archived')). Если кто-то напрямую через SQL поставит произвольный — UI получит unknown. Не блокер.
- **[admin]** Нет confirm-modal с типизированной строкой для DELETE goal (`confirm()` native) — UX downgrade для destructive action. SPEC не требует, но best practice.
- **[admin/GoalsPage]** Создание новой цели — модал не позволяет указать `sort_order`. Spec §5 заводит колонку, но не использует.

## Acceptance criteria

| AC | Verdict | Доказательство |
|----|---------|---------------|
| AC1: миграция 0008 применима, COUNT=0 после | **PASS** | `migrations/0008_goals.sql` создаёт обе таблицы + `ALTER TABLE incomes ADD COLUMN goal_id` (line 50) + индексы. `schema.sql` синхронизирован (lines 115, 124, 127–159). |
| AC2: `GET /v1/web/goals` пустой → empty array (Bearer) | **PASS** | `handleWebGoalsList` (index.ts:352) требует `requireAdminSession`, `listGoals` (goals.ts:132) возвращает `[]` если нет результатов. |
| AC3: POST happy path → inserted=true | **PASS** | `createGoal` (goals.ts:236) делает `INSERT OR IGNORE` + возвращает `inserted: changes > 0`. |
| AC4: POST без name → 400 | **PASS** | `validateGoalPayload` (goals.ts:88) проверяет `!name || !name.trim()` → `{ ok: false, error: "name is required" }`. |
| AC5: target_amount=0 или отриц. → 400 | **PASS** | goals.ts:90: `target_amount <= 0` → 400 "target_amount must be positive". Также SQL CHECK constraint в схеме. |
| AC6: target_amount без target_currency → 400 | **PASS** | goals.ts:93–95: required check. |
| AC7: unknown target_currency → 400 | **PASS** | goals.ts:97–99 проверяет `currencyExists`. |
| AC8: GET с balance=0, contribution_count=0 для пустой цели | **PASS** | listGoals аккумулятор инициализирует `{sum:0, missing:0, count:0}` (goals.ts:163) и возвращает их для каждого goal без contributions. |
| AC9: POST contribution → balance пересчитан | **PASS** | `createContribution` (goals.ts:337) + listGoals агрегирует через `aggregate(contribRows)` (goals.ts:178). |
| AC10: POST income c goal_id → balance включает amount | **PASS** | `createIncome` (incomes.ts:84) валидирует и пишет `goal_id`; listGoals агрегирует `incomeRows` (goals.ts:177). |
| AC11: POST income с unknown goal_id → 400 | **PASS** | `validateGoalRef` (goals.ts:409) + handler пробрасывает в 400 (index.ts:325–326). |
| AC12: PUT income может set/clear goal_id | **PASS** | `updateIncome` (incomes.ts:120–122, 127, 140, 151) — `hasGoal` через `hasOwnProperty`, корректно различает «не передано» vs «null». |
| AC13: POST /:id/status меняет; GET ?status=active исключает | **PASS** | `setGoalStatus` + listGoals фильтр по status. **WARN**: status валидируется в setGoalStatus (goals.ts:309), но `listGoals` не валидирует — см. Should-fix. |
| AC14: DELETE → soft-delete + detach incomes + soft-delete contributions | **PASS** | `deleteGoal` (goals.ts:319–333) выполняет batch из 3 statements, возвращает counts. |
| AC15: /goals показывает только active по умолчанию | **PASS** | `useGoals(status)` default `"active"` (queries.ts:165), GoalsPage initial state `"active"` (GoalsPage.tsx:25). |
| AC16: goal без target_amount → только баланс | **PASS** | GoalsPage.tsx:118–138: ветка `hasTarget ? ... : <div className="mt-4 text-xl">{balance}</div>`. |
| AC17: deadline < today → красный «просрочено» | **PASS (с N)** | GoalsPage.tsx:97: overdue добавляет `text-destructive` + AlertCircle. Detail page добавляет text «просрочено на N дн.». GoalCard не пишет слово «просрочено» — см. Nice-to-have. |
| AC18: Net worth = Свободно + Целевые, sum совпадает | **PASS (с S)** | AccountsPage.tsx:30–34. Сумма математически равна Total (т.к. freeEur=Total-targeted). **WARN**: goal без target_currency может ломать конверсию (см. Should-fix). |
| AC19: IncomeModal «Цель» loads from useGoals(active) | **PASS** | IncomesPage.tsx:289–298 (GoalSelector). |
| AC20: Регрессия Stage 6 — incomes без goal_id | **PASS** | `createIncome` принимает `goal_id?` optional (incomes.ts:22), `INSERT` пишет `null` если не передан. Существующие incomes имеют `goal_id IS NULL` после `ALTER TABLE`. `listIncomes` возвращает `goal_id` в SELECT (line 39). |
| AC21: Регрессия 4/5a — /accounts /snapshots /expenses /dashboard | **PASS** | Прочие routes не тронуты (см. AccountsPage — только добавлен goalsData). |

**Итого AC §9: 21/21 PASS (3 с предупреждениями WARN).**

## Edge cases

| EC | Verdict | Замечание |
|----|---------|-----------|
| E1: goal без target_amount → no progressbar | **PASS** | GoalsPage.tsx:118 (else-ветка), GoalDetailPage.tsx:134. |
| E2: deadline < today, статус active → «просрочено» | **PASS (с N)** | Реализовано; UI можно улучшить (см. AC17). |
| E3: DELETE goal → incomes.goal_id=NULL, contributions soft-deleted | **PASS** | goals.ts:323–327 (batch). |
| E4: Currency mismatch (income EUR, goal RUB) → конверсия по rates | **PASS** | listGoals + getGoalDetail используют `convertVia` (goals.ts:76). `balance_missing_rates` инкрементируется если курс отсутствует. **Внимание**: спец говорит «отображается оригинальная сумма + конвертация в таймлайне» — `getGoalDetail` возвращает original amount+currency_code, но не считает конвертированное значение per-row для UI. UI (`ContribRow`) показывает только оригинал — конвертация per-row не показана. Не баг (spec не требует жёстко), но UX gap. |
| E5: target_amount=0 → 400 | **PASS** | goals.ts:90 + SQL CHECK. |
| E6: deadline в прошлом при создании → разрешено + warning | **PARTIAL** | Backend разрешает (validateGoalPayload ничего не проверяет про прошлое). UI **не показывает warning** при создании — только overdue indicator при отображении. Minor. |
| E7: пустое name → 400 | **PASS** | goals.ts:88. |
| E8: курс отсутствует → original + counter «N без курса» | **PASS** | `balance_missing_rates` (goals.ts:174, 181). UI показывает amber-counter (GoalsPage.tsx:152, GoalDetailPage.tsx:151). |

## Регрессии

- **Stage 6 (incomes без goal_id)** — `incomes.ts:84` создаёт income с `goal_id=null` корректно. `validateGoalRef(env, null)` возвращает `{ ok: true }` (goals.ts:410). Existing incomes из тест-данных (если есть) получают `goal_id=null` после ALTER TABLE — это PASS. Поле `goal_id` добавлено в SELECT (incomes.ts:39) — старые SPA-страницы не сломаются, т.к. TypeScript интерфейс `Income` уже включает `goal_id: string | null` (types.ts:113).
- **Stage 5a (snapshots, accounts)** — AccountsPage обогащена, но не сломана; SnapshotsPage не тронут.
- **Stage 4 (expenses, dashboard)** — не тронуты.
- **Mini App** — миграция 0008 безопасна (только ADD COLUMN); endpoints `/v1/bootstrap`, `/v1/expenses` не изменены. `INSERT INTO expenses` не упоминает goal_id.
- **Routes** — `routeTree.tsx:74–78` корректно добавляет `/goals` + `/goals/$goalId` под authed wrapper. **WARN**: путь `/goals` идёт после `/goals/$goalId` в `addChildren` (line 82) — TanStack Router использует priority/specificity, не порядок, так что работает корректно, но конвенционально лучше в порядке specificity.
- **AppLayout sidebar** — `/goals` добавлен между «Доходы» и «Обмены» (line 20), согласно SPEC §7.6.

## Auth (security checklist)

- **JWT requirement** — все 9 handlers (`handleWebGoals*`, `handleWebContributions*`) первой строкой делают `requireAdminSession`. PASS.
- **CORS** — централизованно через `cors.ts` (line 88–93). Не модифицировался. PASS.
- **Mini App не имеет доступа к goals** — нет endpoint'а `/v1/goals` (только `/v1/web/goals`). Mini App использует initData, не Bearer. PASS.
- **CSRF** — POST/PUT/DELETE требуют Bearer header, не cookie. PASS.
- **PII в логах** — `console.log("scheduled rates: saved ...")` и `console.error("unhandled", err)` — goals/contributions не логируют поля. PASS.
- **Input validation** — name trim+non-empty, target_amount>0, currency FK, account FK, goal FK, date ISO regex, color hex regex. Note: emoji **не валидируется** на backend (UI limit 4 chars). Не критично, защищено max-length в UI и низким blast radius. PASS.

## Performance

- **N+1 queries** — `listGoals`: 1 query на goals + 1 loadRates + 1 query incomes IN (ids) + 1 query contributions IN (ids) = 4 query total для N goals. PASS (как заявлено в SPEC OQ1).
- **Index coverage**:
  - `idx_goals_active` (goals.ts schema:143) — WHERE deleted_at IS NULL ORDER BY status, sort_order. PASS.
  - `idx_goal_contribs_goal`, `idx_goal_contribs_active` (lines 157–159) — GROUP BY goal_id. PASS.
  - `idx_incomes_goal` (line 124) — IN (...) lookup. PASS.
- **getGoalDetail**: 1 query goal + 1 loadRates + 1 query incomes + 1 query contributions = 4. PASS.
- **TanStack Query staleTime** — goals: 30s, goalDetail: 30s. Адекватно.
- **Aggregate sort in JS** — для N<1000 contributions per goal приемлемо.

## A11y

- **Goal card** — `<Link>` оборачивает всю карточку (semantic, кликабельна с keyboard). PASS.
- **Tabs (segmented control)** — `aria-pressed` (GoalsPage.tsx:51). PASS.
- **Color picker buttons** — `aria-label={`Цвет ${c}`}` (line 271). PASS.
- **Modal** — `role="dialog"` + `aria-modal="true"` + Escape-close (Modal.tsx:39–40). PASS.
- **Меню «···»** — `aria-label="Меню"` есть, но dropdown без `role="menu"`. См. Should-fix.
- **Прогрессбар** — нет `role="progressbar"` + `aria-valuenow/valuemax`. SR не объявит прогресс. См. Should-fix.
- **Hidden Pencil** — dead import не вредит, но указывает на незавершённость.

## Open questions

- **Q1 (UI completeness):** Спецификация §7 предполагает edit-модалы для goal и contribution. Сейчас они не реализованы. Это намеренный partial scope (ship MVP без edit) или гэп? AC §9 формально проходит, но §7 явно показывает edit-affordance. Рекомендую spec-update с «Edit moved to Stage 7.1» либо доделать перед merge.
- **Q2 (target_currency optional):** SPEC R3 говорит «target_currency required при создании goal даже без target_amount». Backend не enforce'ит. Решение: добавить check `if (!payload.target_currency) return { error: "target_currency required" }` в `validateGoalPayload`, или принять текущее nullable и обработать в UI (AccountsPage сейчас может суммировать heterogeneous currencies в EUR).
- **Q3 (Net worth math when contributions in mixed currencies):** Если goal имеет `target_currency=RUB`, а contribution в EUR — `convertVia` пересчитает в RUB через текущие rates. При следующем обновлении rates `balance` будет другим. Это R1 в SPEC, но в UI Net worth split тоже «дрейфует». Пользователь должен это знать — нужен tooltip / disclaimer в UI?
- **Q4 (Test coverage):** Playwright-тестер (`local/scripts/test_ui.py`) не запущен в рамках этого аудита. Манульный walkthrough рекомендуется до push. Curl-смоук возможен против локального wrangler dev — не выполнялся (нет доступа к env).
- **Q5 (Idempotency clash):** Если frontend генерит `id` для goal/contribution и retry'ит POST — `INSERT OR IGNORE` корректно возвращает `inserted=false`. Тест не покрыт явно в spec §10.

---

**Рекомендация**: блокировать push не нужно, но **Should-fix #1 (Edit Goal modal) и #2 (Edit Contribution row)** желательно зафиксировать перед merge либо явно вынести в SPEC-007.1. Остальные Should-fix не критичны и могут пойти отдельным PR.
