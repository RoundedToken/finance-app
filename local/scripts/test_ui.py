#!/usr/bin/env python3
"""test_ui.py — авто-скриншоты Mini App через Playwright.

Запускает локальный HTTP-сервер на cloud/miniapp/public/, мокает
window.Telegram.WebApp и fetch (бутстрап подменяется на синтетические данные
с реальной структурой категорий и валют), прогоняет сценарии и кладёт
скриншоты в local/screenshots/.

Usage:
    python local/scripts/test_ui.py
    python local/scripts/test_ui.py --headed         # видеть браузер
    python local/scripts/test_ui.py --only stats     # запустить только сценарии содержащие "stats"
"""
from __future__ import annotations

import argparse
import datetime as dt
import http.server
import json
import random
import socketserver
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
PUBLIC_DIR = ROOT / "cloud" / "miniapp" / "public"
OUT_DIR = ROOT / "local" / "screenshots"

# Реальные категории/цвета из D1 на 2026-05-24 (sync через wrangler d1 execute).
CATEGORIES = [
    {"id": "food", "name": "Еда", "color": "#FFB199", "emoji": "🍔"},
    {"id": "groceries", "name": "Продукты", "color": "#B5E3C5", "emoji": "🛒"},
    {"id": "sport", "name": "Спорт", "color": "#F4C97A", "emoji": "⚽"},
    {"id": "cafe", "name": "Кафе", "color": "#D7B894", "emoji": "☕"},
    {"id": "tips", "name": "Чаевые", "color": "#D9E6A8", "emoji": "💵"},
    {"id": "transport", "name": "Транспорт", "color": "#A8C8F0", "emoji": "🚗"},
    {"id": "clothing", "name": "Одежда", "color": "#E6B5D6", "emoji": "👕"},
    {"id": "shopping", "name": "Покупки", "color": "#F2A8C8", "emoji": "🛍️"},
    {"id": "electronics", "name": "Техника", "color": "#B0AFE0", "emoji": "📱"},
    {"id": "entertainment", "name": "Развлечения", "color": "#C9A8E8", "emoji": "🎬"},
    {"id": "leisure", "name": "Досуг", "color": "#D6B894", "emoji": "🎳"},
    {"id": "health", "name": "Здоровье", "color": "#FAA8A8", "emoji": "⚕️"},
    {"id": "beauty", "name": "Красота", "color": "#F4B8C2", "emoji": "💄"},
    {"id": "home", "name": "Дом", "color": "#E8D29B", "emoji": "🏠"},
    {"id": "housing", "name": "Жильё", "color": "#A0B8D9", "emoji": "🏘️"},
    {"id": "subscriptions", "name": "Подписки", "color": "#B8C2D9", "emoji": "📺"},
    {"id": "utilities", "name": "Коммуналка", "color": "#F8DE7E", "emoji": "💡"},
    {"id": "government", "name": "Гос услуги", "color": "#C4C4D4", "emoji": "🏛️"},
    {"id": "debts", "name": "Долги", "color": "#E6A8A8", "emoji": "💳"},
    {"id": "travel", "name": "Поездки", "color": "#9ED5D5", "emoji": "✈️"},
    {"id": "education", "name": "Образование", "color": "#C9E0B5", "emoji": "📚"},
    {"id": "gifts", "name": "Подарки", "color": "#E8B6E0", "emoji": "🎁"},
    {"id": "fees", "name": "Комиссии", "color": "#D5D5D5", "emoji": "💳"},
    {"id": "adult", "name": "18+", "color": "#D9A8C2", "emoji": "🔞"},
    {"id": "other", "name": "Прочее", "color": "#BDBDBD", "emoji": "❓"},
]
CURRENCIES = [
    {"code": "EUR", "name": "Евро", "emoji": "🇪🇺", "is_crypto": 0, "decimals": 2},
    {"code": "RSD", "name": "Динар", "emoji": "🇷🇸", "is_crypto": 0, "decimals": 2},
    {"code": "RUB", "name": "Рубль", "emoji": "🇷🇺", "is_crypto": 0, "decimals": 2},
    {"code": "USD", "name": "Доллар", "emoji": "🇺🇸", "is_crypto": 0, "decimals": 2},
    {"code": "USDT", "name": "Тезер", "emoji": "₮", "is_crypto": 1, "decimals": 2},
]
ACCOUNTS = [
    {"id": "main", "name": "Основной", "type": "cash", "currency": "RSD", "is_active": 1, "color": "#a78bfa"},
]
RATES = {"date": "2026-05-24", "base": "EUR", "quotes": {"USD": 1.16, "RSD": 117.41, "RUB": 82.63, "USDT": 1.16, "EUR": 1.0}}


