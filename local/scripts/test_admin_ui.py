#!/usr/bin/env python3
"""test_admin_ui.py — авто-скриншоты Web Admin SPA через Playwright.

Запускает vite dev сервер для cloud/admin/, hijack'ает auth (mock JWT в
localStorage), intercepts все запросы к Worker'у моковыми JSON, прогоняет
сценарии и кладёт скриншоты в local/screenshots/admin-*.png.

Цель — визуальная проверка UX перед коммитом UI-фичи. Без этого
тестирования tsc + build green ничего не гарантируют — мы уже несколько
раз пушили на прод видимые баги (дубль валют в select, неактивный sidebar,
переносы в датах).

Usage:
    python local/scripts/test_admin_ui.py
    python local/scripts/test_admin_ui.py --headed
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
ADMIN_DIR = ROOT / "cloud" / "admin"
OUT_DIR = ROOT / "local" / "screenshots"

# ── Mock auth ──────────────────────────────────────────────────────────────
# JWT с exp = 2099-01-01, sub = test@example.com.
# Pre-signed для тестов: signature заведомо неправильна, но `isExpired`
# в lib/auth.ts проверяет только `exp` claim base64-decode, не подпись —
# подпись проверяет только Worker, который мы mock'аем целиком.
MOCK_JWT_PAYLOAD = {"sub": "test@example.com", "exp": 4_070_908_800, "iat": 1_700_000_000}


def make_mock_jwt() -> str:
    import base64

    def b64(d: dict) -> str:
        return base64.urlsafe_b64encode(json.dumps(d, separators=(",", ":")).encode()).rstrip(b"=").decode()

    return f"{b64({'alg': 'HS256', 'typ': 'JWT'})}.{b64(MOCK_JWT_PAYLOAD)}.test"


# ── Mock data ──────────────────────────────────────────────────────────────
# SPEC-011: balance = effective_balance (manual baseline + события); SPEC-016:
# effective_balance_eur — worker считает по курсу на сегодня (RATES ниже).
ACCOUNTS = [
    {"id": "rub-bank", "name": "RUB · банк", "type": "bank",   "currency": "RUB",  "is_active": 1, "color": "#a78bfa", "form": "digital", "sort_order": 10,
     "manual_snapshot": {"id": "s1", "date": "2026-05-24", "amount": 1500000}, "effective_balance": 2500000, "effective_balance_eur": 30255.36, "events_count": 0},
    {"id": "rsd-bank", "name": "RSD · банк", "type": "bank",   "currency": "RSD",  "is_active": 1, "color": "#fdba74", "form": "digital", "sort_order": 20,
     "manual_snapshot": {"id": "s2", "date": "2026-05-22", "amount": 790000}, "effective_balance": 800000, "effective_balance_eur": 6813.73, "events_count": 3},
    {"id": "acc_money_ok_rsd", "name": "RSD · нал", "type": "cash", "currency": "RSD", "is_active": 1, "color": "#fbbf24", "form": "cash", "sort_order": 30,
     "manual_snapshot": {"id": "s3", "date": "2026-05-20", "amount": 145000}, "effective_balance": 150000, "effective_balance_eur": 1277.57, "events_count": 5},
    {"id": "eur-bank", "name": "EUR · банк", "type": "bank",   "currency": "EUR",  "is_active": 1, "color": "#34d399", "form": "digital", "sort_order": 40,
     "manual_snapshot": {"id": "s5", "date": "2026-05-10", "amount": 3000}, "effective_balance": 3000, "effective_balance_eur": 3000.0, "events_count": 0},
    {"id": "eur-cash", "name": "EUR · нал",  "type": "cash",   "currency": "EUR",  "is_active": 1, "color": "#86efac", "form": "cash",    "sort_order": 50,
     "manual_snapshot": {"id": "s6", "date": "2026-05-01", "amount": 1500}, "effective_balance": 1500, "effective_balance_eur": 1500.0, "events_count": 0},
    {"id": "usdt",     "name": "USDT",        "type": "crypto", "currency": "USDT", "is_active": 1, "color": "#22d3ee", "form": "digital", "sort_order": 60,
     "manual_snapshot": {"id": "s4", "date": "2026-05-15", "amount": 5000}, "effective_balance": 5000, "effective_balance_eur": 4310.34, "events_count": 0},
    {"id": "try-cash", "name": "TRY · нал",   "type": "cash",   "currency": "TRY",  "is_active": 1, "color": "#fb7185", "form": "cash",    "sort_order": 70,
     "manual_snapshot": None, "effective_balance": 0, "effective_balance_eur": 0, "events_count": 0},
]

# SPEC-016: summary считается на worker (net = Σ effective_balance_eur;
# targeted = Σ goal.balance→EUR by today; free = net − targeted).
ACCOUNTS_SUMMARY = {"net_worth_eur": 23456.0, "targeted_eur": 38164.5, "free_eur": 8992.5, "missing_rates": 0, "rates_date": "2026-05-24"}

INCOME_CATEGORIES = [
    {"id": "salary",    "name": "Зарплата",                       "emoji": "💼", "color": "#a78bfa", "sort_order": 10, "is_active": 1},
    {"id": "interest",  "name": "Проценты",                       "emoji": "📈", "color": "#34d399", "sort_order": 20, "is_active": 1},
    {"id": "gifts",     "name": "Подарки",                        "emoji": "🎁", "color": "#f9a8d4", "sort_order": 30, "is_active": 1},
    {"id": "cashback",  "name": "Выигрыши / Cashback / возвраты", "emoji": "🎟️", "color": "#fbbf24", "sort_order": 40, "is_active": 1},
    {"id": "freelance", "name": "Freelance",                      "emoji": "💻", "color": "#22d3ee", "sort_order": 50, "is_active": 1},
    {"id": "other",     "name": "Прочее",                         "emoji": "✨", "color": "#94a3b8", "sort_order": 60, "is_active": 0},
]

INCOMES = [
    {"id": "i1", "date": "2026-05-15", "account_id": "rub-bank", "amount": 100000, "currency_code": "RUB", "amount_eur": 1210.21, "category_id": "salary",    "source": "Anthropic",   "note": "За первую половину мая", "created_at": "2026-05-15 10:11:12", "updated_at": "2026-05-15 10:11:12"},
    {"id": "i2", "date": "2026-05-01", "account_id": "rub-bank", "amount": 110000, "currency_code": "RUB", "amount_eur": 1331.23, "category_id": "salary",    "source": "Anthropic",   "note": "Зп за апрель",            "created_at": "2026-05-01 09:00:00", "updated_at": "2026-05-01 09:00:00"},
    {"id": "i3", "date": "2026-05-10", "account_id": "usdt",     "amount": 3.40,   "currency_code": "USDT","amount_eur": 2.93,    "category_id": "interest",  "source": "Bybit Save",  "note": None,                       "created_at": "2026-05-10 12:00:00", "updated_at": "2026-05-10 12:00:00"},
    {"id": "i4", "date": "2026-04-20", "account_id": "eur-cash", "amount": 50,     "currency_code": "EUR", "amount_eur": 50.0,    "category_id": "gifts",     "source": "Родители",    "note": "На день рождения",         "created_at": "2026-04-20 18:00:00", "updated_at": "2026-04-20 18:00:00"},
    {"id": "i5", "date": "2026-04-15", "account_id": "rub-bank", "amount": 1200,   "currency_code": "RUB", "amount_eur": 14.52,   "category_id": "cashback",  "source": "Tinkoff",     "note": "Cashback за март",         "created_at": "2026-04-15 11:00:00", "updated_at": "2026-04-15 11:00:00"},
    {"id": "i6", "date": "2026-03-25", "account_id": "eur-bank", "amount": 800,    "currency_code": "EUR", "amount_eur": 800.0,   "category_id": "freelance", "source": "Project X",   "note": "Доработки",                "created_at": "2026-03-25 14:00:00", "updated_at": "2026-03-25 14:00:00"},
]

RATES = {"date": "2026-05-24", "base": "EUR", "quotes": {"USD": 1.16, "RSD": 117.41, "RUB": 82.63, "USDT": 1.16, "EUR": 1.0, "TRY": 39.5}}

# SPEC-016: amount_eur date-aware (по курсу даты траты) — приходит с worker.
EXPENSES = [
    {"id": "e1", "user_id": "u", "date": "2026-05-25", "account_id": "acc_money_ok_rsd", "amount": 450,  "currency": "RSD", "amount_eur": 3.83,  "category_id": "groceries", "note": "Maxi",      "source": "mini_app", "created_at": "2026-05-25 10:00:00", "updated_at": "2026-05-25 10:00:00"},
    {"id": "e2", "user_id": "u", "date": "2026-05-24", "account_id": "acc_money_ok_rsd", "amount": 1200, "currency": "RSD", "amount_eur": 10.22, "category_id": "cafe",      "note": "Lavazza",   "source": "mini_app", "created_at": "2026-05-24 14:00:00", "updated_at": "2026-05-24 14:00:00"},
    {"id": "e3", "user_id": "u", "date": "2026-05-22", "account_id": "acc_money_ok_rsd", "amount": 280,  "currency": "RSD", "amount_eur": 2.38,  "category_id": "transport","note": "Метро",      "source": "mini_app", "created_at": "2026-05-22 09:00:00", "updated_at": "2026-05-22 09:00:00"},
    {"id": "e4", "user_id": "u", "date": "2026-05-20", "account_id": "acc_money_ok_rsd", "amount": 2800, "currency": "RSD", "amount_eur": 23.85, "category_id": "food",      "note": "Ужин",       "source": "mini_app", "created_at": "2026-05-20 19:00:00", "updated_at": "2026-05-20 19:00:00"},
    {"id": "e5", "user_id": "u", "date": "2026-05-18", "account_id": "acc_money_ok_rsd", "amount": 850,  "currency": "RSD", "amount_eur": 7.24,  "category_id": "groceries", "note": "Idea",      "source": "mini_app", "created_at": "2026-05-18 11:00:00", "updated_at": "2026-05-18 11:00:00"},
    {"id": "e6", "user_id": "u", "date": "2026-05-10", "account_id": "acc_money_ok_rsd", "amount": 4500, "currency": "RSD", "amount_eur": 38.33, "category_id": "entertainment","note": "Кино",  "source": "mini_app", "created_at": "2026-05-10 20:00:00", "updated_at": "2026-05-10 20:00:00"},
    {"id": "e7", "user_id": "u", "date": "2026-04-28", "account_id": "acc_money_ok_rsd", "amount": 1100, "currency": "RSD", "amount_eur": 9.37,  "category_id": "food",      "note": "Доставка",   "source": "mini_app", "created_at": "2026-04-28 13:00:00", "updated_at": "2026-04-28 13:00:00"},
    {"id": "e8", "user_id": "u", "date": "2026-04-15", "account_id": "acc_money_ok_rsd", "amount": 600,  "currency": "RSD", "amount_eur": 5.11,  "category_id": "transport","note": "Такси",     "source": "mini_app", "created_at": "2026-04-15 22:00:00", "updated_at": "2026-04-15 22:00:00"},
]

GOALS = [
    {"id": "g1", "name": "Стартовый депозит на квартиру", "emoji": "🏠", "color": "#a78bfa",
     "target_amount": 5_000_000, "target_currency": "RUB", "deadline": "2027-06-01",
     "note": "Однушка в Белграде", "status": "active", "sort_order": 10,
     "balance": 2_100_000, "balance_eur": 25414.50, "target_amount_eur": 60510.71, "balance_missing_rates": 0, "contribution_count": 3,
     "created_at": "2026-01-15 10:00:00", "updated_at": "2026-05-15 14:00:00"},
    {"id": "g2", "name": "Отпуск 2026", "emoji": "✈️", "color": "#34d399",
     "target_amount": 5000, "target_currency": "EUR", "deadline": "2026-09-15",
     "note": None, "status": "active", "sort_order": 20,
     "balance": 1250, "balance_eur": 1250.0, "target_amount_eur": 5000.0, "balance_missing_rates": 0, "contribution_count": 2,
     "created_at": "2026-03-01 09:00:00", "updated_at": "2026-04-12 12:00:00"},
    {"id": "g3", "name": "Финансовая подушка", "emoji": "🛡️", "color": "#fbbf24",
     "target_amount": 12500, "target_currency": "EUR", "deadline": None,
     "note": "6 месячных расходов · не трогать", "status": "active", "sort_order": 30,
     "balance": 11500, "balance_eur": 11500.0, "target_amount_eur": 12500.0, "balance_missing_rates": 0, "contribution_count": 8,
     "created_at": "2025-09-01 10:00:00", "updated_at": "2026-05-20 11:00:00"},
]

TRANSACTIONS = [
    {"id": "tx1", "type": "exchange", "date": "2026-05-25",
     "from_account_id": "rub-bank", "to_account_id": "usdt",
     "from_amount": 100000, "from_currency": "RUB",
     "to_amount": 1212.12, "to_currency": "USDT",
     "fee_amount": None, "fee_currency": None,
     "note": "через Garantex P2P",
     "chain_id": None, "chain_sequence": None, "goal_id": None,
     "created_at": "2026-05-25 10:00:00", "updated_at": "2026-05-25 10:00:00"},
    {"id": "tx2", "type": "transfer", "date": "2026-05-22",
     "from_account_id": "rub-bank", "to_account_id": "acc_money_ok_rsd",
     "from_amount": 5000, "from_currency": "RUB",
     "to_amount": 5000, "to_currency": "RUB",
     "fee_amount": None, "fee_currency": None,
     "note": "снял наличкой",
     "chain_id": None, "chain_sequence": None, "goal_id": None,
     "created_at": "2026-05-22 14:00:00", "updated_at": "2026-05-22 14:00:00"},
]

GOAL_DETAIL = {
    "g1": {
        "goal": GOALS[0],
        "contributions": [
            {"id": "c1", "source": "manual", "date": "2025-12-25", "amount": 2_000_000,
             "currency_code": "RUB", "account_id": "rub-bank", "note": "От родителей на новый год",
             "created_at": "2025-12-25 18:00:00"},
            {"id": "i1", "source": "income", "income_id": "i1", "date": "2026-05-15",
             "amount": 100_000, "currency_code": "RUB", "account_id": "rub-bank",
             "note": "За первую половину мая", "created_at": "2026-05-15 10:11:12"},
        ],
    },
}

CATEGORIES = [
    {"id": "food",          "name": "Еда",          "type": "expense", "parent_id": None, "emoji": "🍔", "color": "#FFB199", "sort_order": 10, "is_active": 1},
    {"id": "groceries",     "name": "Продукты",     "type": "expense", "parent_id": None, "emoji": "🛒", "color": "#B5E3C5", "sort_order": 20, "is_active": 1},
    {"id": "cafe",          "name": "Кафе",         "type": "expense", "parent_id": None, "emoji": "☕", "color": "#D7B894", "sort_order": 30, "is_active": 1},
    {"id": "transport",     "name": "Транспорт",    "type": "expense", "parent_id": None, "emoji": "🚗", "color": "#A8C8F0", "sort_order": 40, "is_active": 1},
    {"id": "entertainment", "name": "Развлечения",  "type": "expense", "parent_id": None, "emoji": "🎬", "color": "#C9A8E8", "sort_order": 50, "is_active": 1},
    {"id": "subscriptions", "name": "Подписки",     "type": "expense", "parent_id": None, "emoji": "📺", "color": "#B8C2D9", "sort_order": 60, "is_active": 0},
]

CURRENCIES = [
    {"code": "EUR", "name": "Евро", "emoji": "🇪🇺", "is_crypto": 0, "decimals": 2},
    {"code": "RUB", "name": "Рубль", "emoji": "🇷🇺", "is_crypto": 0, "decimals": 2},
    {"code": "RSD", "name": "Динар", "emoji": "🇷🇸", "is_crypto": 0, "decimals": 2},
    {"code": "USDT", "name": "Тезер", "emoji": "₮", "is_crypto": 1, "decimals": 2},
    {"code": "TRY", "name": "Лира", "emoji": "🇹🇷", "is_crypto": 0, "decimals": 2},
]


# Дашборд (SPEC-013) — агрегат, который worker отдаёт на /v1/web/dashboard.
def _build_dashboard() -> dict:
    months = [f"2025-{m:02d}" for m in range(6, 13)] + [f"2026-{m:02d}" for m in range(1, 6)]
    net_worth_series, cashflow_series = [], []
    for i, m in enumerate(months):
        total = 3000.0 + i * 115.0
        net_worth_series.append({
            "month": m, "total_eur": round(total, 2),
            "by_bucket": {"rub-bank": round(total * 0.40, 2), "rsd-bank": round(total * 0.20, 2),
                          "eur-bank": round(total * 0.25, 2), "usdt": round(total * 0.15, 2)},
            "by_form": {"digital": round(total * 0.70, 2), "cash": round(total * 0.15, 2), "crypto": round(total * 0.15, 2)},
            "by_currency": {"EUR": round(total * 0.45, 2), "RUB": round(total * 0.30, 2),
                            "RSD": round(total * 0.10, 2), "USDT": round(total * 0.15, 2)},
        })
        cashflow_series.append({"month": m, "income_eur": round(1300 + (i % 3) * 220, 2),
                                "expense_eur": round(900 + (i % 4) * 130, 2)})
    return {
        "as_of": "2026-05-26", "base": "EUR", "rates_date": "2026-05-24",
        "window": {"from": "2025-06-30", "to": "2026-05-31", "months": len(months)},
        "kpi": {
            "net_worth_eur": 4303.0, "free_net_worth_eur": 2100.0, "targeted_eur": 2203.0,
            "monthly_burn_eur": 1080.0, "monthly_income_eur": 1500.0,
            "savings_rate": 0.28, "runway_months": 1.9, "runway_months_total": 4.0,
            "burn_window_months": 3, "buckets_without_baseline": 2, "missing_rates": 0,
            # SPEC-015: линза «свободные» + Δ к предыдущему окну
            "monthly_income_free_eur": 1500.0, "savings_rate_free": 0.28,
            "prev_monthly_burn_eur": 1150.0, "prev_monthly_income_eur": 1400.0,
            "prev_monthly_income_free_eur": 1400.0,
            "prev_net_worth_eur": 4000.0, "prev_free_net_worth_eur": 1850.0,
        },
        "net_worth_series": net_worth_series,
        "cashflow_series": cashflow_series,
        "expenses_by_category": [
            {"category_id": "groceries",     "name": "Продукты",    "emoji": "🛒", "color": "#B5E3C5", "total_eur": 420.0, "share": 0.38},
            {"category_id": "food",          "name": "Еда",         "emoji": "🍔", "color": "#FFB199", "total_eur": 300.0, "share": 0.27},
            {"category_id": "cafe",          "name": "Кафе",        "emoji": "☕", "color": "#D7B894", "total_eur": 180.0, "share": 0.16},
            {"category_id": "transport",     "name": "Транспорт",   "emoji": "🚗", "color": "#A8C8F0", "total_eur": 120.0, "share": 0.11},
            {"category_id": "entertainment", "name": "Развлечения", "emoji": "🎬", "color": "#C9A8E8", "total_eur":  90.0, "share": 0.08},
        ],
        "buckets": [
            {"id": a["id"], "name": a["name"], "form": a["form"], "type": a["type"],
             "currency": a["currency"], "color": a["color"], "sort_order": a["sort_order"]}
            for a in ACCOUNTS
        ],
    }


DASHBOARD = _build_dashboard()


# ── Vite dev server ────────────────────────────────────────────────────────
def free_port(start: int = 5173) -> int:
    for p in range(start, start + 50):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", p))
                return p
            except OSError:
                continue
    raise RuntimeError("no free port near 5173")


def wait_for(port: int, timeout: float = 30.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        with socket.socket() as s:
            try:
                s.connect(("127.0.0.1", port))
                return
            except OSError:
                time.sleep(0.3)
    raise TimeoutError(f"vite dev did not start on :{port}")


class ViteDev:
    def __init__(self, port: int):
        self.port = port
        self.proc: subprocess.Popen | None = None

    def __enter__(self):
        env = os.environ.copy()
        # client.ts требует непустой VITE_API_BASE. Реальный URL не важен:
        # все /v1/** перехватывает page.route() и отдаёт моки.
        env["VITE_API_BASE"] = "/api"
        self.proc = subprocess.Popen(
            ["npx", "vite", "--port", str(self.port), "--host", "127.0.0.1", "--strictPort"],
            cwd=str(ADMIN_DIR),
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        wait_for(self.port)
        print(f"  vite dev on http://127.0.0.1:{self.port}")
        return self

    def __exit__(self, *exc):
        if self.proc:
            self.proc.send_signal(signal.SIGINT)
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()


# ── Mock router ─────────────────────────────────────────────────────────────
async def setup_mocks(page, base: str) -> None:
    """Перехватываем все запросы к Worker'у (любой origin)."""
    async def handler(route):
        url = route.request.url
        method = route.request.method
        if "/v1/web/me" in url:
            return await route.fulfill(status=200, content_type="application/json",
                                       body=json.dumps({"ok": True, "email": "test@example.com"}))
        if "/v1/web/categories" in url and method == "GET":
            return await route.fulfill(status=200, content_type="application/json",
                                       body=json.dumps({"categories": CATEGORIES}))
        if "/v1/web/income-categories" in url and method == "GET":
            return await route.fulfill(status=200, content_type="application/json",
                                       body=json.dumps({"categories": INCOME_CATEGORIES}))
        if "/v1/web/incomes" in url and method == "GET":
            return await route.fulfill(status=200, content_type="application/json",
                                       body=json.dumps({"incomes": INCOMES}))
        if "/v1/web/accounts" in url:
            return await route.fulfill(status=200, content_type="application/json",
                                       body=json.dumps({"accounts": ACCOUNTS, "summary": ACCOUNTS_SUMMARY}))
        if "/v1/web/snapshots" in url:
            return await route.fulfill(status=200, content_type="application/json",
                                       body=json.dumps({"snapshots": []}))
        if "/v1/web/expenses" in url:
            return await route.fulfill(status=200, content_type="application/json",
                                       body=json.dumps({"expenses": EXPENSES}))
        # Goals detail
        import re as _re
        m_goal_detail = _re.search(r"/v1/web/goals/([^/?]+)(?:\?|$)", url)
        if m_goal_detail and method == "GET":
            gid = m_goal_detail.group(1)
            detail = GOAL_DETAIL.get(gid)
            if not detail:
                # Стандартный заглушка для других id
                goal_stub = next((g for g in GOALS if g["id"] == gid), None)
                if goal_stub:
                    detail = {"goal": goal_stub, "contributions": []}
            if detail:
                return await route.fulfill(status=200, content_type="application/json",
                                           body=json.dumps(detail))
            return await route.fulfill(status=404, content_type="application/json",
                                       body=json.dumps({"error": "not found"}))
        if "/v1/web/transactions" in url and method == "GET":
            return await route.fulfill(status=200, content_type="application/json",
                                       body=json.dumps({"transactions": TRANSACTIONS}))
        if "/v1/web/goals" in url and method == "GET":
            # Фильтр status из query
            status = "active"
            if "?" in url:
                from urllib.parse import urlparse, parse_qs
                q = parse_qs(urlparse(url).query)
                status = q.get("status", ["active"])[0]
            filtered = [g for g in GOALS if status == "all" or g["status"] == status]
            return await route.fulfill(status=200, content_type="application/json",
                                       body=json.dumps({"goals": filtered}))
        if "/v1/web/dashboard" in url:
            # учитываем from — обрезаем series, чтобы проверить адаптивную проекцию
            from urllib.parse import urlparse, parse_qs
            frm = parse_qs(urlparse(url).query).get("from", [None])[0]
            body = DASHBOARD
            if frm:
                fm = frm[:7]
                body = {**DASHBOARD,
                        "net_worth_series": [p for p in DASHBOARD["net_worth_series"] if p["month"] >= fm],
                        "cashflow_series": [p for p in DASHBOARD["cashflow_series"] if p["month"] >= fm]}
            return await route.fulfill(status=200, content_type="application/json", body=json.dumps(body))
        if "/v1/web/references" in url:
            return await route.fulfill(status=200, content_type="application/json",
                                       body=json.dumps({
                                           "accounts": ACCOUNTS,
                                           "categories": CATEGORIES,
                                           "currencies": CURRENCIES,
                                           "rates": RATES,
                                       }))
        # Любые мутации — 200 ok
        if method in {"POST", "PUT", "DELETE"}:
            return await route.fulfill(status=200, content_type="application/json",
                                       body=json.dumps({"ok": True}))
        return await route.continue_()

    # Подменяем любые запросы (наш SPA шлёт на VITE_API_BASE, но при моках
    # сам URL не важен — мы по path определяем).
    await page.route("**/v1/**", handler)


