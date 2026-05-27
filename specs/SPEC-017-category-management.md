---
id: SPEC-017
title: Управление категориями (расходы + доходы) в Web Admin + завершение canonical toEur
status: in_progress
owner: stepan
created: 2026-05-27
updated: 2026-05-27
links:
  - adr: docs/decisions.md#adr-014
  - depends_on: [SPEC-006, SPEC-016]
---

# Управление категориями в Web Admin

## 1. Context & Problem

Категории расходов (`categories`, `type='expense'`) и доходов (`income_categories`) сейчас правятся **только напрямую в D1** — нельзя добавить, переименовать, сменить эмодзи/цвет или порядок из UI. Давний хвост (см. roadmap). Категории видны в Mini App (сетка плиток ввода трат) и Admin (фильтры, дашборд, модал доходов), но управлять ими неоткуда.

Попутно: после SPEC-016 остался **residual клиентский `toEur`** (latest-snapshot) в `IncomesPage` (fallback) и `DashboardPage` (goals-forecast) — последний «4-й вариант» конверсии, который canonical-инвариант (ADR-014) должен искоренить.

## 2. Goals

- **G1**: Полный CRUD категорий в Web Admin — создать / переименовать / эмодзи / цвет / порядок / деактивировать-вернуть. Для расходных **и** доходных.
- **G2**: Мягкое удаление (`is_active=0`) — категория уходит из выбора, старые записи сохраняют её (история и аналитика целы).
- **G3**: Изменения сразу видны в Mini App (через bootstrap) и Admin (фильтры / дашборд / модал доходов).
- **G4**: Добить residual `toEur` — `IncomesPage` и `DashboardPage` goals-forecast больше не конвертируют на клиенте по latest-snapshot; canonical-инвариант (ADR-014) становится глобальным.
- **G5**: Без миграций D1 (используем существующие колонки).

## 3. Non-Goals

- **NG1**: Редактирование категорий в Mini App — **нет** (scope зафиксирован, правило 11). Mini App только отражает изменения.
- **NG2**: Hard delete + реассайн трат в другую категорию — нет (только мягкая деактивация). Реассайн — отдельная задача, если понадобится.
- **NG3**: Иерархия категорий (`parent_id`) — не трогаем (поле есть, активно не используется).
- **NG4**: Не меняем семантику конверсии (ADR-014) — только убираем последние клиентские `toEur`.

## 4. User journeys

### Happy path
1. Открываю **/categories** (новый пункт сайдбара). Две секции: **Расходные** | **Доходные**. В каждой — плитки/строки с эмодзи, именем, цветным акцентом, статусом.
2. «+ Категория» → модал (имя, эмодзи, цвет, live-preview как в целях) → создаётся.
3. Карандаш на категории → правлю имя/эмодзи/цвет → сохраняется; видно в Mini App при следующем bootstrap и в Admin.
4. Деактивирую категорию → уходит из списков выбора (сетка Mini App, фильтры/модал доходов Admin), но старые траты её сохраняют и показывают в истории/аналитике.
5. Стрелки ↑↓ меняют порядок (`sort_order`) — влияет на порядок плиток в Mini App и списков в Admin.

### Edge cases
- **E1**: Деактивирую категорию с тратами → траты остаются с ней; имена грузятся и для неактивных (история/дашборд не теряют подпись).
- **E2**: Дубль имени → разрешён (id уникален, имя — нет).
- **E3**: Пустое имя → 400.
- **E4**: Эмодзи и цвет опциональны.
- **E5**: Реактивация (`is_active=0→1`) → категория возвращается в выбор.

## 5. Data model

Изменений схемы D1 **нет**. Используем существующие:
- `categories` (`id, name, type, parent_id, emoji, color, sort_order, is_active, updated_at`) — управление фильтрует `type='expense'`.
- `income_categories` (`id, name, emoji, color, sort_order, is_active, created_at`).

`is_active`, `sort_order`, `emoji`, `color` — уже есть, миграции не нужны.

## 6. API contract (новые endpoints, Bearer JWT)

