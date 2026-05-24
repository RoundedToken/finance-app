/**
 * Currency rates. Источник: open.er-api.com (бесплатно, без ключа).
 * EUR — фиксированная база, остальные валюты конвертируются через неё.
 */
import type { Env } from "./types";

const SYMBOLS = ["USD", "RUB", "RSD", "USDT"];  // что хранить из всех returned

export interface FetchedRates {
    base: string;
    date: string;
    rates: Record<string, number>;
}

export async function fetchLatestRatesEUR(): Promise<FetchedRates> {
    const r = await fetch("https://open.er-api.com/v6/latest/EUR", {
        cf: { cacheTtl: 1800 } as any,
    });
    if (!r.ok) throw new Error(`rates fetch http ${r.status}`);
    const data = await r.json() as any;
    if (data.result !== "success") throw new Error("rates fetch result != success");
    const date = data.time_last_update_utc
        ? new Date(data.time_last_update_utc).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);
    return { base: "EUR", date, rates: data.rates ?? {} };
}

export async function saveRates(env: Env, payload: FetchedRates): Promise<number> {
    const stmts = [];
    for (const q of SYMBOLS) {
        let rate = payload.rates[q];
        // USDT pegged ≈ USD, если провайдер его не вернул
        if (q === "USDT" && rate == null) rate = payload.rates["USD"];
        if (rate == null || !isFinite(rate)) continue;
        stmts.push(
            env.DB.prepare(
                "INSERT OR REPLACE INTO rates (date, base, quote, rate, source, fetched_at) " +
                "VALUES (?, ?, ?, ?, 'open-er-api', datetime('now'))",
            ).bind(payload.date, payload.base, q, rate),
        );
    }
    if (!stmts.length) return 0;
    await env.DB.batch(stmts);
    return stmts.length;
}

/** Все курсы за последнюю доступную дату. Mini App забирает при старте. */
export async function getLatestRates(env: Env): Promise<{
    date: string | null;
    base: string;
    quotes: Record<string, number>;
}> {
    const row = await env.DB.prepare(
        "SELECT MAX(date) AS d FROM rates",
    ).first<{ d: string | null }>();
    const date = row?.d ?? null;
    if (!date) return { date: null, base: "EUR", quotes: {} };
    const r = await env.DB.prepare(
        "SELECT quote, rate FROM rates WHERE date = ? AND base = 'EUR'",
    ).bind(date).all<{ quote: string; rate: number }>();
    const quotes: Record<string, number> = {};
    for (const row of r.results) quotes[row.quote] = row.rate;
    return { date, base: "EUR", quotes };
}

/** Курс на дату или ближайший раньше (для исторических трат). */
export async function getRateAt(
    env: Env,
    quote: string,
    date: string,
): Promise<number | null> {
    if (quote === "EUR") return 1;
    const r = await env.DB.prepare(
        "SELECT rate FROM rates WHERE base = 'EUR' AND quote = ? AND date <= ? " +
        "ORDER BY date DESC LIMIT 1",
    ).bind(quote, date).first<{ rate: number }>();
    return r?.rate ?? null;
}