async def inject_auth(page, base: str) -> None:
    """Кладём fake-JWT в localStorage ДО первого render'а.
    auth.ts хранит токен как чистую JWT-строку (не JSON-обёртка)."""
    token = make_mock_jwt()
    await page.add_init_script(f"""
        localStorage.setItem('finances.admin.session', '{token}');
    """)


# ── Scenarios ──────────────────────────────────────────────────────────────
async def scenario_incomes_initial(page, base: str) -> None:
    await page.goto(f"{base}/incomes", wait_until="networkidle")
    await page.wait_for_selector("text=Доходы", timeout=5000)
    await page.wait_for_selector("table tbody tr", timeout=5000)
    out = OUT_DIR / "admin-incomes-initial.png"
    await page.screenshot(path=str(out), full_page=True)
    print(f"  ✓ {out.name}")


async def scenario_modal_open(page, base: str) -> None:
    await page.goto(f"{base}/incomes", wait_until="networkidle")
    await page.wait_for_selector("text=Доходы", timeout=5000)
    btn = page.get_by_role("button", name="Новый доход")
    await btn.click()
    await page.wait_for_selector("text=Новый доход >> nth=1", timeout=3000)
    out = OUT_DIR / "admin-incomes-modal.png"
    await page.screenshot(path=str(out), full_page=True)
    print(f"  ✓ {out.name}")

    # Закрыть модал (для следующих сценариев)
    await page.keyboard.press("Escape")
    await page.wait_for_timeout(200)


