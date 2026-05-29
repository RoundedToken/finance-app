# Стратегическое ревью MVP · Стадия 1

> Дата: 2026-05-28. Метод: 8 независимых линз-ревьюеров на реальном коде + adversarial-верификация каждой `critical`/`high` находки (15 агентов, ~1.1M токенов). Severity в этом документе — **уточнённая после верификации**, а не сырая от ревьюера.
>
> Назначение документа: письменный эталон для **Стадии 2 (глубокий рефакторинг)** перед объявлением MVP завершённым и переходом в post-MVP.

---

## Вердикт

**Все 8 линз → `ready-with-caveats`. Подтверждённых `critical` — ноль. Реальных security-блокеров — ноль.** Единственная находка, пережившая верификацию на уровне `high` — противоречие в ADR (документация, не код).

**Решение: green light на Стадию 2.** Ядро системы (архитектура, два auth-канала, canonical-конвертация валют, math-consistency SPEC-011) сделано добротно. То, что мешает честно сказать «MVP завершён» — это не баги, а: (а) дрейф документации, (б) горстка осознанных, но не закрытых решений в финансовой модели, (в) один продуктовый вопрос про Mini App (решён — см. ниже).

---

## Решения по развилкам (приняты 2026-05-28)

1. **Mini App scope сужается до «только ввод расходов».** Аналитика расходов живёт только в Web Admin. Phase 2 аналитики в Mini App (SPEC-014) → post-MVP backlog. Привести CLAUDE.md (правило 11) и architecture.md в соответствие.
2. **Финансовую модель ужесточаем по корректности:** overdraft на expenses + явная семантика same-day snapshot — закрыть кодом; `fee` — учитывать в балансе (или убрать поле как мёртвое).
3. **Деньги остаются `REAL`** + систематическое округление native-балансов на выдаче + отдельный ADR с границами риска. **Dinero.js — удалить** (установлен, не используется). **Zod — внедрить** как серверную валидацию и единый источник контракта worker↔admin.
4. **Мобильный ввод дохода/снапшота/обмена** — post-MVP план (лёгкая text-команда в боте), не MVP-scope. Зафиксировать как осознанный текущий non-goal.

---

## Прогресс Стадии 2

- **Batch A (доки) — ✅ сделано** (не закоммичено): ADR superseded-маркеры + ADR-015, переписаны data-model/stack/architecture, CLAUDE.md, process.md, SPEC-009→cancelled, email→placeholder.
- **Batch B (мёртвый код) — ✅ сделано**: удалён vanilla Mini App, Dinero+date-fns, READMEs, legacy-миграции задокументированы.
- **Batch C (финмодель + тесты) — ✅ сделано**: L1–L5 закрыты; новый `cloud/worker/src/ledger.ts` + vitest (`cloud/worker/test/`, 28 тестов). Adversarial-верификация закрыла 2 доп. high (валюта взноса = валюта ведра G11; `/accounts`↔`/dashboard` net worth asOf=today) + low (overdraft учитывает fee-leg, округление goal balance). typecheck (worker/admin/miniapp) + тесты зелёные.
- **Чекпоинт:** ждёт ревью перед Batch D (метрики) / E (Zod, качество) / F (процесс).
- **Известные low-ограничения (не блокеры):** fee в третьей валюте не атрибутируется; fee-разбивка может разойтись на soft-deleted ведре-контрагенте; бот не задаёт account_id → его траты не overdraft-проверяются.

## Сильные стороны (НЕ трогать на Стадии 2)

