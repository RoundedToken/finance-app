import { useEffect, useState } from "react";
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
    return twMerge(clsx(inputs));
}

/** ADM-02 (SPEC-044): UUID будущей записи — один на открытие формы. Ретрай того же
 *  сабмита шлёт тот же id → INSERT OR IGNORE на сервере дедуплицирует. */
export function useDraftId(active: boolean): string {
    const [id, setId] = useState(() => crypto.randomUUID());
    useEffect(() => { if (active) setId(crypto.randomUUID()); }, [active]);
    return id;
}

/**
 * 'YYYY-MM-DD' в ЛОКАЛЬНОЙ зоне устройства (не UTC). Дефолт дат операций и «сегодня»
 * для запросов баланса должны быть в дне пользователя, иначе ночные операции уезжают
 * на соседний календарный день (SPEC-024). `toISOString().slice(0,10)` = UTC — НЕ использовать для дат операций.
 */
export function isoLocal(d: Date): string {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function todayLocal(): string {
    return isoLocal(new Date());
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
 *
 * ADM-18: форматируем строку напрямую, без `new Date("YYYY-MM-DD")` — он парсит
 * как UTC-полночь, и в западных TZ (UTC−) дата операций съезжала на −1 день
 * (нарушало собственное правило isoLocal этого же файла, SPEC-024).
 */
export function formatDate(iso: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (m) return `${m[3]}.${m[2]}.${m[1]}`;
    return new Date(iso).toLocaleDateString("ru-RU", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export function formatDateTime(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleString("ru-RU", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** D1 datetime('now') = "YYYY-MM-DD HH:MM:SS" в UTC без зоны → парсим как UTC (иначе JS возьмёт локаль). */
function parseUtc(iso: string): Date {
    return new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
}

/** Относительное «N назад» для свежести курса (SPEC-028). Грубо: только что / мин / ч / дн. */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
    const sec = Math.max(0, Math.floor((now.getTime() - parseUtc(iso).getTime()) / 1000));
    if (sec < 90) return "только что";
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} мин назад`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h} ч назад`;
    return `${Math.floor(h / 24)} дн назад`;
}

/** Часов с момента fetched_at (SPEC-028: порог устаревания курса). */
export function hoursSince(iso: string, now: Date = new Date()): number {
    return (now.getTime() - parseUtc(iso).getTime()) / 3.6e6;
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