async def scenario_period_all(page, base: str) -> None:
    """Period picker: переключиться на «Всё» — должно показать все 6 записей."""
    await page.goto(f"{base}/incomes", wait_until="networkidle")
    await page.wait_for_selector("text=Доходы", timeout=5000)
    # Кнопка «Всё» в toggle group
    await page.get_by_role("button", name="Всё", exact=True).click()
    await page.wait_for_timeout(200)
    out = OUT_DIR / "admin-incomes-period-all.png"
    await page.screenshot(path=str(out), full_page=True)
    print(f"  ✓ {out.name}")


async def scenario_period_prev_month(page, base: str) -> None:
    """Prev nav: переключиться на Апрель 2026."""
    await page.goto(f"{base}/incomes", wait_until="networkidle")
    await page.wait_for_selector("text=Доходы", timeout=5000)
    await page.get_by_role("button", name="Предыдущий период").click()
    await page.wait_for_timeout(200)
    out = OUT_DIR / "admin-incomes-period-prev.png"
    await page.screenshot(path=str(out), full_page=True)
    print(f"  ✓ {out.name}")


async def scenario_expenses_week(page, base: str) -> None:
    """Expenses page: переключиться на «Нед» — новый таб."""
    await page.goto(f"{base}/expenses", wait_until="networkidle")
    await page.wait_for_selector("text=Расходы", timeout=5000)
    await page.get_by_role("button", name="Нед", exact=True).click()
    await page.wait_for_timeout(200)
    out = OUT_DIR / "admin-expenses-week.png"
    await page.screenshot(path=str(out), full_page=True)
    print(f"  ✓ {out.name}")


