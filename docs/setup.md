# Setup — как поднять проект с нуля

Эта инструкция собирает всё нужное для запуска системы с чистого MacBook.

## Предварительно (один раз)

### 1. Homebrew пакеты
```bash
brew install python@3.13 node
```

Проверка:
```bash
/opt/homebrew/bin/python3.13 --version    # Python 3.13.x
/opt/homebrew/bin/node --version          # v20+
/opt/homebrew/bin/npm --version           # 10+
```

### 2. Python venv и зависимости
В корне репозитория (`/Users/stepan/Desktop/excel/`):
```bash
/opt/homebrew/bin/python3.13 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

Проверка:
```bash
python -c "import openpyxl, xlsxwriter, requests; print('ok')"
```

### 3. Wrangler CLI
```bash
npm install -g wrangler
wrangler --version    # 3.x или выше
```

### 4. (опционально) Дополнительные утилиты
```bash
brew install --cask libreoffice              # для пересчёта Excel формул через soffice
brew install visidata miller csvkit          # TUI просмотр и pipe-обработка CSV
```

## Аккаунты (бесплатные)

### 5. Cloudflare
1. Регистрация: https://dash.cloudflare.com/sign-up — кредитка **не нужна**.
2. Подтвердить email.
3. Сохранить **Account ID** (правая панель дашборда CF).

### 6. Telegram Bot через @BotFather
1. В Telegram открыть `@BotFather`.
2. `/newbot` → выбрать имя (отображаемое) и username (`<что_то>_bot`).
3. Сохранить **HTTP API Token** (`123456789:ABC...`). Это секрет.
4. (для Mini App) `/newapp` → выбрать бота → задать URL Mini App (будет известен после деплоя Pages).

### 7. Google Sheets для курсов
1. Создать новую Google Sheet `Finance rates`.
2. В первой строке заголовки: `Date | EUR_USD | EUR_RUB | EUR_RSD | EUR_USDT`.
3. Во второй строке формулы:
   - A2: `=TODAY()`
   - B2: `=GOOGLEFINANCE("CURRENCY:EURUSD")`
   - C2: `=GOOGLEFINANCE("CURRENCY:EURRUB")`
   - D2: `=GOOGLEFINANCE("CURRENCY:EURRSD")`
   - E2: `=GOOGLEFINANCE("CURRENCY:EURUSDT")` (если не работает — `=GOOGLEFINANCE("CURRENCY:USDEUR")*1`)
4. File → Share → Publish to web → CSV → копировать URL.

## Деплой Worker (после получения Account ID и bot token)

См. `cloud/README.md`. Кратко:
```bash
cd cloud/worker
wrangler login                                    # OAuth
wrangler d1 create finances-outbox                # создать D1, сохранить database_id в wrangler.toml
wrangler d1 execute finances-outbox --file schema.sql
wrangler secret put TELEGRAM_BOT_TOKEN            # вставить токен
wrangler secret put SYNC_TOKEN                    # сгенерировать длинной строкой
wrangler deploy
```

После деплоя:
1. URL Worker'а — `https://finances-worker.<account>.workers.dev`.
2. В @BotFather: `/setdomain` для бота → ввести URL Pages.
3. В @BotFather: `/setmenubutton` → `Open` → URL Mini App.

## Локальный init

```bash
# Создать БД из schema.sql + миграций
python local/scripts/init_db.py

# Тестовый sync (без D1 пока пусто, должен пройти и сказать "0 records")
python local/scripts/sync.py --once

# Регенерация Excel (на пустой БД — увидим заголовки)
python local/scripts/regenerate_xlsx.py
```

## launchd-агент для автоматического sync

Создать `~/Library/LaunchAgents/com.user.excel-sync.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.user.excel-sync</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Users/stepan/Desktop/excel/.venv/bin/python</string>
        <string>/Users/stepan/Desktop/excel/local/scripts/sync.py</string>
        <string>--once</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>StartInterval</key>
    <integer>900</integer>
    <key>StandardOutPath</key>
    <string>/Users/stepan/Desktop/excel/local/logs/sync.out.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/stepan/Desktop/excel/local/logs/sync.err.log</string>
</dict>
</plist>
```

Загрузить:
```bash
launchctl load ~/Library/LaunchAgents/com.user.excel-sync.plist
```

Это запускает sync каждые 15 минут когда MacBook не спит, плюс при логине.

Если хотите запуск **только при пробуждении** (а не каждые 15 минут) — заменить `StartInterval` на:
```xml
<key>RunAtLoad</key>
<true/>
<key>KeepAlive</key>
<false/>
```
И добавить ловлю wake events через отдельный плист с `LaunchEvents` (системные события).

## Локальные секреты (`.env`)

В корне репозитория `.env` (он в `.gitignore`):
```
# Cloudflare Worker
CF_ACCOUNT_ID=<your-account-id>
CF_WORKER_URL=https://finances-worker.<account>.workers.dev
SYNC_TOKEN=<тот же что в wrangler secret>

# Google Sheets курсов
GOOGLE_RATES_CSV_URL=https://docs.google.com/spreadsheets/d/.../export?format=csv

# Telegram (для тестов из Python)
TELEGRAM_BOT_TOKEN=<token>
```

Никогда не коммитить.

## Проверочный smoke-test

После всего setup'а:
1. Отправить в Telegram бот: `/start` → бот ответит приветствием.
2. Открыть Mini App через `/menubutton` или прямую ссылку.
3. Ввести тестовую трату «1 EUR / Test».
4. На MacBook: `python local/scripts/sync.py --once` → должно показать «pulled 1, inserted 1».
5. Открыть `finances/Finances.xlsx` → новая трата на дашборде.

## Troubleshooting

| Симптом | Что проверить |
|---|---|
| `python: command not found` | venv не активирован: `source .venv/bin/activate` |
| `ModuleNotFoundError: openpyxl` | `pip install -r requirements.txt` |
| `wrangler: command not found` | `npm install -g wrangler` |
| Worker возвращает 401 | проверить `SYNC_TOKEN` в `.env` и `wrangler secret list` |
| Mini App белый экран | проверить `setdomain` у бота, CORS-заголовки Worker |
| Sync не запускается | `launchctl list | grep excel-sync`; логи в `local/logs/` |
| `Finances.xlsx` залочен | закрыть в Excel/Numbers; `lsof Finances.xlsx` пустой |
