---
spec: SPEC-048
title: Волна 3 аудита — P3-полировка Mini App
status: in_progress
created: 2026-07-07
owner: Stepan
---

# SPEC-048 · Волна 3 аудита — P3-полировка Mini App (MA-03…MA-15)

## 1. Context & Problem

Продолжение аудита 2026-07 (`docs/audits/2026-07-full-audit/04-miniapp-ui.md`).
P1 (MA-01/02) закрыты SPEC-042, MA-14 — SPEC-045 (SPC-06). Здесь — весь остаток
полировки Mini App: MA-03…MA-13, MA-15. Зона неизменна (CLAUDE.md правило 11):
ввод трат + read-only аналитика, никакого нового CRUD; UI-инварианты владельца
(input-less, hover/active-отклик, пунктир только для прогнозов) соблюдены.

| ID | Суть | Решение |
|---|---|---|
| MA-03 | Нет closing confirmation при непустом драфте | FIX |
| MA-04 | Возврат из Edit всегда на главный экран | FIX (S-вариант) |
| MA-05 | Fetch без таймаута, неразличимый busy, сырые сетевые ошибки | FIX |
| MA-06 | Тема не обновляется при смене light/dark во время сессии | FIX |
| MA-07 | Numpad: decimal-cap 2 для всех валют, RSD-точка, truncate ввода | FIX (а/б/в); (г) WONTFIX |
| MA-08 | Бейджи бюджета/конверта нечитаемы при disabled-гриде | FIX |
| MA-09 | SwipeRow: нет touch-отклика, много открытых строк, тап по открытой → edit | FIX (а–д) |
| MA-10 | Telegram BackButton не используется | FIX (BackButton); MainButton WONTFIX |
| MA-11 | A11y: touch targets < 44pt, Modal без aria-labelledby, Δ-контекст только в title | FIX; focus-trap WONTFIX |
| MA-12 | DatePicker: пустое значение input[type=date] не гардится | FIX |
| MA-13 | Мёртвый baseCurrency/settings + латентный мислейбл DayTotal | FIX |
| MA-15 | Δ сравнивает неполный месяц с полным прошлым без видимой подписи | FIX |

## 2. Design

- **MA-03**: эффект в Shell — драфт «грязный» (`amount !== "0" || note || editingId || screen === "note"`)
  → `enableClosingConfirmation()`, чистый → `disable…`. Экран описания грязный всегда
  (его текст локален до «Готово»). try/catch для старых клиентов.
- **MA-04**: `returnScreen` в store; `loadEdit` запоминает исходный экран (main/history/stats),
  `back()` EditScreen (и BackButton) возвращают на него. Период/скролл экрана не
  сохраняются (экран размонтируется, сброс на текущий — приемлемо по аудиту); максимум
  (поднять период в store) — не сейчас.
- **MA-05**: `AbortSignal.timeout(15s)` в `api()` (уважает переданный `opts.signal`);
  TypeError → «Нет сети — попробуйте ещё раз», Timeout/Abort → «Сервер не отвечает…»;
  спиннер (Loader2) в Display на время `create.isPending` — «сохраняется» видимо
  отличается от «сумма не введена». Ретрай безопасен: draftId стабилен (MA-01/SPEC-042).
- **MA-06**: подписки `tg().onEvent("themeChanged", syncTheme)` + `matchMedia("(prefers-color-scheme: dark)")`
  в `initTelegram` (синглтон времени жизни приложения, offEvent не нужен); вне Telegram
  syncTheme теперь вызывается и на старте.
- **MA-07**: (а) `applyNumpadKey(amount, key, maxDec)`, maxDec = `CURRENCY_DECIMALS[currency] ?? 2`
  — BTC 8 / ETH 6 знаков; (б) `maxDec === 0` (RSD) — точка игнорируется, «12.5 RSD» не
  набрать (разночтение строки и итога дня закрыто на вводе; смена валюты ПОСЛЕ набора
  дробной суммы не пересанитизирует строку — редкий путь, сервер примет, отображение
  округлит `fmt`); (в) длинное число уменьшает font-size (Display: 4xl→3xl→2xl, Edit:
  3xl→2xl→xl) вместо truncate — вводимые цифры видны. (г) WONTFIX: «.» на дисплее ввода
  осознанно зеркалит numpad-клавишу «.», а не ru-локаль — визуальная связь клавиша↔дисплей важнее.
- **MA-08**: приглушение (`opacity-40`) только на эмодзи+названии плитки; бейджи
  SPEC-020/023 всегда полной непрозрачности + 9px → 10px. Интерактивность гасится
  `disabled` + `pointer-events-none`, как раньше.