async def scenario_period_custom(page, base: str) -> None:
    """Custom range: открыть «Период» — должны появиться date inputs."""
    await page.goto(f"{base}/incomes", wait_until="networkidle")
    await page.wait_for_selector("text=Доходы", timeout=5000)
    await page.get_by_role("button", name="Период", exact=True).click()
    await page.wait_for_timeout(200)
    out = OUT_DIR / "admin-incomes-period-custom.png"
    await page.screenshot(path=str(out), full_page=True)
    print(f"  ✓ {out.name}")


async def scenario_short_viewport_modal(page, base: str) -> None:
    """Короткий экран (1280×420): модал должен скроллиться, не обрезаться.
    Делаем два скрина — сверху (видны Header + первые поля) и снизу
    (после скролла должны быть видны кнопки Отмена/Создать)."""
    await page.set_viewport_size({"width": 1280, "height": 420})
    await page.goto(f"{base}/goals", wait_until="networkidle")
    await page.wait_for_selector("text=Цели", timeout=5000)
    await page.get_by_role("button", name="Новая цель").click()
    await page.wait_for_selector("text=Новая цель >> nth=1", timeout=3000)
    await page.wait_for_timeout(200)

    out = OUT_DIR / "admin-modal-short-top.png"
    await page.screenshot(path=str(out))
    print(f"  ✓ {out.name}")

    # Прокручиваем scroll-container в самый низ — должны увидеть футер
    # с кнопками. Backdrop fixed, не должен «съезжать».
    await page.evaluate("""() => {
        const candidates = document.querySelectorAll('.overflow-y-auto');
        for (const el of candidates) {
            if (el.scrollHeight > el.clientHeight) {
                el.scrollTop = el.scrollHeight;
            }
        }
    }""")
    await page.wait_for_timeout(150)
    out = OUT_DIR / "admin-modal-short-bottom.png"
    await page.screenshot(path=str(out))
    print(f"  ✓ {out.name}")

    await page.keyboard.press("Escape")
    await page.set_viewport_size({"width": 1920, "height": 1080})


