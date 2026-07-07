---
spec: SPEC-042
title: Волна 1 аудита 2026-07 — P1 bug-фиксы (9 находок)
status: done
created: 2026-07-07
owner: Stepan
---

# SPEC-042 · Волна 1 аудита 2026-07 — P1 bug-фиксы

## 1. Context & Problem

Полный аудит приложения 2026-07-06 (`docs/audits/2026-07-full-audit/`, папка локальная)
выявил 9 P1-багов, воспроизводимых из UI. По процессу аудита (мастер-отчёт п.5, ADR-013)
bug-фиксы волны объединяются в один SPEC/ветку. Полные описания с доказательствами —
в доменных отчётах аудита (ID ниже); здесь — сжатая постановка и AC.

| ID | Суть |
|---|---|
| WRK-01 | `PUT /v1/expenses/:id` с `account_id: null` молча игнорируется (COALESCE) — «без счёта» в Edit не работает |
| FIN-01 | Смена `account_id` в edit incomes/contributions/snapshots пере-деривит валюту, оставляя сумму («100 000 RUB» → «100 000 EUR») |
| WRK-02 | Сброс `archetype_override`/`floor_eur` на «авто» молча игнорируется (COALESCE-UPSERT, rbar.ts) |
| SPC-01 | Инвест-ведро выбираемо в пикере счёта расхода Mini App (SPEC-026 AC18) |
| MA-01 | Ретрай/двойной тап создания траты шлёт новый UUID → дубликаты; id должен жить в драфте |
| MA-02 | История/Статистика Mini App игнорируют `isError` — обрыв сети выглядит как «Трат нет» |
| ADM-01 (+07, +16) | Мутации снапшотов/доходов/целей/взносов не инвалидируют `["dashboard"]` (и `["accounts"]`); дыры budget→recommendations, deleteTx→goals, updateIncome→goal(null), categories→budgets |
| SEC-04 | `/tg` webhook без `secret_token` — подделываемые Telegram-апдейты |
| QA-01 | `transactions.ts` (CRUD денежных мутаций) без единого теста |

## 2. Goals

- G1: явный `null` в PATCH означает «очистить», отсутствие поля — «не трогать» (для затронутых полей WRK-01/WRK-02).
- G2: смена счёта записи не может молча реинтерпретировать сумму в другой валюте (FIN-01).
- G3: инвест-ведро недоступно для трат — и в UI, и на сервере (SPC-01).
- G4: идемпотентность create-траты реально работает с клиента (MA-01).
- G5: ошибка сети различима от «пусто» в Mini App (MA-02).
- G6: после любой денежной мутации в Admin дашборд/счета не показывают стейл (ADM-01).
- G7: `/tg` принимает только апдейты с валидным `X-Telegram-Bot-Api-Secret-Token` (SEC-04).
- G8: CRUD transactions покрыт тестами через реальный SQL-путь (QA-01).

## 3. Non-goals

- Глобальная null-семантика PUT для остальных полей/эндпоинтов (кластер волны 2.1).
- Клиентский UUID во всех create-мутациях Admin (кластер волны 2.2, ADM-02).
- Прочие P2/P3 находки аудита.

## 4. Design (per fix)

- **WRK-01**: `updateExpense` (db.ts) — `hasOwnProperty`-паттерн для `account_id`/`category_id`
  (образец: `note` там же, `goal_id` в incomes.ts). SPEC-032-guard считает результирующий
  счёт как `hasAccount ? patch.account_id : existing.account_id`.
- **FIN-01**: в `updateIncome`/`updateContribution` guard: если новый счёт меняет валюту
  записи и `amount` не передан в том же PATCH → 400 `currency_change_requires_amount`.
  В `updateSnapshot` — если меняется `account_id` на ведро другой валюты и не передан
  `amount` → 400 (та же семантика: снапшот в native новой валюты).
- **WRK-02**: `upsertBudgetSettings` (rbar.ts) — `hasOwnProperty`-паттерн по образцу
  `upsertInvestmentSettings` (investments.ts).
- **SPC-01**: Mini App `Modals.tsx` — фильтр `!a.is_investment`; server-side guard в
  `createExpense`/`updateExpense`: `account_id` с `is_investment=1` → 400 `investment_account`.
- **MA-01**: `store.tsx` — `draftId: uuid4()` в драфте; `save()` шлёт `draftId`;
  новый id только при reset после успеха.
