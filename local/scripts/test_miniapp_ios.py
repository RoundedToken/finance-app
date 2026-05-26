#!/usr/bin/env python3
"""test_miniapp_ios.py — РЕАЛЬНЫЙ iOS-тест Mini App через Appium + iOS Simulator.

В отличие от desktop-Playwright, здесь настоящий iOS Safari (WebKit) с НАСТОЯЩЕЙ
программной клавиатурой — видно прыжки/телепортацию модалок при фокусе на input.

Поднимает: Appium server + HTTP-сервер (отдаёт dist, инжектит мок Telegram+fetch
в index.html и вырезает реальный telegram-web-app.js, иначе он перетёр бы мок).
Драйвит Safari в Simulator (XCUITest), фокусирует поля, снимает скриншоты.

Требует (ставит пользователь — Xcode):
    sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
    appium driver install xcuitest
    npm --prefix cloud/miniapp run build

Usage:
    python local/scripts/test_miniapp_ios.py
    python local/scripts/test_miniapp_ios.py --device "iPhone 15 Pro" --ios "17.5" --dark
"""
from __future__ import annotations

import argparse
import http.server
import json
import re
import socketserver
import subprocess
import sys
import threading
import time
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent))
from test_miniapp_react import build_payload, init_script  # переиспользуем мок  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent.parent
DIST = ROOT / "cloud" / "miniapp" / "dist"
OUT = ROOT / "local" / "screenshots" / "ios"
PORT = 8767
APPIUM_PORT = 4723


