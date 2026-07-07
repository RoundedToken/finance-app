# Security protocols

Этот документ — обязательный чеклист для работы с публичным репозиторием. Если что-то здесь сломано, **push останавливается**.

## Что считается чувствительным

| Категория | Примеры | Где хранится |
|---|---|---|
| **Секреты** (must never leak) | Telegram bot token, OAuth client secret, JWT signing secret, SYNC_TOKEN, GCP service-account JSON, любые API keys | `wrangler secret` (cloud), `~/.config/finances-*/` (локальные ключи), `.env` (gitignored) |
| **PII** (personal identity) | Email владельца, Telegram ID, реальные имена | env переменные / wrangler vars / `.env` |
| **Финансовые данные** | Суммы трат, балансы счетов, скриншоты UI с числами, D1 dumps, Legacy `Finances.xlsx`, CSV «Расходы ОК» | Только локально: `local/backups/`, `local/screenshots/`, `data/legacy/`, `data/money-ok/` — всё в `.gitignore` |
| **Identifiable infra IDs** | Cloudflare account_id, D1 database_id, persona-specific URLs (subdomain), Google Sheet ID | `cloud/worker/wrangler.toml` (gitignored), пример в `wrangler.example.toml` |

Хотя identifiable infra IDs *technically* не дают доступа без auth, мы прячем их по соображениям privacy.

## Что в `.gitignore`

| Паттерн | Зачем |
|---|---|
| `.env`, `.env.local`, `.env.*.local` | Секреты в env |
| `*-service-account*.json`, `client_secret*.json`, `*googleusercontent*.json`, `oauth-client*.json` | OAuth/Service Account JSON |
| `cloud/worker/wrangler.toml`, `cloud/admin/wrangler.toml` | Real config (см. `wrangler.example.toml`) |
| `cloud/admin/.env`, `cloud/admin/.env.local` | Vite env с `VITE_API_BASE` |
| `data/**` (кроме `data/README.md` и `data/*/`) | Personal source data |
| `reports/**` (кроме README) | Generated artefacts с реальными цифрами |
| `local/*.db`, `local/backups/`, `local/backups/*.db`, `local/backups/d1-*.sql` | Локальные backup'ы D1 — содержат **всю** финансовую историю |
| `local/screenshots/` | Playwright UI скрины с реальными числами |
| `*.secret`, `secrets/` | Catch-all |

**Правило**: добавил новый файл с потенциально приватными данными — сразу обнови `.gitignore`. Проверь `git status` перед commit'ом.

## Pre-commit hook (gitleaks)

`gitleaks` блокирует commit, если в staged-файлах найдены secret-паттерны.

Установка (один раз):
```bash
brew install gitleaks                         # macOS
ln -s ../../.githooks/pre-commit .git/hooks/pre-commit
chmod +x .githooks/pre-commit
```

Hook лежит в `.githooks/pre-commit` (трекается в git, потому что в `.git/hooks/` git-specific).

При срабатывании:
```
WRN leaks found: 1
Файл: cloud/worker/foo.ts (LINE 42, rule: telegram-bot-api-token)
```
Удалить токен → переставить в `wrangler secret` или `.env` → re-stage → re-commit.

Обход hook'а:
- `git commit --no-verify` (**не использовать без явной необходимости**).
- Если ложный positive — добавить в `.gitleaksignore` или `.gitleaks.toml` точечно.

**Вторая линия обороны — CI** (QA-11, SPEC-047): job `gitleaks` в
`.github/workflows/ci.yml` гоняет `gitleaks/gitleaks-action` по полной истории
на каждый push/PR — секрет, проскочивший мимо локального (opt-in) хука,
подсветится до долгой жизни в default-ветке.

## Перед каждым push в public

Чеклист (выполняется руками — авто-таргета `make security-check` нет, не выдумывать):

1. `git status` — нет ли в untracked файлов с секретами / личными данными?
2. `gitleaks dir --no-banner` — clean?
3. `gitleaks git --no-banner` — clean по истории?
4. `grep -rn "<your-email>"` (если email есть) — заменён на placeholder?
5. `wrangler.toml` не в staged?
6. `local/backups/`, `local/screenshots/`, `data/`, `reports/` не в staged?

## Если случайно закоммитил секрет

1. **Тут же ротировать** через `wrangler secret put <NAME>` / Google Console reset client secret / @BotFather `/revoke`.
2. Прибить commit из истории: `git filter-repo --invert-paths --path <file>` (или `git filter-branch` если filter-repo нет).
3. Force-push: `git push --force` (только если ты единственный пользователь репо).
4. Уведомить всех у кого был clone, что нужно перетянуть.

Лучший способ — не доводить до этой ситуации. Pre-commit hook + чеклист выше.

## Что НЕ скрываем (intentionally public)

- Архитектура (`docs/architecture.md`, `docs/decisions.md`).
- API contract (endpoints `/v1/...`, query/body shape).
- D1 схема (`schema.sql`, `migrations/`).
- Имена endpoints, имена таблиц, имена env vars (но не их значения).
- URL deployment'а на `*.workers.dev` / `*.pages.dev` **можно** обнаружить через Network panel у любого пользователя. Но persona-specific Worker-субдомен (содержит имя владельца) в репо всё равно **не храним** (аудит 2026-07, SEC-05): и Mini App, и Admin берут его из `VITE_API_BASE` (`cloud/*/​.env`, gitignored; шаблоны — `.env.example`), а `cloud/admin/public/_headers` держит placeholder `__WORKER_ORIGIN__`, который build-time подставляется vite-плагином из `VITE_API_BASE`.