- **MA-02**: History/Stats — ветка `isError` → «Не удалось загрузить» + кнопка «Повторить»
  (`refetch`), паттерн Shell.
- **ADM-01/07/16**: queries.ts — хелпер `invalidateMoneyAggregates(qc)` = dashboard+accounts
  (+investments) во всех денежных мутациях; budget CRUD → `invalidateAdaptive`;
  deleteTransaction → +goals/goal; updateIncome → `["goal"]`-префикс при смене goal_id
  (вкл. null); категорийные мутации (expense) → +budgets.
- **SEC-04**: `handleTg` сверяет `X-Telegram-Bot-Api-Secret-Token` с
  `env.TELEGRAM_WEBHOOK_SECRET` (`crypto.subtle.timingSafeEqual`, длины выравниваются);
  секрет не задан в env → поведение прежнее (совместимость до постановки секрета).
  Операционно: секрет в `wrangler secret` + `setWebhook` с `secret_token` (до деплоя
  проверки — окно нулевое, старый worker header игнорирует).
- **QA-01**: `test/transactions.test.ts` на D1-моке: create/update/delete exchange и
  transfer, fee в валюте from/to/третьей, канонизация `created_at`, сверка
  `getEffectiveBalance` обоих вёдер до/после.

## 5. Acceptance criteria

- [x] AC1: PUT expense `{account_id: null}` отвязывает счёт; `{category_id: null}` очищает категорию; отсутствие полей — не трогает (тест).
- [x] AC2: PUT income/contribution со сменой счёта на другую валюту без `amount` → 400; с `amount` → валюта и сумма консистентны (тесты).
- [x] AC3: PUT snapshot со сменой `account_id` на ведро другой валюты без `amount` → 400 (тест).
- [x] AC4: PUT budget-settings `{archetype_override: null}` очищает override; `{floor_eur: null}` очищает пол (тест).
- [x] AC5: инвест-ведро отсутствует в пикере счёта Mini App; POST/PUT expense с инвест-ведром → 400 (тест).
- [x] AC6: повторный `save()` того же драфта шлёт тот же `id` (двойной тап/ретрай → `inserted:false`, не дубликат).
- [x] AC7: при `isError` История и Статистика показывают error-state с работающим «Повторить», не «Трат нет».
- [x] AC8: мутации snapshot/income/goal/contribution инвалидируют dashboard+accounts; budget CRUD инвалидирует рекомендации.
- [x] AC9: `/tg` без/с неверным secret-header → 403 при заданном `TELEGRAM_WEBHOOK_SECRET`; с верным → 200 (тест); прод-бот отвечает после перевыставления webhook.
- [x] AC10: `test/transactions.test.ts` зелёный; полный vitest worker зелёный; tsc всех трёх пакетов зелёный.

## 6. Changelog

- 2026-07-07: создан, `in_progress` — волна 1 аудита, owner одобрил автономное выполнение всего списка волн.
- 2026-07-07: реализация + Phase 3: qa=PASS_WITH_NICES (0 must-fix), arch=CHANGES_REQUESTED→закрыто (must-fix: документация TELEGRAM_WEBHOOK_SECRET в wrangler.example.toml/setup.md). Применённые nice-to-have: `== null`-хардening FIN-01-guard'ов; `["goal"]` в useDeleteIncome; удалён мёртвый invalidateBudgets; консистентный error-гейт History; тост «Уже сохранено» при inserted:false; текст серверных 400 в EditScreen; updateSnapshot валидирует существование account_id (parity с create). Бонус-фикс: ранний dup-чек по id в createExpense/createTransaction (ретрай возвращал ложный overdraft). 230/230 vitest, tsc чист ×3, оба Playwright-харнеса зелёные. Отложено в волну 2: FIN-01 из Admin-форм (полный payload обходит guard — diff-patch форм), баннер-при-кэше MA-02, note-затирание updateSnapshot (кластер 2.1).
- 2026-07-07: `done` — PR #31 смержен (squash, `591ec8b`), worker+miniapp+admin задеплоены. SEC-04 операционно: секрет в wrangler secret, setWebhook перевыставлен; прод-smoke `/tg` no/wrong header → 403, верный → 200, webhook last_error: none; траты с инвест-ведра в проде: 0 (guard ничего не ломает задним числом); miniapp/admin 200.
