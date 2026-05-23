# miniapp — Telegram Mini App

Frontend для ввода трат с iPhone. Открывается внутри Telegram. UI стилизован под «Расходы ОК».

## Стек

- Чистый HTML + ES2023 + CSS (без бандлера).
- Telegram WebApp JS API: https://core.telegram.org/bots/webapps
- Кэш в `localStorage` для офлайн-ввода.

## Структура

```
miniapp/
├── public/
│   ├── index.html         — оболочка, импорт telegram-web-app.js
│   ├── app.js             — основная логика (state, UI, network, outbox)
│   └── styles.css         — UI: сетка категорий, num pad
└── README.md
```

## Локальная разработка

Mini App требует HTTPS endpoint для работы внутри Telegram, поэтому локально полноценно не запустить. Варианты:

1. **`wrangler pages dev public --local`** — локальный HTTPS на :8788, но Telegram не сможет к нему прийти.
2. **Деплой на Pages staging** (отдельный проект `finances-miniapp-staging`), тестировать в `@BotFather` через staging-bot.
3. **`ngrok http 8788`** для проброса локального dev-сервера.

## Деплой

```bash
cd cloud/miniapp
wrangler pages deploy public --project-name=finances-miniapp
```

Mini App URL отдать в @BotFather:
- `/setmenubutton` → `Open` → URL
- `/setdomain` → URL домена

## Telegram API, которое используем

- `Telegram.WebApp.initData` — для отправки в `X-Telegram-Init-Data` header.
- `Telegram.WebApp.HapticFeedback` — тактильный отклик при тапе категории.
- `Telegram.WebApp.MainButton` / `BackButton` — нативные кнопки внизу.
- `Telegram.WebApp.themeParams` — подхватить цвета из темы пользователя.

## UX, к которому стремимся (как в «Расходы ОК»)

- Большая сетка категорий с эмодзи на главном экране.
- Тап → числовая клавиатура поверх.
- Подтверждение → toast «✓ записано» → возврат к категориям.
- История трат — отдельная вкладка.
- Графики (pie по категориям, bar по дням) — третья вкладка.

Полный UI — после Этапа 1 (минимальный текстовый flow для smoke-теста).