async def scenario_goals_list(page, base: str) -> None:
    await page.goto(f"{base}/goals", wait_until="networkidle")
    await page.wait_for_selector("text=Цели", timeout=5000)
    await page.wait_for_timeout(300)
    out = OUT_DIR / "admin-goals-list.png"
    await page.screenshot(path=str(out), full_page=True)
    print(f"  ✓ {out.name}")


async def scenario_goal_detail(page, base: str) -> None:
    await page.goto(f"{base}/goals/g1", wait_until="networkidle")
    await page.wait_for_selector("text=Стартовый депозит", timeout=5000)
    await page.wait_for_timeout(400)
    out = OUT_DIR / "admin-goal-detail.png"
    await page.screenshot(path=str(out), full_page=True)
    print(f"  ✓ {out.name}")


async def scenario_full_page(page, base: str, route: str, fname: str, label: str) -> None:
    """Открыть route и сделать full-page скриншот."""
    await page.goto(f"{base}{route}", wait_until="networkidle")
    await page.wait_for_selector(f"text={label}", timeout=5000)
    await page.wait_for_timeout(300)
    out = OUT_DIR / fname
    await page.screenshot(path=str(out), full_page=True)
    print(f"  ✓ {out.name}")


async def scenario_categories(page, base: str) -> None:
    """/categories: список (active + inactive секции) + модал создания."""
    await page.goto(f"{base}/categories", wait_until="networkidle")
    await page.wait_for_selector("h1:has-text('Категории')", timeout=5000)
    await page.wait_for_timeout(300)
    out = OUT_DIR / "admin-categories.png"
    await page.screenshot(path=str(out), full_page=True)
    print(f"  ✓ {out.name}")
    await page.click("text=Новая категория")
    await page.wait_for_timeout(400)
    out = OUT_DIR / "admin-categories-modal.png"
    await page.screenshot(path=str(out))
    print(f"  ✓ {out.name}")