def gen_expenses(n_days=870, today=dt.date(2026, 5, 24)):
    """Синтетический «реалистичный» набор: 0..6 трат в день, перекос на еду/продукты/транспорт."""
    rng = random.Random(42)
    weights = {
        "food": 14, "groceries": 12, "transport": 10, "cafe": 8, "sport": 6, "entertainment": 5,
        "clothing": 4, "leisure": 4, "health": 3, "shopping": 3, "subscriptions": 3,
        "utilities": 2, "housing": 2, "electronics": 2, "beauty": 2, "tips": 2,
        "home": 2, "education": 1, "gifts": 1, "travel": 1, "fees": 1, "debts": 1,
        "government": 1, "other": 1, "adult": 1,
    }
    pool = []
    for cid, w in weights.items():
        pool.extend([cid] * w)
    ccy_weights = ["RSD"] * 10 + ["EUR"] * 4 + ["RUB"] * 2 + ["USD"] * 1
    out = []
    for d in range(n_days):
        day = today - dt.timedelta(days=d)
        n = rng.choice([0, 1, 1, 2, 2, 3, 3, 4, 5])
        for _ in range(n):
            cat = rng.choice(pool)
            ccy = rng.choice(ccy_weights)
            base = {"food": 800, "groceries": 2500, "cafe": 1500, "transport": 600, "sport": 4000,
                    "clothing": 6000, "housing": 80000, "utilities": 15000, "electronics": 30000,
                    "entertainment": 3500, "leisure": 2500, "health": 4000, "shopping": 5000,
                    "tips": 300, "subscriptions": 800, "beauty": 4000, "home": 2000,
                    "education": 5000, "gifts": 3000, "travel": 50000, "fees": 200, "debts": 10000,
                    "government": 5000, "other": 1000, "adult": 2000}.get(cat, 1000)
            amount = round(base * (0.3 + rng.random() * 1.7), 0)
            if ccy == "EUR":
                amount = round(amount / 117, 2)
            elif ccy == "RUB":
                amount = round(amount / 1.42, 0)
            elif ccy == "USD":
                amount = round(amount / 110, 2)
            out.append({
                "id": f"mock-{d}-{_}",
                "date": day.isoformat(),
                "account_id": "main",
                "amount": amount,
                "currency": ccy,
                "category_id": cat,
                "note": None,
                "source": "mock",
                "created_at": day.isoformat() + "T12:00:00Z",
                "updated_at": day.isoformat() + "T12:00:00Z",
            })
    return out


def build_bootstrap_payload():
    return {
        "accounts": ACCOUNTS,
        "categories": [{**c, "type": "expense", "parent_id": None, "sort_order": i, "is_active": 1}
                       for i, c in enumerate(CATEGORIES)],
        "currencies": CURRENCIES,
        "expenses": gen_expenses(),
        "rates": RATES,
    }


def start_http_server(directory: Path, port: int = 8765):
    handler_cls = lambda *a, **kw: http.server.SimpleHTTPRequestHandler(*a, directory=str(directory), **kw)
    server = socketserver.TCPServer(("127.0.0.1", port), handler_cls)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, port


