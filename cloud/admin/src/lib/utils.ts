import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
    return twMerge(clsx(inputs));
}

export const DEFAULT_CURRENCY_DECIMALS: Record<string, number> = {
    EUR: 2, USD: 2, RUB: 2, RSD: 0, USDT: 2, TRY: 2, BTC: 8, ETH: 6,   // синхронизировано с miniapp/lib/utils.ts
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

/**
 * Естественное отображение курса обмена.
 * rate = to_amount / from_amount.
 *  - rate > 1 (1 from даёт >1 to → from «дешевле»): «1 from = rate to»
 *  - rate < 1 (1 from даёт <1 to → from «дороже»): «1 to = (1/rate) from»
 *
 *  Пример: 100 000 RUB → 1 212.12 USDT, rate = 0.01212 → «1 USDT = 82.50 RUB».
 */
export function formatExchangeRate(
    fromAmount: number,
    fromCurrency: string,
    toAmount: number,
    toCurrency: string,
): string | null {
    if (!Number.isFinite(fromAmount) || !Number.isFinite(toAmount) || fromAmount <= 0 || toAmount <= 0) {
        return null;
    }
    const rate = toAmount / fromAmount;
    if (rate >= 1) {
        return `1 ${fromCurrency} = ${rate.toFixed(rate >= 100 ? 2 : 4)} ${toCurrency}`;
    }
    const inv = 1 / rate;
    return `1 ${toCurrency} = ${inv.toFixed(inv >= 100 ? 2 : 4)} ${fromCurrency}`;
}
