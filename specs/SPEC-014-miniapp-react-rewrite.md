---
id: SPEC-014
title: Mini App → React (переписывание + выбор счёта)
status: done
owner: stepan
created: 2026-05-25
updated: 2026-05-25
links:
  - adr: docs/decisions.md#adr-011
  - adr: docs/decisions.md#adr-012
  - depends_on: [SPEC-002, SPEC-003]
---

# Mini App → React (переписывание + выбор счёта)

## 1. Context & Problem

Mini App (ввод расходов) — vanilla JS (`app.js` 1288 строк, `index.html`, `styles.css`).
UX слабый: не плавный, не отзывчивый, «скудный». Стек проигрывает админке
(React+Vite+TanStack+Tailwind), которой пользователь доволен. Плюс не хватает
функции: при вводе расхода нельзя выбрать счёт (`account_id`), хотя backend это
поддерживает (`expenses.account_id`). Решение: переписать Mini App на стек админки
с паритетом фич + добавить выбор счёта.

## 2. Goals

- **G1**: Mini App на React 19 + Vite + Tailwind (как админка), плавный/отзывчивый UX.
- **G2**: Паритет всех текущих фич (см. §4) — ничего не теряем.
- **G3**: Новое — выбор счёта при вводе расхода (`account_id` в POST).
- **G4**: Backend не меняется — тот же `/v1/bootstrap|expenses|rates`, та же auth (Telegram `initData` HMAC).
- **G5**: Тот же Cloudflare Pages деплой (проект Mini App), та же Telegram-интеграция (тема, haptics, expand).

## 3. Non-Goals

- **NG1**: Не менять backend API / схему D1 (`createExpense` уже принимает `account_id` — проверить, не дорабатывать без нужды).
- **NG2**: Не менять scope Mini App (CLAUDE.md §11): только расходы + аналитика. Никаких снапшотов/доходов/обменов.
- **NG3**: Не трогать админку и Worker-логику.
- **NG4**: Не менять auth-модель (остаётся `initData`, не Google OAuth).
- **NG5**: Не шарить код с админкой через общий пакет (отдельные приложения; единый только визуальный язык/паттерны). Копирование мелких хелперов — норма.

## 4. Фичи для паритета (из текущего Mini App)

**Main screen:** numpad (0-9, точка, ⌫), display (сумма + валюта + флаг), side-actions
(валюта / дата / заметка **+ новое: счёт**), категории (горизонтальный трек с
пагинацией и свайпом), recent-days (последние траты, свайп-удаление).

**Stats screen (Фаза 2):** период-nav (‹ ›), tabs (Нед/Мес/Год/Всё), KPI, donut,
список категорий, trend chart + axis, drilldown-модал по категории.

**History screen:** список с группировкой по дням, lazy-подгрузка (chunks), свайп-удаление.

**Modals:** меню, настройки (базовая валюта + инфо о курсах), выбор валюты, выбор
даты (сегодня/вчера/позавчера/произвольная), редактор заметки, **выбор счёта (новое)**,
edit expense (сумма/валюта/дата/заметка/категория + удалить/сохранить), toast.

**Telegram WebApp:** `initData` (auth header), `ready()`, `expand()`,
`disableVerticalSwipes()`, `setHeaderColor`/`setBackgroundColor` (тема), `HapticFeedback`.

**Прочее:** мультивалюта (флаги, конверсия в базовую через rates), базовая валюта в
localStorage, focus-guard для модалок, escapeHtml, форматирование сумм/дат.

## 5. Data model

**Без изменений D1.** Используется `expenses` (уже есть `account_id` nullable),
`accounts`, `categories`, `currencies`, `rates` — всё через `/v1/bootstrap`.

Новое в payload POST `/v1/expenses`: `account_id` (опционально). Backend-проверка:
`createExpense` (db.ts) должен сохранять `account_id` из body — verify, при отсутствии
добавить (тонкая правка, не ломающая).

## 6. API contract

Без новых endpoints. Используются существующие (Telegram `initData` auth):
- `GET /v1/bootstrap` — refs (accounts/categories/currencies/rates) + initial expenses.
- `GET /v1/expenses?limit=&from=` — список.
- `POST /v1/expenses` — создать; body теперь включает `account_id?: string|null`.
- `PUT /v1/expenses/:id` — обновить (в т.ч. `account_id`).
- `DELETE /v1/expenses/:id` — soft-delete.
- `GET /v1/rates` — курсы.

## 7. UI / UX

Архитектура: `cloud/miniapp/` становится Vite+React+TS проектом (текущие
`public/*` — в git-истории; новый `src/`, `index.html`, `vite.config.ts`). Tailwind с
токенами под Telegram-тему (читаем `themeParams`, маппим в CSS-vars — тёмная/светлая
подстраивается под клиента). Компоненты — функциональные, состояние через React
(useState/useReducer + TanStack Query для данных, как админка).