### Expense categories — `categories` (`type='expense'`)
- `GET /v1/web/categories?include_inactive=1` — list (default только активные; флаг для управления).
- `POST /v1/web/categories` — `{ name, emoji?, color?, sort_order? }` (`type='expense'` forced серверно).
- `PUT /v1/web/categories/:id` — `{ name?, emoji?, color?, sort_order?, is_active? }` (partial).

### Income categories — `income_categories`
- `GET /v1/web/income-categories?include_inactive=1` — расширить существующий (сейчас только активные; default сохраняется).
- `POST /v1/web/income-categories` — `{ name, emoji?, color?, sort_order? }`.
- `PUT /v1/web/income-categories/:id` — partial.

Нет `DELETE` — «удаление» = `PUT is_active=0`. Валидация: `name` required non-empty; `color` — `#RRGGBB` если задан; id существует для PUT. Идемпотентность create — `id` (UUID, может прийти с клиента), `INSERT OR IGNORE`.

## 7. UI / UX

- Новая страница **/categories** + пункт сайдбара «Категории». Две секции/таба: Расходные | Доходные.
- Список: строка/карточка — эмодзи + имя + цветовой swatch + toggle активности + Pencil (edit) + стрелки ↑↓ (порядок). Неактивные — приглушённо/отдельно, с кнопкой «вернуть».
- Модал create/edit: имя, эмодзи, цвет — переиспользовать секцию «Эмодзи и цвет» + live-preview из форм целей (`GoalsPage`).
- Mini App: без изменений (сетка уже фильтрует `is_active` и сортирует по `sort_order`).

## 8. Security

- Все новые endpoints — `requireAdminSession` (JWT). Mutating без auth → 401.
- Input validation: `name` non-empty, `color` формат, `is_active` boolean→0/1. Без новых secrets, без PII.

## 9. Acceptance criteria

- [ ] **AC1**: `/categories` показывает расходные + доходные; активные + (по флагу) неактивные.
- [ ] **AC2**: POST создаёт категорию → видна в списке, в Mini App bootstrap, в Admin-модале доходов/фильтрах.
- [ ] **AC3**: PUT меняет имя/эмодзи/цвет → отражается везде.
- [ ] **AC4**: Деактивация (`is_active=0`) → уходит из выбора; старые записи сохраняют категорию; имя доступно в истории/аналитике (неактивные грузятся для подписи).
- [ ] **AC5**: Реактивация возвращает в выбор.
- [ ] **AC6**: `sort_order` ↑↓ меняет порядок плиток в Mini App.
- [ ] **AC7**: `IncomesPage` не содержит клиентского `toEur` (использует `amount_eur` с worker).
- [ ] **AC8**: `DashboardPage` goals-forecast не конвертирует на клиенте по latest-snapshot.
- [ ] **AC9**: Без миграций D1; `gitleaks` clean; tsc/build green; `test_admin_ui` покрывает `/categories` (создание/edit/деактивация, light+dark).

## 10. Test plan

- **Worker**: curl POST/PUT `/v1/web/categories` + `/v1/web/income-categories`; проверка `include_inactive`.
- **Admin**: `test_admin_ui.py` — `/categories` (секции, модал, деактивация), скриншоты light/dark; мок новых endpoints.
- **Mini App**: `test_miniapp_react.py` — сетка отражает порядок и скрывает неактивные.
- **Regression**: expense/income фильтры, дашборд donut категорий, модал доходов «Из последней», history подписи категорий.

## 11. Risks & open questions

- **OQ1**: `DashboardPage` goals-forecast `remainingEur` (`toEur` latest) — вынести `remaining_eur` в worker `/dashboard` response (canonical), либо это допустимо как «запас по сегодняшнему курсу» (мелочь)? Решить в Phase 2 — предпочтительно worker-side.
- **R1**: `include_inactive` расширяет существующий `/v1/web/income-categories` — default (без флага) остаётся «только активные», чтобы `IncomesPage` не сломался.
- **R2**: Удаление эмодзи/цвета (set to null) vs «не менять» — PUT с явным `hasX` паттерном (как `updateGoal`), чтобы можно было очистить поле.

## 13. Changelog spec'а

- 2026-05-27: создан в `draft`.
- 2026-05-27: одобрен (scope: расход+доход, только Admin, мягкая деактивация), → `in_progress`.
