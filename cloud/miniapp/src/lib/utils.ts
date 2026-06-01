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

/** 'YYYY-MM-DD' в ЛОКАЛЬНОЙ зоне устройства (не UTC) — дата траты должна быть днём
 *  пользователя, иначе ночная трата уезжает на соседний календарный день (SPEC-024). */
function isoLocal(d: Date): string {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function todayISO(): string {
    return isoLocal(new Date());
}

export function dateShiftISO(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return isoLocal(d);
}

export function uuid4(): string {
    return (crypto as Crypto).randomUUID();
}

const MAX_NUMPAD_DIGITS = 12;

/** Применяет нажатие numpad-клавиши к строке суммы. key: цифра | "." | "dot" | "⌫" | "back". */
export function applyNumpadKey(amount: string, key: string): string {
    if (key === "back" || key === "⌫") {
        const n = amount.slice(0, -1);
        return n === "" ? "0" : n;
    }
    if (key === "dot" || key === ".") {
        return amount.includes(".") ? amount : amount + ".";
    }
    const next = amount === "0" ? key : amount + key;
    if (next.replace(".", "").length > MAX_NUMPAD_DIGITS) return amount;
    const dec = next.split(".")[1];
    if (dec && dec.length > 2) return amount;
    return next;
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
