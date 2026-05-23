#!/usr/bin/env python3
"""backup_d1.py — backup Cloudflare D1 в локальный SQL-файл.

После D1-centric pivot D1 — источник правды. MacBook просто хранит резервные
копии. Запускается через launchd раз в день. Bonus: копирует в iCloud Drive
если папка существует.

Usage:
    python local/scripts/backup_d1.py
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent))
from _common import BACKUPS_DIR, ROOT  # noqa: E402

WRANGLER = "/opt/homebrew/bin/wrangler"
ICLOUD_DIR = Path.home() / "Library/Mobile Documents/com~apple~CloudDocs/finances-backups"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db-name", default="finances-outbox", help="имя D1 базы")
    ap.add_argument("--keep", type=int, default=30, help="сколько копий хранить локально")
    args = ap.parse_args()

    BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H%M%S")
    out = BACKUPS_DIR / f"d1-{args.db_name}.{ts}.sql"

    config = ROOT / "cloud" / "worker" / "wrangler.toml"
    cmd = [WRANGLER, "--config", str(config), "d1", "export", args.db_name, "--remote", "--output", str(out)]
    print(" ".join(cmd))
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if r.returncode != 0:
        sys.stderr.write(r.stdout + "\n" + r.stderr + "\n")
        return r.returncode
    print(f"✓ wrote {out} ({out.stat().st_size:,} bytes)")

    # iCloud копия — если папка существует.
    if ICLOUD_DIR.exists():
        icloud_out = ICLOUD_DIR / out.name
        shutil.copy2(out, icloud_out)
        print(f"✓ icloud copy: {icloud_out}")
    else:
        print(f"  (iCloud folder not found at {ICLOUD_DIR}; skipping)")

    # rotation: keep last N
    backups = sorted(BACKUPS_DIR.glob(f"d1-{args.db_name}.*.sql"))
    if len(backups) > args.keep:
        for old in backups[: -args.keep]:
            old.unlink()
            print(f"  removed old: {old.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