async def scenario_sidebar_navigation(page, base: str) -> None:
    """Sidebar active state: переключаемся по 4 пунктам, делаем 4 скриншота."""
    pages = [
        ("/", "admin-nav-dashboard.png", "Дашборд"),
        ("/accounts", "admin-nav-accounts.png", "Счета"),
        ("/snapshots", "admin-nav-snapshots.png", "Снапшоты"),
        ("/incomes", "admin-nav-incomes.png", "Доходы"),
    ]
    await page.goto(f"{base}/", wait_until="networkidle")
    for route, fname, label in pages:
        await page.click(f"a[href='{route}']")
        await page.wait_for_url(lambda u, r=route: u.endswith(r))
        await page.wait_for_timeout(300)  # animate-fade-in
        # Crop sidebar only (left 16rem = 256px)
        out = OUT_DIR / fname
        await page.screenshot(path=str(out), clip={"x": 0, "y": 0, "width": 256, "height": 720})
        print(f"  ✓ {out.name}  active={label}")


async def scenario_dashboard(page, base: str) -> None:
    """Полный дашборд (SPEC-013): KPI + графики echarts. Ждём дольше —
    canvas рендерится не мгновенно."""
    await page.goto(f"{base}/", wait_until="networkidle")
    await page.wait_for_selector("text=Дашборд", timeout=5000)
    await page.wait_for_timeout(1400)  # echarts canvas
    # линза «Свободные» (дефолт)
    await page.screenshot(path=str(OUT_DIR / "admin-dashboard.png"), full_page=True)
    print("  ✓ admin-dashboard.png (линза: свободные)")
    # переключить на «Со всеми фондами»
    await page.get_by_role("button", name="Со всеми фондами").click()
    await page.wait_for_timeout(700)
    await page.screenshot(path=str(OUT_DIR / "admin-dashboard-total.png"), full_page=True)
    print("  ✓ admin-dashboard-total.png (линза: все фонды)")
    # ETA целей — доскроллить к блоку прогноза
    await page.get_by_text("Цели — прогноз достижения").scroll_into_view_if_needed()
    await page.wait_for_timeout(400)
    await page.screenshot(path=str(OUT_DIR / "admin-dashboard-goals.png"))
    print("  ✓ admin-dashboard-goals.png (ETA целей)")
    # период «6 мес» — проекция должна адаптироваться (пунктир короче истории)
    await page.get_by_role("button", name="6 мес", exact=True).click()
    await page.wait_for_timeout(1000)
    await page.screenshot(path=str(OUT_DIR / "admin-dashboard-6m.png"), full_page=True)
    print("  ✓ admin-dashboard-6m.png (период 6 мес, адаптивная проекция)")


