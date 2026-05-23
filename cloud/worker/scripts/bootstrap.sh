#!/usr/bin/env bash
# Bootstrap Cloudflare Worker + D1 для finances-системы.
#
# Запустить ОДИН раз после:
#   1. wrangler login (откроет браузер для авторизации)
#   2. Заполнить .env (CF_ACCOUNT_ID, SYNC_TOKEN — уже есть)
#   3. Положить TELEGRAM_BOT_TOKEN в .env (или будет интерактивный prompt).
#
# Идемпотентен: повторный запуск не сломает существующий setup.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${WORKER_DIR}/../.." && pwd)"

cd "${WORKER_DIR}"

# ── Load .env ───────────────────────────────────────────────────────────────
if [[ ! -f "${REPO_ROOT}/.env" ]]; then
    echo "ERROR: ${REPO_ROOT}/.env not found"
    exit 1
fi
set -a
# shellcheck disable=SC1091
source "${REPO_ROOT}/.env"
set +a

# ── Pre-flight ──────────────────────────────────────────────────────────────
echo "▶ Checking wrangler login..."
if ! wrangler whoami >/dev/null 2>&1; then
    echo "  Not logged in. Running 'wrangler login' (откроет браузер)..."
    wrangler login
fi
echo "  ✓ logged in as: $(wrangler whoami 2>&1 | grep -E 'You are logged in|email' | head -1 || echo 'unknown')"

# ── D1 database ─────────────────────────────────────────────────────────────
echo "▶ Checking D1 database 'finances-outbox'..."
if wrangler d1 list 2>/dev/null | grep -q 'finances-outbox'; then
    echo "  ✓ already exists"
    DB_ID=$(wrangler d1 list --json 2>/dev/null | python3 -c "
import json, sys
for db in json.load(sys.stdin):
    if db.get('name') == 'finances-outbox':
        print(db.get('uuid'))
        break
")
else
    echo "  Creating..."
    CREATE_OUT=$(wrangler d1 create finances-outbox 2>&1)
    echo "${CREATE_OUT}"
    DB_ID=$(echo "${CREATE_OUT}" | grep -oE '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}' | head -1)
    if [[ -z "${DB_ID}" ]]; then
        echo "ERROR: could not parse database_id"
        exit 1
    fi
fi
echo "  database_id: ${DB_ID}"

# ── Patch wrangler.toml ─────────────────────────────────────────────────────
if grep -q 'TODO_FILL_AFTER_wrangler_d1_create' wrangler.toml; then
    echo "▶ Patching wrangler.toml with database_id..."
    sed -i.bak "s|TODO_FILL_AFTER_wrangler_d1_create|${DB_ID}|g" wrangler.toml
    rm -f wrangler.toml.bak
    echo "  ✓ done"
fi

# ── Apply schema ────────────────────────────────────────────────────────────
echo "▶ Applying schema to D1..."
wrangler d1 execute finances-outbox --file=schema.sql --remote
echo "  ✓ schema applied"

# ── Set secrets ─────────────────────────────────────────────────────────────
echo "▶ Setting SYNC_TOKEN secret..."
echo -n "${SYNC_TOKEN}" | wrangler secret put SYNC_TOKEN
echo "  ✓ done"

echo "▶ Setting TELEGRAM_BOT_TOKEN secret..."
if [[ -n "${TELEGRAM_BOT_TOKEN:-}" ]]; then
    echo -n "${TELEGRAM_BOT_TOKEN}" | wrangler secret put TELEGRAM_BOT_TOKEN
    echo "  ✓ from .env"
else
    echo "  TELEGRAM_BOT_TOKEN empty in .env — interactive prompt:"
    wrangler secret put TELEGRAM_BOT_TOKEN
fi

# ── Deploy ──────────────────────────────────────────────────────────────────
echo "▶ Deploying worker..."
wrangler deploy

# ── Webhook ─────────────────────────────────────────────────────────────────
WORKER_URL="${CF_WORKER_URL:-}"
if [[ -z "${WORKER_URL}" ]]; then
    echo "WARNING: CF_WORKER_URL not set in .env — webhook not configured"
else
    echo "▶ Setting Telegram webhook → ${WORKER_URL}/tg..."
    if [[ -n "${TELEGRAM_BOT_TOKEN:-}" ]]; then
        curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=${WORKER_URL}/tg"
        echo
    else
        echo "  TELEGRAM_BOT_TOKEN empty — run manually:"
        echo "    curl 'https://api.telegram.org/bot<TOKEN>/setWebhook?url=${WORKER_URL}/tg'"
    fi
fi

# ── Whitelist user ──────────────────────────────────────────────────────────
echo
echo "▶ Next: add yourself to authorized_users."
echo "  Run after first /start in bot:"
echo "    wrangler d1 execute finances-outbox --remote --command=\\"
echo "      \"INSERT OR IGNORE INTO authorized_users (telegram_id, name) VALUES ('<your-tg-id>', 'Stepan');\""
echo
echo "✓ bootstrap done."
