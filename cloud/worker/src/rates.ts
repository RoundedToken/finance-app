/**
 * Currency rates. Источник: Google Sheets с формулами GOOGLEFINANCE (ADR-006).
 * Worker фетчит опубликованный CSV (anyone-with-link), парсит две строки
 * (header + values) и пишет в D1. EUR — фиксированная база.
 *
 * Ожидаемый формат CSV (лист `latest`, расширяется по мере добавления валют):
 *   date,EURUSD,EURRUB,EURRSD,EURUSDT,EURTRY
 *   2026-05-25,1.164,83.18,117.40,1.164,53.49
 */
import type { Env } from "./types";

const RATE_SOURCE = "google-sheets";

export interface FetchedRates {
    base: string;
    date: string;
    rates: Record<string, number>;
}

export async function fetchLatestRatesEUR(env: Env): Promise<FetchedRates> {
    const url = env.GOOGLE_RATES_LATEST_CSV;
    if (!url) throw new Error("GOOGLE_RATES_LATEST_CSV not configured");

    // Отключаем CF subrequest cache через cacheTtlByStatus = 0 для 2xx
    // (cacheTtl: 0 в одиночку часто игнорируется Cloudflare). Google
    // CSV отвечает за ~100ms, кэш бессмысленный.
    const r = await fetch(url, {
        cf: { cacheTtl: 0, cacheTtlByStatus: { "200-299": 0, "300-399": 0, "400-599": 0 } } as any,
        headers: { "Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache" },
    });
    if (!r.ok) throw new Error(`rates fetch http ${r.status}`);
    const text = await r.text();

    const { date, rates } = parseLatestCsv(text);
    return { base: "EUR", date, rates };
}

/** Парсит CSV из листа `latest`. Возвращает дату и map quote→rate. */
export function parseLatestCsv(text: string): { date: string; rates: Record<string, number> } {
    const lines = text.replace(/\r/g, "").trim().split("\n");
    if (lines.length < 2) throw new Error("rates csv: not enough rows");
    const header = lines[0].split(",").map(s => s.trim());
    const values = lines[1].split(",").map(s => s.trim());
    if (header[0].toLowerCase() !== "date") throw new Error("rates csv: first column must be 'date'");

    const date = values[0]; // ожидается YYYY-MM-DD из =TEXT(TODAY(),"YYYY-MM-DD")
    const rates: Record<string, number> = {};
    for (let i = 1; i < header.length; i++) {
        const col = header[i];                     // например "EURUSD"
        const quote = col.startsWith("EUR") ? col.slice(3) : col;
        const raw = values[i];
        const num = parseFloat(raw);
        if (isFinite(num) && num > 0) rates[quote] = num;
    }
    return { date, rates };
}

export async function saveRates(env: Env, payload: FetchedRates): Promise<number> {
    const stmts = [];
    for (const [quote, rate] of Object.entries(payload.rates)) {
        if (!isFinite(rate) || rate <= 0) continue;
        stmts.push(
            env.DB.prepare(
                "INSERT OR REPLACE INTO rates (date, base, quote, rate, source, fetched_at) " +
                "VALUES (?, ?, ?, ?, ?, datetime('now'))",
            ).bind(payload.date, payload.base, quote, rate, RATE_SOURCE),
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