- **Auth-фундамент чист.** initData HMAC корректен (auth.ts:35-45); OAuth с настоящей CSRF-защитой (state-cookie HttpOnly/Secure/Lax), `aud`-проверка, fail-closed `email_verified`, email-allowlist (auth-google.ts:62-98); JWT проверяет подпись/iss/exp/sub. Два канала строго разделены (32 guard-вызова на 26 web-маршрутов). Все SQL параметризованы.
- **JWT alg-confusion НЕ применим:** `verifyJwt` не читает alg из токена, всегда считает HS256 сам (jwt.ts:37) — `alg=none` подделать нельзя.
- **Canonical-конвертация валют (ADR-014/SPEC-016):** единый `RatesIndex`, явная модель «запас (mark-to-market today) vs поток (date-aware)», fallback на ближайший курс ≤ даты вместо 0. Клиент не делит на курс. Четвёртый вариант конверсии структурно невозможен.
- **`effective_balance` (SPEC-011):** единообразная математика `baseline + Σ событий` в snapshots.ts и dashboard.ts; идемпотентность (UUID + INSERT OR IGNORE) и soft-delete консистентны во всех путях записи.
- **Топология минимальна и оправдана** под single-user free-tier; backend без лишних зависимостей.
- **Продуктовая дисциплина откатов** (chains, goal-tagged tx, receipt-scanner отвергнуты после реального использования).
- **Процесс зрелый**, secret-gate (gitleaks + gitignored wrangler.toml) реально активен и независим от push-политики.

---

## Находки по темам

Severity — после верификации. `bucket`: `mvp-blocker` / `stage2` / `backlog`.

### Тема №1 — Дрейф документации (всплыл в 6 линзах)

Код корректен, врут доки. Деньги не искажаются, но как карта для будущей сессии/агента это опасно перед рефакторингом.

| # | Находка | Evidence | Severity | Bucket |
|---|---|---|---|---|
| D1 | ADR-004 («D1 = outbox, cleanup по 7 дней») противоречит ADR-011 («D1 = источник правды»), не помечен superseded; рецепт ссылается на несуществующую колонку | decisions.md:90-110 vs :305-341 | **high** | stage2 |
| D2 | data-model.md описывает несуществующую схему: две БД, локальный SQLite-источник, `owners`, `transactions` с `amount_out/ccy_out/chain_id` | data-model.md:3-7,11-18,67-96 vs schema.sql | medium | stage2 |
| D3 | stack.md — до-pivot мир: Python local SQLite, outbox, vanilla Mini App «без бандлера», hono; ни слова про D1-source/Admin/React/Vite/TanStack/ECharts | stack.md:13,44,47,65,73-96,119 | medium | stage2 |
| D4 | architecture.md §Отказоустойчивость: «7 дней», «восстановление из локального SQLite», «регенерация Excel» — всё мёртвое | architecture.md:134-145 | medium | stage2 |
| D5 | CLAUDE.md «Текущий этап: Stage 4», реально Stage 8.5+ | CLAUDE.md:9,13-14 vs roadmap.md:135 | medium | stage2 |
| D6 | ADR-001/008 без superseded-маркера; ADR-011 объявил cron+Sheets удалёнными, но они вернулись для курсов; SPEC-009 `status: done` хотя отменён SPEC-012; код ссылается на «SPEC-017» для balance_eur (это category-mgmt) | decisions.md:323-328; SPEC-009:4; goals.ts:113,175 | low | stage2 |

### Тема №2 — Финансовая модель (реальный код, верифицировано)

**Учёт:**

| # | Находка | Evidence | Severity | Bucket |
|---|---|---|---|---|
| L1 | Overdraft только на `transactions`, не на `expenses` → ведро молча в минус, течёт в net worth/runway. SPEC-011 §G6 обещал валидацию на expense | checkOverdraft только transactions.ts:183,264; db.ts createExpense — нет | medium | stage2 |
| L2 | `fee` хранится, но не вычитается ни из одного ведра → net worth завышен на сумму комиссий (особенно USDT) | transactions.ts:172,107-114; getEffectiveBalance не учитывает fee | medium | stage2 |
| L3 | Событие в день снапшота отбрасывается (`date > baseline.date` строго) → внёс баланс вечером, потратил утром той же датой = выпало | snapshots.ts:96,105,112,120,128; dashboard.ts:151 | medium | stage2 |
| L4 | `free = net − targeted` ломается при `goal_contribution.account_id = NULL` (раздувает targeted) или двойной привязке денег к цели | dashboard.ts:135,177; goals.ts:138-167,339 | medium | stage2 |
| L5 | native-балансы суммируются сырым float без финального округления; EUR-эквиваленты округляются непоследовательно | snapshots.ts:133; goals.ts:166; vs incomes.ts:59 | low | stage2 |

