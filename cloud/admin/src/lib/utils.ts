import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
    return twMerge(clsx(inputs));
}

export const DEFAULT_CURRENCY_DECIMALS: Record<string, number> = {
    EUR: 2, USD: 2, RUB: 2, RSD: 0, USDT: 2, BTC: 8, ETH: 6,
};

export function formatAmount(amount: number, currency: string, opts?: { withSymbol?: boolean }): string {
    const decimals = DEFAULT_CURRENCY_DECIMALS[currency] ?? 2;
    const s = amount.toLocaleString("ru-RU", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    });
    return opts?.withSymbol ? `${s} ${currency}` : s;
}

/**
 * Компактная дата для таблиц: `dd.mm.yyyy`. ru-RU short ("24 мая 2026 г.")
 * переносился в узких колонках — теперь всегда влезает без wrap.
 */
export function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString("ru-RU", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export function formatDateTime(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleString("ru-RU", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
