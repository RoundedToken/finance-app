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
/opt/homebrew/bin/node --version          # v22.5+ (engines в cloud/worker/package.json)
/opt/homebrew/bin/npm --version           # 10+
```

### 2. Python venv и зависимости
В корне репозитория (`/Users/stepan/Projects/finance-app/`):
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

### 7. Google Sheets для курсов (через Service Account)

Используем `GOOGLEFINANCE` как прокси к Google-курсам (ADR-006). Sheet создаётся и редактируется
автоматически из `local/scripts/setup_rates_sheet.py` через GCP Service Account; Worker cron
читает опубликованный CSV без авторизации.

**Один раз — настройка GCP:**

1. https://console.cloud.google.com → `New Project` → имя `<gcp-project>` (реальное имя проекта — вне публичного репо, см. `docs/security.md`).
2. `APIs & Services → Library` → включить **Google Sheets API** и **Google Drive API**.
3. `APIs & Services → Credentials → + CREATE CREDENTIALS → Service account` → имя `<sa-name>`, без ролей.
4. Открыть SA → вкладка `Keys → Add Key → Create new key → JSON`. Скачается файл.
5. Положить ключ:
   ```bash
   mkdir -p ~/.config/finances-gsheets
   chmod 700 ~/.config/finances-gsheets
   mv ~/Downloads/<gcp-project>-*.json ~/.config/finances-gsheets/key.json
   chmod 600 ~/.config/finances-gsheets/key.json
   ```
   **Канонический путь** (зашит в скриптах): `~/.config/finances-gsheets/key.json`.
   Service Account email — что-то вида `<sa-name>@<gcp-project>.iam.gserviceaccount.com`
   (нужен, чтобы расшарить Sheet на свой Gmail для просмотра).

6. Запустить:
   ```bash
   python local/scripts/setup_rates_sheet.py
   ```
   Скрипт создаст Sheet `Finance Rates`, расшарит на ваш email, заполнит формулы
   `GOOGLEFINANCE` в листах `latest` и `history`, опубликует оба как CSV
   и допишет `GOOGLE_RATES_LATEST_CSV` / `GOOGLE_RATES_HISTORY_CSV` в `.env`.

7. Прописать URL в Worker: `GOOGLE_RATES_LATEST_CSV` — это **var**, не secret
   (см. `cloud/worker/wrangler.example.toml` `[vars]`). Вставить значение из `.env`
   в `cloud/worker/wrangler.toml` (файл в `.gitignore`) и передеплоить worker.

**Где живёт ключ (для будущих сессий):** `~/.config/finances-gsheets/key.json`.
Этот путь зафиксирован в `local/scripts/_common.py → GSHEETS_KEY_PATH`.
Если переносите ключ — обновите путь там и в этой инструкции.

### 8. Google OAuth Client для Web Admin (ADR-012)

Web Admin использует Google OAuth для входа. Нужен Web-OAuth Client в том же GCP-проекте, что и Service Account для Sheets (`<gcp-project>`).

В 2026 году Google переименовала «OAuth consent screen» в **Google Auth Platform** (`console.cloud.google.com/auth/overview`). Шаги под актуальный UI:

**A. Инициализация Auth Platform** (если ранее не настраивали — на overview увидишь «not configured yet»):

Нажать **Get started**, пройти wizard:
1. **App Information:** App name = `Finances Admin`, User support email = твой Google-email (тот же, для которого делаем allowlist).
2. **Audience:** `External` (для личного Google-аккаунта это единственный вариант).
3. **Contact Information:** Developer email = тот же.
4. **Finish:** согласиться с *Google API Services User Data Policy* → **Create**.

**B. Audience → Test users:**
Слева **Audience** → **Test users** → **Add users** → твой allowlisted email → **Save**.
Без этого Google вернёт «Access blocked» при логине. В Testing-режиме допускается до 100 test users без верификации app.

**C. Data Access → Scopes:**
Слева **Data Access** → **Add or Remove Scopes** → отметить:
- `openid`
- `.../auth/userinfo.email`

→ **Update** → **Save**.

**D. Clients → Create Client (OAuth Client ID):**
Слева **Clients** → **Create Client**:
- Application type: **Web application**
- Name: `Finances Admin Web`
- Authorized JavaScript origins:
  - `https://finances-admin.pages.dev`
  - `http://localhost:5174` (для dev)
