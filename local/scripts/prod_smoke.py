#!/usr/bin/env python3
"""prod_smoke.py — быстрый read-only смоук прода после деплоя (QA-10, SPEC-046).

Проверяет периметр Worker'а БЕЗ секретов: healthz жив, auth-гарды на месте,
удалённые endpoint'ы действительно удалены. Опционально (если wrangler
доступен) — свежесть фиатных курсов в D1 (max(rates.date) не старше 3 дней).

Worker-URL берётся из cloud/miniapp/.env (VITE_API_BASE) и НЕ печатается
в вывод (memory `prod-smoke-web-admin-needs-jwt`: URL не светим). Секреты
не требуются и не выводятся.

Usage:
    .venv/bin/python local/scripts/prod_smoke.py            # http-чеки + rates
    .venv/bin/python local/scripts/prod_smoke.py --no-d1    # только http-чеки

Exit code 0 — все чеки зелёные; 1 — есть провал.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MINIAPP_ENV = ROOT / "cloud" / "miniapp" / ".env"
WORKER_DIR = ROOT / "cloud" / "worker"
D1_NAME = "finances-outbox"
TIMEOUT = 15


def worker_base() -> str:
    """VITE_API_BASE из cloud/miniapp/.env — единая точка правды об origin Worker'а."""
    for line in MINIAPP_ENV.read_text().splitlines():
        line = line.strip()
        if line.startswith("VITE_API_BASE="):
            return line.split("=", 1)[1].strip().rstrip("/")
    raise SystemExit(f"VITE_API_BASE не найден в {MINIAPP_ENV}")


def http_status(base: str, path: str, method: str = "GET") -> int:
    """Код ответа (redirect'ы не следуем, тело не печатаем — там может быть чувствительное)."""
    req = urllib.request.Request(base + path, method=method)
    # Cloudflare bot-защита режет дефолтный Python-urllib/* UA в 403 —
    # представляемся честным именем скрипта (проверено: проходит).
    req.add_header("User-Agent", "finance-prod-smoke/1.0")
    if method == "POST":
        req.add_header("Content-Type", "application/json")
        req.data = b"{}"
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


def check_http(base: str) -> list[tuple[str, bool, str]]:
    """Матрица периметра: (описание, метод, путь, ожидаемый код)."""
    matrix = [
        ("healthz жив",                              "GET",  "/healthz",             200),
        ("bootstrap без initData -> 401",            "GET",  "/v1/bootstrap",        401),
        ("web/me без JWT -> 401",                    "GET",  "/v1/web/me",           401),
        ("tg POST без webhook-секрета -> 403",       "POST", "/tg",                  403),
        ("admin/references удалён -> 404",           "GET",  "/v1/admin/references", 404),
        ("rates без initData -> 401",                "GET",  "/v1/rates",            401),
    ]
    results = []
    for name, method, path, want in matrix:
        try:
            got = http_status(base, path, method)
            results.append((name, got == want, f"got {got}, want {want}"))
        except Exception as e:  # сеть/таймаут — провал чека, не крэш скрипта
            results.append((name, False, f"error: {type(e).__name__}"))
    return results


def check_rates_freshness() -> tuple[str, bool, str]:
    """max(rates.date) >= today-3d через wrangler d1 (read-only). Скип если wrangler нет."""
    name = "rates свежие (max(date) >= today-3d)"
    wrangler = shutil.which("wrangler")
    if not wrangler:
        return (name, True, "skip: wrangler не найден")
    try:
        out = subprocess.run(
            [wrangler, "d1", "execute", D1_NAME, "--remote", "--json",
             "--command", "SELECT MAX(date) AS d FROM rates"],
            cwd=WORKER_DIR, capture_output=True, text=True, timeout=60,
        )
        if out.returncode != 0:
            return (name, False, "wrangler exit != 0")
        # wrangler печатает баннеры до JSON — парсим с первой '['.
        raw = out.stdout[out.stdout.index("[") :]
        payload = json.loads(raw)
        latest = payload[0]["results"][0]["d"]
        floor = (date.today() - timedelta(days=3)).isoformat()
        return (name, latest >= floor, f"max(date)={latest}")
    except Exception as e:
        return (name, False, f"error: {type(e).__name__}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Read-only prod smoke")
    ap.add_argument("--no-d1", action="store_true", help="пропустить проверку свежести rates через wrangler")
    args = ap.parse_args()

    base = worker_base()
    results = check_http(base)
    if not args.no_d1:
        results.append(check_rates_freshness())

    ok = True
    for name, passed, detail in results:
        mark = "ok " if passed else "FAIL"
        print(f"[{mark}] {name} ({detail})")
        ok = ok and passed
    print("SMOKE:", "GREEN" if ok else "RED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
