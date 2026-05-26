/**
 * Тонкая обёртка над Telegram WebApp SDK (script подключён в index.html).
 * Вне Telegram (локальная разработка в браузере) всё деградирует в no-op.
 */

type Haptic = "light" | "medium" | "heavy" | "rigid" | "soft" | "success" | "error" | "warning";

export function tg(): typeof window.Telegram.WebApp | undefined {
    return window.Telegram?.WebApp;
}

/** Вызывается один раз на старте: ready/expand, фиксация цветов под тему. */
export function initTelegram(): void {
    const w = tg();
    if (!w) return;
    w.ready();
    w.expand();
    // расходы вводятся свайпами по категориям — гасим вертикальный свайп-закрытие
    try { w.disableVerticalSwipes?.(); } catch { /* старый клиент */ }
    syncTheme();
}

/** Включает .dark по Telegram colorScheme (наша палитра, не tg-vars). Вне Telegram — по prefers-color-scheme. */
export function syncTheme(): void {
    const w = tg();
    const scheme = w?.colorScheme;
    const dark = scheme ? scheme === "dark" : (window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
    document.documentElement.classList.toggle("dark", dark);
    // Красим шапку и фон Telegram нашим bg (hex из палитры админки) — иначе шапка
    // чёрная, а overscroll при скролле показывает чужой серый/чёрный фон.
    const bg = dark ? "#111318" : "#fcfcfd";
    try {
        (w as unknown as { setHeaderColor?: (c: string) => void; setBackgroundColor?: (c: string) => void } | undefined)?.setHeaderColor?.(bg);
        (w as unknown as { setBackgroundColor?: (c: string) => void } | undefined)?.setBackgroundColor?.(bg);
    } catch { /* старый клиент */ }
}

/** Haptic feedback (тап/успех/ошибка). No-op вне Telegram. */
export function haptic(kind: Haptic = "light"): void {
    const h = tg()?.HapticFeedback;
    if (!h) return;
    try {
        if (kind === "success" || kind === "error" || kind === "warning") h.notificationOccurred(kind);
        else h.impactOccurred(kind);
    } catch { /* noop */ }
}

/** initData строка для auth-заголовка X-Telegram-Init-Data. */
export function initData(): string {
    return tg()?.initData ?? "";
}

/** Нативный confirm Telegram (фолбэк на window.confirm). */
export function confirmDialog(message: string): Promise<boolean> {
    const w = tg();
    if (w?.showConfirm) {
        return new Promise(resolve => w.showConfirm(message, (ok: boolean) => resolve(ok)));
    }
    return Promise.resolve(window.confirm(message));
}
