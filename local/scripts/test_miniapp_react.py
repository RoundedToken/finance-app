#!/usr/bin/env python3
"""test_miniapp_react.py — скриншоты + проверка React Mini App (SPEC-014).

Поднимает HTTP-сервер на cloud/miniapp/dist (собранный Vite-билд), мокает
window.Telegram.WebApp (вкл. colorScheme) и fetch (bootstrap → синтетика),
прогоняет сценарии на iPhone-вьюпорте, кладёт скриншоты в local/screenshots/react/
и печатает console errors / pageerror.

Перед запуском: npm --prefix cloud/miniapp run build

Usage:
    python local/scripts/test_miniapp_react.py
    python local/scripts/test_miniapp_react.py --headed
    python local/scripts/test_miniapp_react.py --dark
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
DIST_DIR = ROOT / "cloud" / "miniapp" / "dist"
OUT_DIR = ROOT / "local" / "screenshots" / "react"

CATEGORIES = [
    {"id": "food", "name": "Еда", "color": "#FFB199", "emoji": "🍔"},
    {"id": "groceries", "name": "Продукты", "color": "#B5E3C5", "emoji": "🛒"},
    {"id": "transport", "name": "Транспорт", "color": "#A8C8F0", "emoji": "🚗"},
    {"id": "cafe", "name": "Кафе", "color": "#D7B894", "emoji": "☕"},
    {"id": "sport", "name": "Спорт", "color": "#F4C97A", "emoji": "⚽"},
    {"id": "clothing", "name": "Одежда", "color": "#E6B5D6", "emoji": "👕"},
    {"id": "health", "name": "Здоровье", "color": "#FAA8A8", "emoji": "⚕️"},
    {"id": "home", "name": "Дом", "color": "#E8D29B", "emoji": "🏠"},
    {"id": "subscriptions", "name": "Подписки", "color": "#B8C2D9", "emoji": "📺"},
    {"id": "other", "name": "Прочее", "color": "#BDBDBD", "emoji": "❓"},
]
CURRENCIES = [
    {"code": "EUR", "name": "Евро", "emoji": "🇪🇺", "is_crypto": 0, "decimals": 2},
    {"code": "RSD", "name": "Динар", "emoji": "🇷🇸", "is_crypto": 0, "decimals": 0},
    {"code": "RUB", "name": "Рубль", "emoji": "🇷🇺", "is_crypto": 0, "decimals": 2},
    {"code": "USD", "name": "Доллар", "emoji": "🇺🇸", "is_crypto": 0, "decimals": 2},
    {"code": "USDT", "name": "Тезер", "emoji": "₮", "is_crypto": 1, "decimals": 2},
]
ACCOUNTS = [
    {"id": "rsd-bank", "name": "RSD · банк", "type": "bank", "currency": "RSD", "form": "digital", "is_active": 1},
    {"id": "eur-cash", "name": "EUR · нал", "type": "cash", "currency": "EUR", "form": "cash", "is_active": 1},
    {"id": "usdt", "name": "USDT", "type": "crypto", "currency": "USDT", "form": "digital", "is_active": 1},
    {"id": "external", "name": "External", "type": "external", "currency": "EUR", "form": "external", "is_active": 1},
]
RATES = {"date": "2026-05-26", "base": "EUR", "quotes": {"USD": 1.16, "RSD": 117.41, "RUB": 82.63, "USDT": 1.16, "EUR": 1.0}}


def gen_expenses(n_days=60, today=dt.date(2026, 5, 26)):
    rng = random.Random(42)
    pool = [c["id"] for c in CATEGORIES]
    out = []
    for d in range(n_days):
        day = today - dt.timedelta(days=d)
        for _ in range(rng.choice([0, 1, 2, 2, 3])):
            cat = rng.choice(pool)
            ccy = rng.choice(["RSD"] * 6 + ["EUR"] * 2 + ["RUB"])
            amount = round(rng.choice([300, 800, 1500, 2500, 4000]) * (0.5 + rng.random()), 0)
            if ccy == "EUR":
                amount = round(amount / 117, 2)
            # SPEC-016: amount_eur приходит с worker (date-aware). В моке курсов
            # по датам нет — приближаем по RATES.quotes (для day-total «≈ EUR»).
            rate = RATES["quotes"].get(ccy, 1.0)
            amount_eur = round(amount / rate, 2) if rate else None
            out.append({
                "id": f"mock-{d}-{_}", "date": day.isoformat(), "account_id": rng.choice([None, "rsd-bank", "eur-cash", None]),
                "amount": amount, "currency": ccy, "amount_eur": amount_eur, "category_id": cat, "note": None,
                "source": "mock", "created_at": day.isoformat() + "T12:00:00Z", "updated_at": day.isoformat() + "T12:00:00Z",
            })
    return out


# SPEC-020: read-only бюджет-подсказка остатка на плитке категории.
# food=over (красный «−X €»), groceries=warn (амбер «≈X €»), transport=good (hint «≈X €»).
BUDGETS = {
    "month": "2026-05", "currency": "EUR",
    "total": {"budget_id": "bt", "limit_eur": 1200, "spent_eur": 984.0, "remaining_eur": 216.0, "pct": 82, "status": "warn", "missing_rates": 0},
    "categories": [
        {"budget_id": "b1", "category_id": "food",      "name": "Еда",       "emoji": "🍔", "color": "#FFB199", "limit_eur": 300, "spent_eur": 342.0, "remaining_eur": -42.0, "pct": 114, "status": "over", "missing_rates": 0},
        {"budget_id": "b2", "category_id": "groceries", "name": "Продукты",  "emoji": "🛒", "color": "#B5E3C5", "limit_eur": 450, "spent_eur": 392.0, "remaining_eur": 58.0,  "pct": 87,  "status": "warn", "missing_rates": 0},
        {"budget_id": "b3", "category_id": "transport", "name": "Транспорт", "emoji": "🚗", "color": "#A8C8F0", "limit_eur": 120, "spent_eur": 54.0,  "remaining_eur": 66.0,  "pct": 45,  "status": "good", "missing_rates": 0},
    ],
}


def build_payload():
    return {
        "accounts": ACCOUNTS,
        "categories": [{**c, "type": "expense", "parent_id": None, "sort_order": i, "is_active": 1} for i, c in enumerate(CATEGORIES)],
        "currencies": CURRENCIES,
        "expenses": gen_expenses(),
        "rates": RATES,
        "budgets": BUDGETS,
    }


def init_script(payload_json: str, scheme: str) -> str:
    return f"""
        window.__MOCK = {payload_json};
        window.Telegram = {{ WebApp: {{
            initData: "mock=1",
            colorScheme: "{scheme}",
            themeParams: {{}},
            ready: () => {{}}, expand: () => {{}}, disableVerticalSwipes: () => {{}},
            setHeaderColor: () => {{}}, setBackgroundColor: () => {{}},
            showConfirm: (m, cb) => cb(true),
            HapticFeedback: {{ impactOccurred: () => {{}}, notificationOccurred: () => {{}}, selectionChanged: () => {{}} }},
        }} }};
        const _f = window.fetch;
        window.fetch = async (url, opt) => {{
            const u = typeof url === "string" ? url : url.url;
            if (u.includes("/v1/bootstrap")) return new Response(JSON.stringify(window.__MOCK), {{ status: 200, headers: {{ "content-type": "application/json" }} }});
            if (u.includes("/v1/expenses") || u.includes("/v1/rates")) {{
                const body = u.includes("/v1/expenses?") ? {{ expenses: window.__MOCK.expenses }} : {{ ok: true }};
                return new Response(JSON.stringify(body), {{ status: 200, headers: {{ "content-type": "application/json" }} }});
            }}
            return _f(url, opt);
        }};
    """


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--dark", action="store_true")
    args = ap.parse_args()

    if not (DIST_DIR / "index.html").exists():
        print("ERROR: dist не собран. Запусти: npm --prefix cloud/miniapp run build")
        return 1
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    payload_json = json.dumps(build_payload(), ensure_ascii=False)

    handler = lambda *a, **kw: http.server.SimpleHTTPRequestHandler(*a, directory=str(DIST_DIR), **kw)
    socketserver.TCPServer.allow_reuse_address = True
    server = socketserver.TCPServer(("127.0.0.1", 8766), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:8766/"

    from playwright.sync_api import sync_playwright
    logs: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not args.headed)
        ctx = browser.new_context(viewport={"width": 430, "height": 932}, device_scale_factor=3, is_mobile=True, has_touch=True)
        ctx.add_init_script(init_script(payload_json, "dark" if args.dark else "light"))
        # реальный telegram-web-app.js (из index.html) перетёр бы наш мок window.Telegram —
        # блокируем его загрузку, оставляя мок живым (в настоящем Telegram SDK работает штатно).
        ctx.route("**/telegram-web-app.js*", lambda route: route.fulfill(status=200, content_type="application/javascript", body="/* stub */"))
        page = ctx.new_page()
        page.on("console", lambda m: logs.append(f"{m.type}: {m.text[:200]}") if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: logs.append(f"pageerror: {str(e)[:200]}"))

        def shot(name: str):
            page.wait_for_timeout(350)
            page.screenshot(path=str(OUT_DIR / f"{name}.png"))
            print(f"  ✓ {name}")

        def esc():
            page.keyboard.press("Escape"); page.wait_for_timeout(250)

        page.goto(base, wait_until="networkidle")
        page.wait_for_timeout(800)
        print("  theme html.class:", repr(page.evaluate("document.documentElement.className")),
              "| body bg:", page.evaluate("getComputedStyle(document.body).backgroundColor"),
              "| tg.colorScheme:", page.evaluate("window.Telegram?.WebApp?.colorScheme"))
        shot("01_main")

        for k in ["1", "2", "3"]:
            try: page.get_by_role("button", name=k, exact=True).first.click(timeout=2000)
            except Exception as e: print(f"  ! numpad {k}: {e}")
        shot("02_amount")

        for label, fname in [("Счёт", "03_account"), ("Сегодня", "04_date"), ("Описание", "05_note")]:
            try:
                page.get_by_text(label, exact=True).first.click(timeout=2000); shot(fname); esc()
            except Exception as e:
                print(f"  ! chip {label}: {e}")

        try:
            page.get_by_label("Меню").click(timeout=2000); shot("06_menu"); esc()
        except Exception as e: print(f"  ! menu: {e}")
        try:
            page.get_by_label("История").click(timeout=2000); shot("07_history")
        except Exception as e: print(f"  ! history: {e}")

        # ── currency picker (тап на дисплей) + interaction-флоу ──
        page.goto(base, wait_until="networkidle"); page.wait_for_timeout(600)
        try:
            page.get_by_text("RSD", exact=True).first.click(timeout=2000); shot("08_currency"); esc()
        except Exception as e: print(f"  ! currency: {e}")
        for k in ["5", "0", "0"]:
            try: page.get_by_role("button", name=k, exact=True).first.click(timeout=1500)
            except Exception: pass
        shot("09_amount_entered")
        try:
            page.get_by_text("Еда", exact=True).first.click(timeout=2000); page.wait_for_timeout(700); shot("10_after_save")
        except Exception as e: print(f"  ! save: {e}")
        try:
            page.get_by_text("Кафе", exact=True).first.click(timeout=2000); page.wait_for_timeout(400); shot("11_edit_modal")
        except Exception as e: print(f"  ! edit: {e}")

        browser.close()

    server.shutdown()
    print("\n── console ──")
    if logs:
        for l in logs[:40]: print(" ", l)
    else:
        print("  ✓ нет ошибок")
    print(f"\n✓ скриншоты: {OUT_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