def init_script(payload_json: str) -> str:
    return f"""
        window.__MOCK_BOOTSTRAP = {payload_json};
        window.Telegram = {{
            WebApp: {{
                initData: "mock=1",
                ready: () => {{}},
                expand: () => {{}},
                disableVerticalSwipes: () => {{}},
                setHeaderColor: () => {{}},
                setBackgroundColor: () => {{}},
                HapticFeedback: {{ selectionChanged: () => {{}}, impactOccurred: () => {{}} }},
            }}
        }};
        const _origFetch = window.fetch;
        window.fetch = async function(url, options) {{
            const u = typeof url === "string" ? url : url.url;
            if (u.includes("/v1/bootstrap")) {{
                return new Response(JSON.stringify(window.__MOCK_BOOTSTRAP), {{
                    status: 200,
                    headers: {{ "content-type": "application/json" }},
                }});
            }}
            if (u.includes("/v1/expenses") || u.includes("/v1/rates")) {{
                return new Response(JSON.stringify({{ ok: true }}), {{
                    status: 200,
                    headers: {{ "content-type": "application/json" }},
                }});
            }}
            return _origFetch(url, options);
        }};
    """


SCENARIOS = [
    {"name": "01_main", "go": None, "actions": []},
    {"name": "02_main_with_amount", "go": None, "actions": [
        ("click", ".numpad button:nth-child(2)"),
        ("click", ".numpad button:nth-child(5)"),
        ("click", ".numpad button:nth-child(8)"),
    ]},
    {"name": "03_menu", "go": None, "actions": [("click", "#open-menu")]},
    {"name": "04_stats_month", "go": "stats", "actions": []},
    {"name": "05_stats_year", "go": "stats", "actions": [
        ("click", "#stats-tabs button[data-period='year']"),
    ]},
    {"name": "06_stats_all", "go": "stats", "actions": [
        ("click", "#stats-tabs button[data-period='all']"),
    ]},
    {"name": "07_stats_week", "go": "stats", "actions": [
        ("click", "#stats-tabs button[data-period='week']"),
    ]},
    {"name": "08_stats_prev_month", "go": "stats", "actions": [
        ("click", "#stats-prev"),
    ]},
    {"name": "09_stats_drilldown", "go": "stats", "actions": [
        ("click", ".stats-cat:nth-child(1)"),
    ]},
    {"name": "10_history", "go": None, "actions": [("click", "#open-history")]},
    {"name": "11_settings", "go": None, "actions": [
        ("click", "#open-menu"),
        ("click", "#open-settings"),
    ]},
    {"name": "12_currency_picker", "go": None, "actions": [("click", "#open-currency")]},
    {"name": "13_date_picker", "go": None, "actions": [("click", "#open-date")]},
    {"name": "14_note_editor", "go": None, "actions": [("click", "#open-note")]},
    {"name": "15_category_tap_flow", "go": None, "actions": [
        ("click", ".numpad button:nth-child(3)"),  # 3
        ("click", ".numpad button:nth-child(11)"),  # 0 → 30
        ("click", ".numpad button:nth-child(11)"),  # 00 → 300
        ("click", ".cat:nth-child(1)"),
        ("wait", "500"),
    ]},
    {"name": "16_history_scroll_bottom", "go": None, "actions": [
        ("click", "#open-history"),
        ("wait", "400"),
    ]},
    {"name": "17_history_tap_first_row", "go": None, "actions": [
        ("click", "#open-history"),
        ("wait", "400"),
        ("click", "#history-list .day-row:first-of-type"),
    ]},
    {"name": "18_settings_change_base_rub", "go": None, "actions": [
        ("click", "#open-menu"),
        ("click", "#open-settings"),
        ("wait", "320"),
        ("click", "#settings-base-grid button:nth-child(3)"),  # RUB
    ]},
    {"name": "19_stats_year_back_2025", "go": "stats", "actions": [
        ("click", "#stats-tabs button[data-period='year']"),
        ("click", "#stats-prev"),
    ]},
    {"name": "20_stats_donut_segment_tap", "go": "stats", "actions": [
        ("click", ".donut-seg:nth-child(2)"),
    ]},
]