def make_handler(mock_js: str):
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(DIST), **kw)

        def do_GET(self):
            if self.path in ("/", "/index.html"):
                html = (DIST / "index.html").read_text()
                # убрать реальный telegram SDK (перетёр бы мок) + инжект мока в <head>
                html = re.sub(r"<script[^>]*telegram-web-app\.js[^>]*></script>", "", html)
                html = html.replace("</head>", f"<script>{mock_js}</script></head>")
                body = html.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            else:
                super().do_GET()

        def log_message(self, *a):
            pass
    return H


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--device", default="iPhone 15")
    ap.add_argument("--ios", default=None, help="версия iOS runtime (если несколько)")
    ap.add_argument("--dark", action="store_true")
    args = ap.parse_args()

    if not (DIST / "index.html").exists():
        print("ERROR: dist не собран. npm --prefix cloud/miniapp run build")
        return 1
    OUT.mkdir(parents=True, exist_ok=True)

    mock_js = init_script(json.dumps(build_payload(), ensure_ascii=False), "dark" if args.dark else "light")

    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), make_handler(mock_js))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    print(f"▶ http :{PORT} (dist + mock inject)")

    appium_proc = subprocess.Popen(
        ["appium", "--port", str(APPIUM_PORT), "--log-level", "error"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    print("▶ appium server…")
    time.sleep(5)

    from appium import webdriver
    from appium.options.ios import XCUITestOptions
    from selenium.webdriver.common.by import By

    opts = XCUITestOptions()
    opts.platform_name = "iOS"
    opts.automation_name = "XCUITest"
    opts.browser_name = "Safari"
    opts.device_name = args.device
    if args.ios:
        opts.platform_version = args.ios
    # форсим программную клавиатуру (иначе Simulator c hardware keyboard её прячет)
    opts.set_capability("appium:forceSimulatorSoftwareKeyboardPresence", True)
    opts.set_capability("appium:safariInitialUrl", f"http://127.0.0.1:{PORT}/")
    # nativeWebTap: Appium конвертирует web-click в НАСТОЯЩИЙ нативный тач — это
    # поднимает software-клавиатуру (обычный web-click/send_keys её не вызывают).
    opts.set_capability("appium:nativeWebTap", True)

    driver = None
    try:
        driver = webdriver.Remote(f"http://127.0.0.1:{APPIUM_PORT}", options=opts)
        driver.implicitly_wait(6)

        def dismiss_dialogs():
            """Закрыть системные диалоги Safari (онбординг «выбор поисковика» и т.п.) через нативный контекст."""
            try:
                driver.switch_to.context("NATIVE_APP")
                for label in ["Продолжить", "Continue", "Не сейчас", "Not Now", "Закрыть", "Close", "OK"]:
                    for b in driver.find_elements(By.XPATH, f"//XCUIElementTypeButton[@name='{label}']"):
                        try:
                            if b.is_displayed():
                                b.click(); time.sleep(0.4)
                        except Exception:
                            pass
            except Exception:
                pass
            try:
                webs = [c for c in driver.contexts if "WEBVIEW" in c]
                if webs:
                    driver.switch_to.context(webs[-1])
            except Exception:
                pass

        def native_tap_web(css: str) -> bool:
            """Нативный тап по web-элементу (поднимает РЕАЛЬНУЮ software-клавиатуру,
            в отличие от web-click/send_keys, которые её не вызывают)."""
            coords = driver.execute_script(
                "var e=document.querySelector(arguments[0]);if(!e)return null;"
                "var r=e.getBoundingClientRect();return [r.left+r.width/2, r.top+r.height/2];", css)
            if not coords:
                return False
            cx, cy = coords
            try:
                driver.switch_to.context("NATIVE_APP")
                wvs = driver.find_elements(By.XPATH, "//XCUIElementTypeWebView")
                wv_top = wvs[0].location["y"] if wvs else 0
                driver.execute_script("mobile: tap", {"x": float(cx), "y": float(wv_top + cy)})
                time.sleep(0.4)
            except Exception as e:
                print(f"  ! native_tap_web({css}): {e}")
            finally:
                webs = [c for c in driver.contexts if "WEBVIEW" in c]
                if webs:
                    driver.switch_to.context(webs[-1])
            return True

        def shot(name: str):
            time.sleep(1.0)
            driver.get_screenshot_as_file(str(OUT / f"{name}.png"))
            print(f"  ✓ {name}")

        def goto_main():
            driver.get(f"http://127.0.0.1:{PORT}/")
            time.sleep(2.0)
            dismiss_dialogs()
            time.sleep(1.2)

        goto_main()
        shot("01_main")

        for k in ["5", "0", "0"]:
            try:
                driver.find_element(By.XPATH, f"//button[normalize-space()='{k}']").click()
            except Exception as e:
                print(f"  ! numpad {k}: {e}")
        shot("02_amount")

        # note modal: фокус textarea через send_keys → НАСТОЯЩАЯ клавиатура (note раньше прыгал)
        try:
            driver.find_element(By.XPATH, "//*[normalize-space()='Описание']").click()
            time.sleep(0.8); shot("03_note_open")
            driver.find_element(By.XPATH, "//textarea").click()   # nativeWebTap → реальная клавиатура
            time.sleep(1.8); shot("04_note_KEYBOARD")
            # тап по фону (backdrop) при активном input → должен blur, НЕ закрыть модалку
            driver.execute_script("document.querySelectorAll('[role=dialog] > div')[0]?.click();")
            time.sleep(1.2); shot("05_note_after_backdrop_tap")
        except Exception as e:
            print(f"  ! note: {e}")

        # edit modal: фокус amount input → клавиатура (edit телепортировался)
        try:
            goto_main()
            row = driver.find_element(By.XPATH, "//*[contains(text(),'Кафе')]")
            driver.execute_script("arguments[0].scrollIntoView({block:'center'});", row)
            time.sleep(0.6); row.click()
            time.sleep(1.0); shot("06_edit_open")
            driver.find_element(By.XPATH, "//input[@type='number' or @inputmode='decimal']").click()
            time.sleep(1.8); shot("07_edit_amount_KEYBOARD")
        except Exception as e:
            print(f"  ! edit: {e}")

        print("\n✓ скриншоты:", OUT)
        return 0
    finally:
        if driver:
            try: driver.quit()
            except Exception: pass
        appium_proc.terminate()
        httpd.shutdown()


if __name__ == "__main__":
    sys.exit(main())
