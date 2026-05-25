import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
    return twMerge(clsx(inputs));
}

export const CURRENCY_DECIMALS: Record<string, number> = {
    EUR: 2, USD: 2, RUB: 2, RSD: 0, USDT: 2, TRY: 2, BTC: 8, ETH: 6,
};

/** Форматирование суммы по числу знаков валюты (ru-RU разделители). */
export function fmt(amount: number, currency = "EUR"): string {
    const d = CURRENCY_DECIMALS[currency] ?? 2;
    return amount.toLocaleString("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function todayISO(): string {
    return new Date().toISOString().slice(0, 10);
}

export function dateShiftISO(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
}

export function uuid4(): string {
    return (crypto as Crypto).randomUUID();
}

const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

/** «Сегодня» / «Вчера» / «12 мая» / «12 мая 2025». */
export function humanDay(iso: string): string {
    const today = todayISO();
    if (iso === today) return "Сегодня";
    if (iso === dateShiftISO(-1)) return "Вчера";
    const [y, m, d] = iso.split("-").map(Number);
    const curYear = new Date().getFullYear();
    return `${d} ${MONTHS_GEN[m - 1]}${y === curYear ? "" : ` ${y}`}`;
}