**Метрики (врут в трендах/прогнозах, не в «сейчас»):**

| # | Находка | Evidence | Severity | Bucket |
|---|---|---|---|---|
| M1 | Δ net worth смешивает FX-переоценку со сбережениями (prevNet по историч. курсу, netNow по today) | dashboard.ts:216-221 vs :165 | medium | stage2 |
| M2 | burn/income всегда ÷ WIN=3, даже когда полных месяцев < 3 → занижает траты/доход, завышает runway в первые недели | dashboard.ts:184,201 | medium | stage2 |
| M3 | ETA каждой цели считается, будто весь свободный поток идёт в неё → при нескольких целях ложный оптимизм | DashboardPage.tsx:577,591 | medium | stage2 |
| M4 | `savings_rate_free` вычитает весь burn из свободного дохода (числитель/знаменатель из разных «карманов») | dashboard.ts:209 | low | backlog |
| M5 | Позиция без курса в net worth «сейчас» молча выпадает; missing_rates показан только в блоке «История», не рядом с KPI | dashboard.ts:166; DashboardPage.tsx:130-134 | low | backlog |

### Тема №3 — Продукт

| # | Находка | Решение | Severity | Bucket |
|---|---|---|---|---|
| P1 | Аналитика расходов выпала из Mini App при React-rewrite; doc↔код расхождение не зафиксировано | Сузить scope до «только ввод», обновить доки, Phase 2 → post-MVP | medium | stage2 (doc) |
| P2 | Доход/снапшот/обмен только с десктопа — дыра в мобильном journey | Post-MVP: text-команда в боте; зафиксировать non-goal сейчас | medium | backlog |
| P3 | Зарплата RSD не внесена + вся зарплата на eur-cash | owner-known; текущий net worth НЕ искажён (якорь = снапшот); искажены только история/разбивки. Обратимо одним UPDATE | low | backlog |
| P4 | Stage 10 AI Coach — риск золочения для single-user | Если браться — сузить до anomaly + missing-expenses, без survey/digest | low | backlog |

### Тема №4 — Мёртвый код / зависимости