**Компонентный стек — как админка, без Radix/headless-библиотек:** Tailwind +
`class-variance-authority` + `clsx`/`tailwind-merge` + `lucide-react` + самописные
`Modal`/grid-picker. Админка Radix не использует, а в тач-Mini App (numpad, свайпы,
гриды-пикеры) headless-примитивы мало что дают (их сила — desktop-a11y: focus-trap,
keyboard-nav, dropdown) и добавляют вес в мобильный бандл. Focus/портал модалок —
переносим подход админкиного `Modal.tsx`.

**Выбор счёта (новое):** 4-я side-кнопка `🏦 счёт`. Тап → модал-грид счетов
(`accounts` где `form != 'external'`), как currency picker. Выбор запоминается на
сессию (последний счёт). Дефолт — «без счёта» (account_id=NULL), т.к. часть трат
наличными без привязки. В edit-модале — тоже выбор счёта.

Плавность: CSS-transition/transform на анимациях (numpad press, переключение экранов,
свайпы), `HapticFeedback` на тап/удаление, скелетоны на загрузке. Цель — нативное
ощущение iOS.

## 8. Security

- Auth — Telegram `initData` HMAC в `X-Telegram-Init-Data` (как сейчас, проверяется Worker'ом).
- `escapeHtml` → React сам экранирует (JSX), уязвимость уходит даром.
- Никаких секретов в клиенте; `WORKER_BASE` hardcode — допустимо (см. security.md §82).
- Input: сумма > 0, валидная валюта/категория — клиентская проверка + серверная.

## 9. Acceptance criteria

- [ ] AC1: Ввод расхода (numpad → сумма, категория, валюта, дата, заметка, **счёт**) → POST с `account_id`, появляется в recent.
- [ ] AC2: Выбор счёта работает: модал-грид, выбранный счёт сохраняется в новом расходе; «без счёта» = NULL.
- [ ] AC3: Мультивалюта: смена валюты меняет флаг/код, конверсия в базовую в итогах.
- [ ] AC4: История: группировка по дням, lazy-подгрузка, свайп-удаление с подтверждением.
- [ ] AC5: Edit-модал: правка суммы/валюты/даты/заметки/категории/**счёта** + удаление.
- [ ] AC6: Статистика (Фаза 2): период-tabs, KPI, donut, trend, drilldown.
- [ ] AC7: Telegram-тема применяется (header/bg/цвета под клиента); haptics на действиях.
- [ ] AC8: Паритет — ни одна текущая фича не потеряна.
- [ ] AC9: `initData` auth работает; без него — те же ошибки, что сейчас.
- [ ] AC10: Деплой на тот же Pages-проект; Telegram menu button открывает новую версию.

## 10. Test plan

- **Playwright** (`local/scripts/test_ui.py` — iPhone 15 PM, мок Telegram WebApp): ввод, категории, история, свайпы, модалки, account picker.
- Ручной прокликинг в Telegram (реальный клиент) — тема, haptics, плавность.
- Регресс: backend не тронут → админка/Worker не затронуты; existing expenses читаются.

## 11. Risks & open questions

- **R1 (объём)**: полный паритет — большой rewrite. Митигация — фазность (§12).
- **R2 (Telegram WebApp в React)**: SDK через `window.Telegram.WebApp` (script tag) + типы; init в `useEffect` на маунте.
- **R3 (свайпы/жесты)**: vanilla-свайпы (категории, delete) переписать на React-обработчики (pointer events) — следить за `disableVerticalSwipes` чтобы не конфликтовать с Telegram.
- **OQ1**: Фазность — Фаза 1 (ядро ввода + account picker + история) сейчас, Фаза 2 (статистика + settings + полировка) отдельно? **Предлагаю да** (быстрее даёт рабочий ввод с picker'ом — главную хотелку).
- **OQ2**: account picker дефолт — «без счёта» или запоминать последний выбранный? **Предлагаю**: дефолт «без счёта», но запоминать последний на сессию (быстрый повторный ввод на тот же счёт).

## 12. Фазность (предлагаемая)

- **Фаза 1 (этот заход после одобрения)**: scaffold React+Vite+Tailwind, Telegram init+тема, main screen (numpad/display/категории/recent), ввод расхода + **account picker**, мультивалюта, история, edit/delete, модалки (валюта/дата/заметка/счёт), toast. → функциональный ввод с выбором счёта.
- **Фаза 2 (отдельно)**: статистика (KPI/donut/trend/drilldown), настройки (базовая валюта), финальная полировка анимаций/haptics, Playwright-прогон.

## 13. Changelog spec'а

- 2026-05-25: создан в `draft`.
- 2026-05-25: зафиксирован стек без Radix (как админка: cva+tailwind+самописные компоненты).