- **MA-09**: (а) touch-отклик строки — `active:brightness-[.92]`/dark `125` на контенте
  SwipeRow (brightness работает и поверх инлайнового фона, `active:bg-*` его бы не
  перекрыл); (б) модульный реестр закрывателей — «открылась новая строка → закрой
  старую» (работает через списки и виртуализацию, unmount снимает регистрацию);
  (в) тап по открытой строке закрывает свайп, а не ведёт в edit; (г) haptic на открытие
  свайпа; (д) `onPointerCancel` помечает жест как «не тап».
- **MA-10**: эффект в Shell — `screen !== "main"` → `BackButton.show()` + `onClick`
  (семантика in-app стрелок: note → edit/main-отмена, edit → returnScreen, иначе main),
  на main → `hide()`. MainButton — WONTFIX: сохранение = тап по категории, сам аудит
  фиксирует «осознанно не нужен».
- **MA-11**: back-кнопки и степперы периодов 36/32px → 44px (`h-11 w-11`, иконки прежние);
  IconBtn главного экрана 40 → 44px; `aria-labelledby` (useId) на Modal.
  Focus-trap в Modal — WONTFIX: touch-first Telegram webview, Esc/backdrop уже работают,
  трап цепляет только десктоп-отладку. Видимый Δ-контекст — в MA-15.
- **MA-12**: `onChange` DatePicker пишет дату в драфт только при непустом значении.
- **MA-13**: удалены `baseCurrency` из State/Action, `"settings"` из ModalName, `BASE_KEY`;
  `DayTotal` захардкожен на EUR (параметр `base` убран); на старте
  `localStorage.removeItem("mini.baseCurrency")` — легаси-значение больше никогда
  не мислейбит DayTotal (SPEC-036 NG1).
- **MA-15**: видимая подпись под Δ-бейджем: «к прошлому мес/году», для текущего
  (in-progress) периода — суффикс «· месяц/год идёт» (урок memory
  `dashed-line-means-forecast`: in-progress подписывается словами). Сама метрика
  Δ не меняется (AC3 SPEC-036 — паритет с SPEC-003); title-дубликат убран
  (недоступен на touch, MA-11).

## 3. Non-goals

- MA-04 «максимум» (сохранение периода/скролла Истории/Статистики в store) — не сейчас.
- MA-07г: запятая на дисплее ввода — осознанно оставлена точка (зеркало клавиши numpad).
- MainButton (MA-10), focus-trap Modal (MA-11) — WONTFIX, обоснование в § 2.
- Keyset-пагинация expenses (MA-14 «настоящий фикс») — отдельная спека по триггеру роста.
- Никаких изменений Worker/D1 — волна целиком клиентская (Mini App).

## 4. Acceptance criteria

- [x] AC1 (MA-03): непустой драфт/экран описания → closing confirmation включён; после resetDraft — выключен.
- [x] AC2 (MA-04): edit из Истории → «Назад»/сохранение/удаление возвращают в Историю; из drill Статистики → в Статистику; из main → на main.
- [x] AC3 (MA-05): запрос дольше 15с обрывается с «Сервер не отвечает…»; offline-ошибка → «Нет сети…»; во время сохранения виден спиннер.
- [x] AC4 (MA-06): смена темы Telegram/OS во время сессии переключает палитру без перезапуска.
- [x] AC5 (MA-07): в BTC вводится 0.00000042, в ETH 0.005; в RSD точка не вводится; 12 цифр видны целиком (шрифт уменьшается, не truncate). Golden-тесты `lib/utils.test.ts`.
- [x] AC6 (MA-08): при сумме «0» бейджи «осталось X €» / «🐷 X €» полной непрозрачности (скриншот-харнес).
- [x] AC7 (MA-09): открыта максимум одна строка; тап по открытой закрывает её; тап-отклик виден; haptic на открытие.
- [x] AC8 (MA-10): на history/stats/edit/note показан Telegram BackButton, ведёт по семантике in-app стрелок; на main скрыт.
- [x] AC9 (MA-11/12/15): touch targets ≥ 44px; Modal связан с заголовком aria-labelledby; пустая дата не пишется в драфт; Δ-подпись видима, in-progress помечен «идёт».
- [x] AC10: `tsc --noEmit` чист, vitest 40/40 (30 stats + 10 numpad/fmt), `npm run build` зелёный, Playwright-харнес light+dark — 0 console errors (фейлы 06/07/11 — pre-existing флак харнеса, воспроизведён на чистом main до правок).

## 5. Changelog

- 2026-07-07: создан, `in_progress`; реализация в ветке `fix/audit-wave3-miniapp`
  (волна 3 аудита). Все 12 находок закрыты (FIX), частичные WONTFIX задокументированы
  в § 2/3. Отметки проставлены в `04-miniapp-ui.md` (gitignored, основной чекаут).