| # | Находка | Evidence | Severity | Bucket |
|---|---|---|---|---|
| C1 | Мёртвый vanilla Mini App (public/app.js 54KB + styles.css 23KB + index.html) копируется Vite в dist и деплоится в прод (не грузится) | cloud/miniapp/public/*; dist/app.js 54208 байт | medium | stage2 |
| C2 | Dinero.js и Zod установлены, но не используются (деньги — голый float, валидация — ручная) | admin/package.json:20,27; 0 импортов | medium | stage2 |
| C3 | ADR-012 заявляет shadcn/Radix, Tremor, TanStack Form — ни один не установлен (UI hand-rolled на CVA) | decisions.md:264-269 vs package.json | medium | backlog |
| C4 | Две папки миграций (cloud/worker/migrations 0001-0010 + local/migrations 001-005) — ловушка | — | low | stage2 |
| C5 | Спящие колонки `chain_id/chain_sequence/goal_id` + индекс на них (откат SPEC-012, дедлайн ~08-2026) | schema.sql:110-112,118 | low | stage2 |
| C6 | tools/excel (12 утилит) + reports/ — мёртвая legacy-зона, но CLAUDE.md/roadmap ссылаются как на активную | — | nice | backlog |

### Тема №5 — Безопасность (0 блокеров)

| # | Находка | Evidence | Severity | Bucket |
|---|---|---|---|---|
| S1 | Глобальный catch возвращает `String(err)` → утечка внутренностей D1 на публичном API (в dashboard уже исправлено) | index.ts:190-193 | medium | stage2 |
| S2 | Email владельца в `specs/SPEC-004` + audits в публичном repo — нарушение своего privacy-протокола (security.md §4) | SPEC-004:87,135; SPEC-004-qa.md:46 | low | stage2 |
| S3 | Missing required → 500 (через catch-all) вместо 400 в части endpoints | index.ts (expenses create) | low | stage2 |
| S4 | JWT: не constant-time compare, нет явной alg-валидации (alg=none НЕ эксплойтится; timing непрактичен) | jwt.ts:38 | low | backlog |
| S5 | initData auth_date freshness не проверяется (осознанный non-goal) | auth.ts:18-55 | low | backlog |

### Тема №6 — Процесс / подход к агентам

| # | Находка | Evidence | Severity | Bucket |
|---|---|---|---|---|
| PR1 | Вердикты quality-gate для SPEC-015/018 не зафиксированы нигде | specs/audits/ обрывается на SPEC-008 | medium | stage2 |
| PR2 | SPEC-006 gate выродился в self-audit (агент ревьюил свой код из-за 529) — «двойной gate» тихо схлопывается | SPEC-006-qa.md:1-10; roadmap.md:280 | medium | stage2 |
| PR3 | process.md §«Двухфазный переход» (retro 1-5a / forward с 6) — давно неактуальная фазировка | process.md:141-151 | low | stage2 |
| PR4 | Микро-спеки (SPEC-009 родился и умер за сутки, SPEC-010/018 create→done в один день) — Phase 1 как формальность | — | low | backlog |
| PR5 | Оба subagent-а на одной модели — сигнал коррелирован (общий blind spot пропустят оба) | — | low | backlog |

---

## Punch-list Стадии 2 (по батчам, в порядке исполнения)

### Batch A — Документация и согласованность (zero-risk, чистый текст) — эталон для остального
- [ ] D1/D6: superseded-маркеры в шапки ADR-001, ADR-004, ADR-008; уточнение в ADR-011 про возврат cron+Sheets для курсов.
- [ ] D2: переписать `data-model.md` под фактический `schema.sql` (одна БД, вёдра `form`, `effective_balance`, `transactions` two-leg, `goals`/`goal_contributions`/`incomes`/`income_categories`).
- [ ] D3: переписать `stack.md` под реальность (D1-source, Worker без hono, Mini App React+Vite, Web Admin React19+TanStack+ECharts+Tailwind+CVA, тест-стек Playwright+Appium; Python — только backup/импорты).
- [ ] D4: переписать `architecture.md` §Отказоустойчивость под D1-centric (источник = D1; защита = daily `wrangler d1 export` → iCloud; восстановление = re-create D1 + import .sql).
- [ ] D5: «Текущий этап» в CLAUDE.md → ссылка на roadmap (single source of truth).
- [ ] P1: сузить scope Mini App до «только ввод» в CLAUDE.md (правило 11) + architecture.md:6; Phase 2 аналитики → roadmap post-MVP.
- [ ] P2: зафиксировать мобильный ввод дохода/снапшота как post-MVP план (non-goal сейчас) в architecture.md/roadmap.
- [ ] D6: SPEC-009 → `status: cancelled` (ссылка на SPEC-012); пройтись по frontmatter-статусам всех спеков.
- [ ] PR1/PR3: записать вердикты SPEC-015/018 (или явно пометить пропуск); стандартизировать одно место для вердиктов; свернуть §«Двухфазный переход» в историческую заметку.
- [ ] S2: заменить email владельца на `<owner@example.com>` в SPEC-004 + audits; добавить email-паттерн в gitleaks/pre-push grep.
- [ ] Новый ADR: «деньги хранятся как `REAL`, округление на выдаче» с границами риска (решение #3).

### Batch B — Мёртвый код / зависимости (low-risk)
- [ ] C1: удалить `cloud/miniapp/public/{app.js,styles.css,index.html}` (vanilla); обновить `cloud/miniapp/README.md` под React/Vite; проверить чистый dist.
- [ ] C2/#3: удалить Dinero.js из package.json; обновить ADR-012 под фактический фронт-стек (без Radix/Tremor/TanStack Form).
- [ ] C4: перенести `local/migrations` + `local/schema.sql` + `init_db.py`/`migrate_to_d1.py` в `local/legacy/`.
- [ ] C6: решить судьбу `tools/excel` + `reports/` (архив в `data/legacy/` или удалить); обновить навигацию CLAUDE.md.

### Batch C — Финансовая модель (код + тесты, money-critical) — решения #2, #3
- [ ] L1: overdraft-валидация на expense create/update (по SPEC-011 §G6).
- [ ] L3: выбрать и задокументировать семантику snapshot (начало/конец дня); выровнять snapshots.ts + dashboard.ts; добавить инвариант в SPEC-011 с примером; UI-подпись при необходимости.
- [ ] L2: учитывать `fee` в балансе (вычитать из ведра, если `fee_currency` = from/to) ИЛИ убрать поле как мёртвое — решить при реализации.
- [ ] L4: зафиксировать инвариант «каждый targeted-евро лежит в ведре»: запретить contribution.account_id=NULL в targeted ИЛИ исключать такие; income.goal_id и contribution на одни деньги — взаимоисключающие.
- [ ] L5: округлять native `effective_balance` при возврате из getEffectiveBalance/balanceAt.
- [ ] Тесты: vitest на worker, покрыть `RatesIndex` (граничные даты, отсутствие котировки, EUR→EUR, convertAt через EUR) — самый денежно-критичный модуль.

### Batch D — Метрики (методология)
- [ ] M2: делить burn/income на `min(WIN, monthsWithData)` ИЛИ показывать «недостаточно истории».
- [ ] M1: Δ net worth — считать оба конца по today-курсу ИЛИ явно подписать «включает валютную переоценку».
- [ ] M3: goal ETA — распределять свободный поток между активными целями ИЛИ подпись «при условии, что весь поток идёт в эту цель».
- [ ] M4/M5: определить `savings_rate_free`; продублировать индикатор missing-rate рядом с KPI net worth.

### Batch E — Структура / качество (refactor)
- [ ] C2/D2 + type-drift: внедрить Zod на worker (валидация payload) и вынести схемы как единый источник контракта worker↔admin (закрывает S3 + ручной drift admin/api/types.ts).
- [ ] S1: глобальный catch → generic `{error:"internal"}` + `console.error(err)` (как в dashboard handler).
- [ ] Хелперы `withAdminSession(handler)` + `parseJsonBody(request)` — срезать ~150 строк boilerplate в index.ts, исключить «забыть guard».
- [ ] Синхронизировать `CURRENCY_DECIMALS` между admin и miniapp (или shared currency-meta/formatAmount/date-helpers).
- [ ] Aggregator против двойной загрузки RatesIndex на /accounts и /dashboard.

### Batch F — Процесс (упростить под single-dev)
- [ ] PR4: ввести лёгкий mini-spec tier (Context+Goals+AC) для откатов/edit/тривиальных фич; полный pipeline — для фич с миграциями/новыми endpoint.
- [ ] PR2: правило «subagent недоступен → verdict `DEFERRED`, не `PASS`-by-self»; пересмотреть SPEC-006 независимым прогоном.
- [ ] PR5 (опц.): один gate прогонять другой моделью (Gemini/Codex CLI) ИЛИ честно переименовать «двойной gate» в «два чеклиста одного ревьюера».

### Отложено по дедлайну
- [ ] C5: миграция drop `chain_id/chain_sequence/goal_id` + индекс — после ~08-2026 (3 мес с отката SPEC-012).
- [ ] #20: переименование корня `excel/` → `finance/` и D1 `finances-outbox` → отдельная задача.
