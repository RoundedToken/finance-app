# miniapp — Telegram Mini App

Frontend для ввода трат с iPhone. Открывается внутри Telegram. **Scope: только ввод расходов** (аналитика — в Web Admin, см. корневой `CLAUDE.md` правило 11).

## Стек (после SPEC-014 React-rewrite)

- React 19 + Vite 5 + TypeScript.
- TanStack Query (server-state).
- Tailwind + class-variance-authority + clsx + tailwind-merge.
- Telegram WebApp JS API: https://core.telegram.org/bots/webapps — auth через `initData` HMAC.
- Кэш в `localStorage` для офлайн-ввода (UUID на клиенте → идемпотентно).

> Vanilla-версия (`public/app.js` + `styles.css`) снята в Стадии 2 — была заменена React-кодом в `src/`. История в git.

## Структура

```
miniapp/
├── index.html             — корневой entry (грузит /src/main.tsx + telegram-web-app.js)
├── src/
│   ├── main.tsx, App.tsx, store.tsx
│   ├── screens/           — MainScreen, HistoryScreen, EditScreen, NoteScreen
│   ├── components/        — Numpad, Modal, SwipeRow, Currency, DayTotal, Toast, …
│   ├── api/               — client.ts, queries.ts, types.ts
│   └── lib/               — telegram.ts, utils.ts
├── vite.config.ts
└── tailwind.config.ts
```

## Локальная разработка

Mini App требует HTTPS endpoint внутри Telegram, локально полноценно не запустить:
1. `npm run dev` — Vite dev-сервер (:5175) для верстки в браузере (без Telegram-контекста).
2. Деплой на Pages staging + тест через staging-bot в `@BotFather`.
3. `ngrok` для проброса dev-сервера.

UI-тесты: `local/scripts/test_miniapp_react.py` (Playwright) + `test_miniapp_ios.py` (Appium + iOS Simulator, реальная клавиатура).

## Деплой

```bash
cd cloud/miniapp
npm run deploy        # vite build → wrangler pages deploy dist --project-name=finances-miniapp
```

Mini App URL в @BotFather: `/setmenubutton` → `Open` → URL; `/setdomain` → домен.

## Telegram API, которое используем

- `Telegram.WebApp.initData` — в `X-Telegram-Init-Data` header.
- `Telegram.WebApp.HapticFeedback` — тактильный отклик.
- `Telegram.WebApp.themeParams` — цвета из темы пользователя.
