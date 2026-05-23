# cloud — Cloudflare Worker + Mini App

Облачная часть системы. **Не VPS** — это serverless functions Cloudflare. Деплоится через `wrangler`.

## Структура

```
cloud/
├── README.md                   ← этот файл
├── worker/                     ← Cloudflare Worker (TypeScript)
│   ├── src/
│   │   ├── index.ts            ← главный fetch handler + cron
│   │   ├── auth.ts             ← Telegram initData + bearer token
│   │   ├── db.ts               ← D1 helpers
│   │   ├── api.ts              ← /v1/expenses, /v1/sync*
│   │   ├── bot.ts              ← /tg webhook (Telegram bot)
│   │   └── types.ts
│   ├── schema.sql              ← DDL для D1
│   ├── wrangler.toml           ← конфиг Workers + D1 binding + cron
│   ├── package.json
│   ├── tsconfig.json
│   └── .gitignore
└── miniapp/                    ← Telegram Mini App (HTML/JS)
    ├── public/
    │   ├── index.html          ← shell приложения
    │   ├── app.js              ← логика
    │   └── styles.css
    ├── README.md
    └── .gitignore
```

## Endpoints Worker

| Method | Path | Кто вызывает | Описание |
|---|---|---|---|
| `POST` | `/tg` | Telegram сервера (webhook) | приём message от bot |
| `POST` | `/v1/expenses` | Mini App | записать трату |
| `GET` | `/v1/sync` | MacBook | забрать новое из outbox |
| `POST` | `/v1/sync/confirm` | MacBook | пометить полученные |
| `POST` | `/v1/admin/references` | MacBook | push справочников |
| `GET` | `/v1/bootstrap` | Mini App | подтянуть справочники для UI |
| `POST` | `/cron` | Cloudflare cron trigger | очистка outbox |

Подробно — `docs/sync-protocol.md`.

## Первичный деплой (один раз)

```bash
cd cloud/worker

# Залогиниться через OAuth (открывает браузер)
wrangler login

# Создать D1 базу. Выдаст database_id — вставить в wrangler.toml
wrangler d1 create finances-outbox

# Применить DDL
wrangler d1 execute finances-outbox --file=schema.sql --remote

# Положить секреты в Cloudflare (значения вводятся интерактивно)
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put SYNC_TOKEN

# Установить зависимости и задеплоить
npm install
wrangler deploy
```

После деплоя Cloudflare даст URL вида `https://finances-worker.<account>.workers.dev`.

## Настройка webhook у Telegram

```bash
WORKER_URL=https://finances-worker.<account>.workers.dev
BOT_TOKEN=<тот же что в wrangler secret>

curl "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${WORKER_URL}/tg"
```

## Mini App деплой

```bash
cd cloud/miniapp
wrangler pages deploy public --project-name=finances-miniapp
```

После деплоя URL → дать @BotFather через `/setmenubutton`.

## Локальная разработка

```bash
cd cloud/worker
wrangler dev               # локальный Worker на :8787
wrangler dev --remote      # с реальной D1 (для интеграционного теста)
wrangler tail              # live-логи продакшен Worker'а
```

## Очистка outbox (вручную)

```bash
wrangler d1 execute finances-outbox \
  --command="DELETE FROM expenses_outbox WHERE confirmed_at < datetime('now', '-7 days')"
```

В норме это делает cron-trigger автоматически.