- Authorized redirect URIs:
  - `https://<your-worker>.workers.dev/v1/auth/google/callback`
  - (если меняли URL Worker'а — подставить свой)

→ **Create**. Модал покажет **Client ID** и **Client secret** — скопировать оба сразу (secret потом можно только сбросить).

**Установить secrets в Worker:**
```bash
cd cloud/worker
wrangler secret put GOOGLE_CLIENT_ID         # вставить Client ID
wrangler secret put GOOGLE_CLIENT_SECRET     # вставить Client secret
wrangler secret put ADMIN_JWT_SECRET         # сгенерить: openssl rand -base64 48
```

`GOOGLE_REDIRECT_URI`, `ADMIN_ALLOWED_EMAILS`, `ADMIN_ALLOWED_ORIGINS`, `ADMIN_DEFAULT_RETURN_URL` живут как vars в `cloud/worker/wrangler.toml` — править там при смене URL.

## Деплой Worker (после получения Account ID и bot token)

См. `cloud/README.md`. Кратко:
```bash
cd cloud/worker
wrangler login                                    # OAuth
wrangler d1 create finances-outbox                # создать D1, сохранить database_id в wrangler.toml
wrangler d1 execute finances-outbox --file schema.sql
wrangler secret put TELEGRAM_BOT_TOKEN            # вставить токен
wrangler secret put TELEGRAM_WEBHOOK_SECRET       # openssl rand -hex 32 (защита /tg, SEC-04)
wrangler secret put SYNC_TOKEN                    # сгенерировать длинной строкой
# (см. секцию 8 выше для Google OAuth secrets)
wrangler deploy
```

После деплоя:
1. URL Worker'а — `https://finances-worker.<account>.workers.dev`.
2. Привязать webhook бота **с тем же секретом**, что в `TELEGRAM_WEBHOOK_SECRET`
   (иначе Worker будет отвечать 403 на апдейты Telegram):
   ```bash
   curl -s "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d "url=https://<worker>/tg" -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
   ```
   Worker сверяет заголовок `X-Telegram-Bot-Api-Secret-Token` constant-time;
   без секрета в env проверка выключена (bootstrap-совместимость) — на проде
   секрет обязателен.
3. В @BotFather: `/setdomain` для бота → ввести URL Pages.
4. В @BotFather: `/setmenubutton` → `Open` → URL Mini App.

## Деплой Web Admin (Cloudflare Pages)

```bash
cd cloud/admin
npm install
npm run build

# Первый раз — создаём Pages project:
npx wrangler pages project create finances-admin --production-branch main

# Деплой:
npm run deploy
# → URL: https://finances-admin.pages.dev
```

После первого деплоя:
1. Убедиться, что URL совпадает с `ADMIN_ALLOWED_ORIGINS` в `cloud/worker/wrangler.toml`. Если отличается — поправить и redeploy worker.
2. Тоже самое для `connect-src` в `cloud/admin/public/_headers` (CSP).
3. Тоже самое для Authorized origins в OAuth Client (Google Console).

Локальная разработка:
```bash
cd cloud/admin
npm run dev      # http://localhost:5174
```
Для локальной dev не забыть, что localhost тоже должен быть в Google Console → Authorized origins и в `ADMIN_ALLOWED_ORIGINS` (если хочется логиниться в локальный SPA).

## Локальный init

Не нужен: **источник правды — D1** (ADR-011), локальной БД нет. Схема создаётся
на шаге «Деплой Worker» (`wrangler d1 execute finances-outbox --file schema.sql`).
Всё локальное — только daily backup (см. следующий раздел) и UI тест-харнесы
(`local/README.md` § Тестовые харнесы).

> До-D1 скрипты `init_db.py` / `migrate_to_d1.py` в `local/scripts/` — архив
> старой эпохи, не запускать (см. `local/README.md`).

## launchd-агент для daily backup D1

> До-D1 sync-агент (`sync.py`, каждые 15 минут) упразднён вместе с локальной БД (ADR-011).
> Единственный агент — ежедневный бэкап D1.

Готовый plist лежит в репо: `local/launchd/com.user.finance-backup.plist`
(пути внутри привязаны к `~/Projects/finance-app`; запуск ежедневно в 10:30
через `StartCalendarInterval` — календарный таймер, в отличие от `StartInterval`,
догоняет пропущенный запуск после пробуждения ноутбука — плюс `RunAtLoad`).

Установить:
```bash
cp local/launchd/com.user.finance-backup.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.user.finance-backup.plist
```

Проверить (второй столбец = last exit status, должен быть 0):
```bash
launchctl list | grep finance-backup
tail -5 local/logs/backup.out.log
```

Скрипт `local/scripts/backup_d1.py`: `wrangler d1 export` → `local/backups/d1-<ts>.sql`,
verify-фаза (импорт дампа в temp-sqlite + count ключевых таблиц), копия в iCloud Drive
(`~/Library/Mobile Documents/com~apple~CloudDocs/finances-backups/`), ротация (30 копий).

## Локальные секреты (`.env`)

В корне репозитория `.env` (он в `.gitignore`):
```
# Cloudflare Worker
CF_ACCOUNT_ID=<your-account-id>
CF_WORKER_URL=https://finances-worker.<account>.workers.dev
SYNC_TOKEN=<тот же что в wrangler secret>

# Google Sheets курсов (пишет setup_rates_sheet.py, читает worker — см. шаг 6 выше)
GOOGLE_RATES_LATEST_CSV=https://docs.google.com/spreadsheets/d/.../export?format=csv&gid=...
GOOGLE_RATES_HISTORY_CSV=https://docs.google.com/spreadsheets/d/.../export?format=csv&gid=...

# Telegram (для тестов из Python)
TELEGRAM_BOT_TOKEN=<token>
```

Никогда не коммитить.

## Авторизация: добавление пользователей в whitelist

**Bot полностью молчит для всех, кого нет в `authorized_users`** — это намеренное security-решение (см. `docs/decisions.md` ADR-009). Поэтому отправлять `/start` от незарегистрированного аккаунта **бесполезно** — бот не ответит, только запишет попытку в Worker logs.

### Как узнать Telegram ID нового пользователя

Три варианта по убыванию удобства:

1. **`@userinfobot`** в Telegram → перешлите ему любое сообщение от целевого пользователя → бот вернёт ID.
2. **Worker logs**: попросите целевого пользователя написать любое сообщение нашему боту. В `wrangler tail` появится строка вида:
   ```json
   {"event":"unauthorized_attempt","user_id":"<TELEGRAM_ID>","username":"...","text_preview":"hi"}
   ```
3. **Сам пользователь** через сторонний бот: `@username_to_id_bot` или `@getmyid_bot`.

### Как добавить в whitelist

```bash
cd cloud/worker
wrangler d1 execute finances-outbox --remote \
  --command="INSERT OR IGNORE INTO authorized_users (telegram_id, name) VALUES ('123456789', 'Имя')"
```

### Как проверить кто в whitelist

```bash
wrangler d1 execute finances-outbox --remote --command="SELECT * FROM authorized_users"
```

### Как убрать пользователя

```bash
wrangler d1 execute finances-outbox --remote \
  --command="DELETE FROM authorized_users WHERE telegram_id = '123456789'"
```

## Проверочный smoke-test

После всего setup'а (включая добавление в whitelist):
1. `curl https://<worker>/healthz` → `{"ok":true}`.
2. Отправить в Telegram боту: `/start` → бот ответит приветствием **только если вы в whitelist**.
3. Отправить `25 EUR food магазин` → бот подтвердит запись.
4. Открыть Mini App (кнопка меню бота) → трата видна в Истории.
5. Открыть Web Admin (`https://finances-admin.pages.dev`) → Google login проходит, `/expenses` показывает трату.
6. `python local/scripts/backup_d1.py` → дамп появился в `local/backups/` (и в iCloud).

## Troubleshooting

| Симптом | Что проверить |
|---|---|
| `python: command not found` | venv не активирован: `source .venv/bin/activate` |
| `ModuleNotFoundError: openpyxl` | `pip install -r requirements.txt` |
| `wrangler: command not found` | `npm install -g wrangler` |
| Worker возвращает 401 | проверить `SYNC_TOKEN` в `.env` и `wrangler secret list` |
| Mini App белый экран | проверить `setdomain` у бота, CORS-заголовки Worker |
| Backup не запускается | `launchctl list | grep finance-backup`; логи в `local/logs/` |
| `Finances.xlsx` (legacy) залочен | закрыть в Excel/Numbers; `lsof Finances.xlsx` пустой |
