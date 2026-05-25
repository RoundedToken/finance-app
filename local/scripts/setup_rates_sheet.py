#!/usr/bin/env python3
"""setup_rates_sheet.py — однократная настройка Google Sheet «Finance Rates».

Что делает:
  1. Авторизуется в Google как service account (см. docs/setup.md §7).
  2. Создаёт (или открывает существующий) Google Sheet «Finance Rates».
  3. Расшаривает на OWNER_EMAIL как writer и делает public-read (link).
  4. Заполняет лист `latest` формулами GOOGLEFINANCE (текущие курсы EUR→{USD,RUB,RSD,USDT}).
  5. Заполняет лист `history` GOOGLEFINANCE-массивами за период HISTORY_START..сегодня.
  6. Дописывает GOOGLE_RATES_LATEST_CSV и GOOGLE_RATES_HISTORY_CSV в .env.

Идемпотентен: можно перезапускать — листы пересоздаются, формулы переписываются.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent))
from _common import ENV_PATH, GSHEETS_KEY_PATH, load_env  # noqa: E402

# Загружаем .env до чтения значений (OWNER_EMAIL, HISTORY_START, SHEET_TITLE).
load_env()

SHEET_TITLE = os.environ.get("RATES_SHEET_TITLE", "Finance Rates")
OWNER_EMAIL = os.environ.get("RATES_SHEET_OWNER_EMAIL")
if not OWNER_EMAIL:
    raise SystemExit(
        "RATES_SHEET_OWNER_EMAIL не задан в .env — это email, на который "
        "Google Sheet будет расшарен как writer.",
    )
HISTORY_START = os.environ.get("RATES_HISTORY_START", "2024-01-10")


def extract_sheet_id(s: str) -> str:
    """Принимает либо чистый ID, либо URL — возвращает ID."""
    m = re.search(r"/spreadsheets/d/([A-Za-z0-9_-]+)", s)
    return m.group(1) if m else s.strip()

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]


def load_client():
    from google.oauth2.service_account import Credentials
    import gspread

    if not GSHEETS_KEY_PATH.exists():
        sys.stderr.write(f"ERROR: GCP key not found at {GSHEETS_KEY_PATH}\nSee docs/setup.md §7.\n")
        sys.exit(1)
    creds = Credentials.from_service_account_file(str(GSHEETS_KEY_PATH), scopes=SCOPES)
    return gspread.authorize(creds)


def open_by_id(client, sheet_id: str):
    """Открыть Sheet по ID. Service account должен быть расшарен как Editor."""
    import gspread
    try:
        return client.open_by_key(sheet_id)
    except gspread.exceptions.APIError as e:
        sys.stderr.write(
            f"ERROR: cannot open sheet {sheet_id}: {e}\n\n"
            "Скорее всего, service account не расшарен на этот Sheet.\n"
            "Откройте https://docs.google.com/spreadsheets/d/<id>/, нажмите Share,\n"
            f"добавьте {SA_EMAIL_PLACEHOLDER} как Editor (без notify),\n"
            "и запустите скрипт снова.\n"
        )
        sys.exit(1)


SA_EMAIL_PLACEHOLDER = "<service-account-email>"


def load_sa_email() -> str:
    """Читает client_email из service-account JSON для вывода в подсказке."""
    try:
        import json
        return json.loads(GSHEETS_KEY_PATH.read_text()).get("client_email", SA_EMAIL_PLACEHOLDER)
    except Exception:
        return SA_EMAIL_PLACEHOLDER


def get_or_make_worksheet(ss, title: str, rows: int = 100, cols: int = 12):
    """Возвращает worksheet по имени; создаёт или переименовывает дефолтный «Sheet1»."""
    existing = {w.title: w for w in ss.worksheets()}
    if title in existing:
        return existing[title]
    if "Sheet1" in existing:
        existing["Sheet1"].update_title(title)
        ws = existing["Sheet1"]
        ws.resize(rows=rows, cols=cols)
        return ws
    return ss.add_worksheet(title=title, rows=rows, cols=cols)


def fill_latest(ss):
    ws = get_or_make_worksheet(ss, "latest", rows=10, cols=8)
    ws.clear()
    ws.update(
        values=[
            ["date", "EURUSD", "EURRUB", "EURRSD", "EURUSDT"],
            [
                '=TEXT(TODAY(),"YYYY-MM-DD")',
                '=GOOGLEFINANCE("CURRENCY:EURUSD")',
                '=GOOGLEFINANCE("CURRENCY:EURRUB")',
                '=GOOGLEFINANCE("CURRENCY:EURRSD")',
                '=IFERROR(GOOGLEFINANCE("CURRENCY:EURUSDT"), GOOGLEFINANCE("CURRENCY:EURUSD"))',
            ],
        ],
        range_name="A1:E2",
        value_input_option="USER_ENTERED",
    )
    return ws


def fill_history(ss, start_iso: str):
    y, m, d = (int(x) for x in start_iso.split("-"))
    start_expr = f"DATE({y},{m},{d})"
    ws = get_or_make_worksheet(ss, "history", rows=1200, cols=10)
    ws.clear()
    formulas = [
        f'=GOOGLEFINANCE("CURRENCY:EURUSD","close",{start_expr},TODAY(),"DAILY")',
        "", "",
        f'=GOOGLEFINANCE("CURRENCY:EURRUB","close",{start_expr},TODAY(),"DAILY")',
        "", "",
        f'=GOOGLEFINANCE("CURRENCY:EURRSD","close",{start_expr},TODAY(),"DAILY")',
    ]
    ws.update(
        values=[formulas],
        range_name="A1:G1",
        value_input_option="USER_ENTERED",
    )
    return ws


def ensure_share(ss, email: str):
    try:
        ss.share(email, perm_type="user", role="writer", notify=False)
    except Exception as e:
        sys.stderr.write(f"warning: share to {email} failed: {e}\n")


def ensure_public_read(ss):
    try:
        ss.share(None, perm_type="anyone", role="reader", with_link=True)
    except Exception as e:
        sys.stderr.write(f"warning: public-read failed: {e}\n")


def csv_url(spreadsheet_id: str, gid: int) -> str:
    return f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/export?format=csv&gid={gid}"


def upsert_env(updates: dict[str, str]) -> None:
    content = ENV_PATH.read_text() if ENV_PATH.exists() else ""
    for key, value in updates.items():
        line = f"{key}={value}"
        if re.search(rf"^{re.escape(key)}=", content, flags=re.MULTILINE):
            content = re.sub(rf"^{re.escape(key)}=.*$", line, content, flags=re.MULTILINE)
        else:
            if content and not content.endswith("\n"):
                content += "\n"
            content += line + "\n"
    ENV_PATH.write_text(content)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--sheet", help="URL или ID существующего Google Sheet")
    args = ap.parse_args()

    env = load_env()
    sheet_id_raw = args.sheet or env.get("GOOGLE_RATES_SHEET_ID")
    if not sheet_id_raw:
        sys.stderr.write(
            "ERROR: нужен ID или URL уже созданного Google Sheet.\n\n"
            "1. Откройте https://sheets.new (пустой Sheet).\n"
            "2. Назовите «Finance Rates».\n"
            f"3. Share → добавить {load_sa_email()} как Editor (без notify).\n"
            "4. В настройках Sheet поставьте локаль United States.\n"
            "5. Запустите снова: python local/scripts/setup_rates_sheet.py --sheet '<url>'\n"
            "   (URL запишется в .env как GOOGLE_RATES_SHEET_ID, дальше скрипт сам подхватит).\n"
        )
        sys.exit(1)
    sheet_id = extract_sheet_id(sheet_id_raw)

    client = load_client()
    print(f"▶ open sheet {sheet_id}…")
    ss = open_by_id(client, sheet_id)

    print(f"▶ share with {OWNER_EMAIL} (writer)…")
    ensure_share(ss, OWNER_EMAIL)
    print("▶ make public-read (anyone with link)…")
    ensure_public_read(ss)

    print("▶ fill `latest` (today rates)…")
    ws_latest = fill_latest(ss)
    print("▶ fill `history` (2024-01-10..today)…")
    ws_history = fill_history(ss, HISTORY_START)

    latest_url = csv_url(ss.id, ws_latest.id)
    history_url = csv_url(ss.id, ws_history.id)

    print("\nCSV URLs:")
    print(f"  latest:  {latest_url}")
    print(f"  history: {history_url}")

    print(f"\n▶ update {ENV_PATH}…")
    upsert_env({
        "GOOGLE_RATES_SHEET_ID": sheet_id,
        "GOOGLE_RATES_LATEST_CSV": latest_url,
        "GOOGLE_RATES_HISTORY_CSV": history_url,
    })

    print(f"\nsheet: https://docs.google.com/spreadsheets/d/{ss.id}/")
    print("done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