# ── Main ───────────────────────────────────────────────────────────────────
async def run(headed: bool) -> int:
    from playwright.async_api import async_playwright

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    port = free_port()
    base = f"http://127.0.0.1:{port}"

    with ViteDev(port):
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=not headed)
            ctx = await browser.new_context(viewport={"width": 1920, "height": 1080})
            page = await ctx.new_page()
            await inject_auth(page, base)
            await setup_mocks(page, base)

            print("running scenarios:")
            await scenario_incomes_initial(page, base)
            await scenario_period_all(page, base)
            await scenario_period_prev_month(page, base)
            await scenario_period_custom(page, base)
            await scenario_modal_open(page, base)
            await scenario_full_page(page, base, "/accounts", "admin-accounts.png", "Счета")
            await scenario_full_page(page, base, "/snapshots", "admin-snapshots.png", "Снапшоты")
            await scenario_full_page(page, base, "/expenses", "admin-expenses.png", "Расходы")
            await scenario_expenses_week(page, base)
            await scenario_dashboard(page, base)
            await scenario_goals_list(page, base)
            await scenario_goal_detail(page, base)
            await scenario_full_page(page, base, "/transactions", "admin-transactions.png", "Обмены")
            await scenario_categories(page, base)
            await scenario_short_viewport_modal(page, base)
            await scenario_sidebar_navigation(page, base)

            await browser.close()

    print(f"\nscreenshots → {OUT_DIR.relative_to(ROOT)}/admin-*.png")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--headed", action="store_true", help="run browser visibly")
    args = ap.parse_args()
    return asyncio.run(run(args.headed))


if __name__ == "__main__":
    sys.exit(main())
