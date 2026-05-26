import type { Rates } from "@/api/types";

/** Конверсия суммы из `currency` в `base` через EUR (1 EUR = rate*quote). 0 если курса нет. */
export function toBase(amount: number, currency: string, base: string, rates: Rates): number {
    if (currency === base) return amount;
    const q = rates.quotes || {};
    const rFrom = currency === "EUR" ? 1 : q[currency];
    const rTo = base === "EUR" ? 1 : q[base];
    if (!rFrom || !rTo) return 0;
    return (amount / rFrom) * rTo;
}