def run_scenario(page, scn, out_dir: Path):
    page.goto("http://127.0.0.1:8765/", wait_until="networkidle")
    page.wait_for_timeout(700)
    if scn["go"] == "stats":
        page.click("#open-menu")
        page.wait_for_timeout(280)
        page.click("[data-go='stats']")
        page.wait_for_timeout(280)
    for kind, sel in scn["actions"]:
        if kind == "click":
            try:
                page.click(sel, timeout=2000)
                page.wait_for_timeout(280)
            except Exception as e:
                print(f"  ! action click '{sel}' failed: {e}")
        elif kind == "wait":
            page.wait_for_timeout(int(sel))
    page.wait_for_timeout(220)
    # «Top» скриншот в исходной позиции скролла.
    top_path = out_dir / f"{scn['name']}.png"
    page.screenshot(path=str(top_path), full_page=False)
    # Если скроллируемый контент длиннее viewport — дополнительный «bottom» снимок.
    has_overflow = page.evaluate(
        "() => { const el = document.querySelector('#app'); return el ? el.scrollHeight - el.clientHeight - el.scrollTop > 30 : false; }"
    )
    if has_overflow:
        page.evaluate("() => { const el = document.querySelector('#app'); el.scrollTop = el.scrollHeight; }")
        page.wait_for_timeout(220)
        bottom_path = out_dir / f"{scn['name']}_bottom.png"
        page.screenshot(path=str(bottom_path), full_page=False)
        print(f"  ✓ {scn['name']}.png + _bottom.png")
    else:
        print(f"  ✓ {scn['name']}.png")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--headed", action="store_true", help="показать браузер")
    ap.add_argument("--only", default="", help="запустить только сценарии, имя которых содержит подстроку")
    args = ap.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    payload_json = json.dumps(build_bootstrap_payload(), ensure_ascii=False)
    print(f"▶ mock bootstrap: {len(build_bootstrap_payload()['expenses'])} expenses")

    server, port = start_http_server(PUBLIC_DIR)
    print(f"▶ http server on :{port}")
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("ERROR: playwright not installed in .venv. Run: pip install playwright && playwright install chromium")
        return 1

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not args.headed)
        # iPhone 15 Pro Max: 430×932 CSS pt, DPR 3 → 1290×2796 native px.
        ctx = browser.new_context(
            viewport={"width": 430, "height": 932},
            device_scale_factor=3,
            is_mobile=True,
            has_touch=True,
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
        )
        ctx.add_init_script(init_script(payload_json))

        # Логи: собираем все pageerror и console.error/warning, ассоциируем со сценарием
        console_log: list[tuple[str, str, str]] = []  # (scenario, level, text)
        current_scn = {"name": "?"}

        def on_console(msg):
            if msg.type in ("error", "warning"):
                console_log.append((current_scn["name"], msg.type, msg.text[:300]))
        def on_pageerror(err):
            console_log.append((current_scn["name"], "pageerror", str(err)[:300]))

        page = ctx.new_page()
        page.on("console", on_console)
        page.on("pageerror", on_pageerror)

        for scn in SCENARIOS:
            if args.only and args.only not in scn["name"]:
                continue
            current_scn["name"] = scn["name"]
            print(f"▶ {scn['name']}")
            run_scenario(page, scn, OUT_DIR)

        browser.close()
        if console_log:
            print("\n── console errors / warnings ──")
            for scn_name, lvl, text in console_log:
                print(f"  [{scn_name}] {lvl}: {text}")
        else:
            print("\n✓ no console errors")
    server.shutdown()
    print(f"\n✓ скриншоты: {OUT_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
