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
const CRYPTO_SOURCE = "binance";

// Крипто-котировки (SPEC-026/028). GOOGLEFINANCE крипту не умеет → берём с публичных spot-API.
// Цепочка провайдеров (fallback): первый успешный побеждает — убирает SPOF (Binance гео-блокирует
// Cloudflare-IP, риск R1 материализовался 2026-06-08: ETH перестал писаться, фиат шёл). Все отдают
// EUR-цену за 1 единицу; инверсию (rate=1/price) делаем одинаково. stETH НЕ фетчим: пег к ETH 1:1 (Q4/NG1).
const BINANCE_PRICE_URL = "https://api.binance.com/api/v3/ticker/price";

interface CryptoProvider {
    name: string;                   // тег источника → rates.source / rate_ticks.source
    url: string;
    parse: (body: any) => number;   // EUR-цена за 1 единицу
}

// Порядок = приоритет. Binance первый (точная торговая пара), дальше независимые Coinbase/CoinGecko
// (другие политики гео-блокировки — выше шанс пройти с CF-IP).
const CRYPTO_PROVIDERS: Record<string, CryptoProvider[]> = {
    ETH: [
        { name: "binance", url: `${BINANCE_PRICE_URL}?symbol=ETHEUR`, parse: (b) => parseFloat(b?.price) },
        { name: "coinbase", url: "https://api.coinbase.com/v2/prices/ETH-EUR/spot", parse: (b) => parseFloat(b?.data?.amount) },
        { name: "coingecko", url: "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=eur", parse: (b) => Number(b?.ethereum?.eur) },
    ],
};

export interface FetchedRates {
    base: string;
    date: string;
    rates: Record<string, number>;
    provider?: string;              // SPEC-028: какой крипто-провайдер дал курс (видимость + source тика)
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

export async function saveRates(env: Env, payload: FetchedRates, source: string = RATE_SOURCE): Promise<number> {
    const stmts = [];
    for (const [quote, rate] of Object.entries(payload.rates)) {
        if (!isFinite(rate) || rate <= 0) continue;
        stmts.push(
            env.DB.prepare(
                "INSERT OR REPLACE INTO rates (date, base, quote, rate, source, fetched_at) " +
                "VALUES (?, ?, ?, ?, ?, datetime('now'))",
            ).bind(payload.date, payload.base, quote, rate, source),
        );
    }
    if (!stmts.length) return 0;
    await env.DB.batch(stmts);
    return stmts.length;
}

/**
 * EUR-цена за 1 единицу крипты по цепочке провайдеров (SPEC-028). Пробует по порядку,
 * первый успешный (HTTP ok + finite положительная цена) побеждает. Все упали → бросает
 * с агрегированной ошибкой (по провайдерам). Возвращает {price, provider}.
 */
async function fetchCryptoPrice(quote: string): Promise<{ price: number; provider: string }> {
    const providers = CRYPTO_PROVIDERS[quote];
    if (!providers?.length) throw new Error(`no crypto providers for ${quote}`);
    const errors: string[] = [];
    for (const p of providers) {
        try {
            const r = await fetch(p.url, {
                // CF-specific RequestInit (cf.*) нет в DOM-типах → as any. Отключаем subrequest-кэш.
                cf: { cacheTtl: 0, cacheTtlByStatus: { "200-299": 0, "300-399": 0, "400-599": 0 } } as any,
                headers: { "Cache-Control": "no-cache" },
            });
            if (!r.ok) { errors.push(`${p.name} http ${r.status}`); continue; }
            const price = p.parse(await r.json());
            if (!isFinite(price) || price <= 0) { errors.push(`${p.name} bad price`); continue; }
            return { price, provider: p.name };
        } catch (e) {
            errors.push(`${p.name} ${String((e as Error)?.message ?? e)}`);
        }
    }
    throw new Error(`all crypto providers failed for ${quote}: ${errors.join("; ")}`);
}

/**
 * Крипто-курсы (SPEC-026/028): ETH/EUR по цепочке провайдеров (Binance→Coinbase→CoinGecko).
 * Хранимая семантика rates — «1 EUR = rate × quote», а провайдеры отдают EUR за 1 ETH (цена),
 * поэтому ИНВЕРТИРУЕМ: rate_ETH = 1 / price. Тогда toEurAt(qty,'ETH') = qty / rate = qty × price.
 * Дата — сегодня (UTC), как и у фиат-cron. provider — кто реально дал курс (видимость + source тика).
 *
 * Вызывается в scheduled/refresh-rates ОТДЕЛЬНО от фиата (изолированный try/catch): падение всей
 * цепочки не должно ломать фиат-курсы. При ошибке → бросает, saveCryptoRates не вызывается (курс
 * остаётся прежним), а refresh-rates вернёт crypto_error.
 */
export async function fetchCryptoRatesEUR(date?: string): Promise<FetchedRates> {
    const d = date ?? new Date().toISOString().slice(0, 10);
    const rates: Record<string, number> = {};
    let provider: string | undefined;
    for (const quote of Object.keys(CRYPTO_PROVIDERS)) {
        const { price, provider: p } = await fetchCryptoPrice(quote);
        rates[quote] = 1 / price;   // инверсия: EUR→ETH (quote per EUR)
        provider = p;               // единственная монета ETH → одно поле провайдера
    }
    return { base: "EUR", date: d, rates, provider };
}

/**
 * Сохранить крипто-курс в ОБА слоя (SPEC-028):
 *  • rate_ticks — внутридневной тик (история, mark-to-market «сейчас», INSERT OR IGNORE);
 *  • rates — дневной курс (закрытие дня, INSERT OR REPLACE; historical-серии).
 * source = реальный провайдер. Возвращает число записанных quote.
 */
export async function saveCryptoRates(env: Env, payload: FetchedRates): Promise<number> {
    const source = payload.provider ?? CRYPTO_SOURCE;
    const stmts = [];
    for (const [quote, rate] of Object.entries(payload.rates)) {
        if (!isFinite(rate) || rate <= 0) continue;
        stmts.push(
            env.DB.prepare(
                "INSERT OR IGNORE INTO rate_ticks (base, quote, rate, source, fetched_at) " +
                "VALUES (?, ?, ?, ?, datetime('now'))",
            ).bind(payload.base, quote, rate, source),
        );
        stmts.push(
            env.DB.prepare(
                "INSERT OR REPLACE INTO rates (date, base, quote, rate, source, fetched_at) " +
                "VALUES (?, ?, ?, ?, ?, datetime('now'))",
            ).bind(payload.date, payload.base, quote, rate, source),
        );
    }
    if (!stmts.length) return 0;
    await env.DB.batch(stmts);
    return Object.keys(payload.rates).length;
}

/** Тег источника крипто-курсов (fallback source, если провайдер не указан). */
export const CRYPTO_RATE_SOURCE = CRYPTO_SOURCE;

const LIDO_APR_SMA_URL = "https://eth-api.lido.fi/v1/protocol/steth/apr/sma";
const LIDO_APR_LAST_URL = "https://eth-api.lido.fi/v1/protocol/steth/apr/last";

/**
 * Базовый stETH APR с публичного Lido API (SPEC-027). Предпочитаем сглаженный
 * 7-дневный (`/sma` → data.smaApr) — стабильнее для прогноза; fallback на
 * мгновенный (`/last` → data.apr). Без ключей/секретов. Вызывается в cron/
 * refresh-rates в ОТДЕЛЬНОМ try/catch (падение не валит курсы, E1/AC4).
 * Возвращает APR в процентах (напр. 2.48). Бросает при недоступности/мусоре.
 */
export async function fetchLidoStethApr(): Promise<number> {
    const opts = {
        // CF-specific RequestInit (cf.*) нет в DOM-типах fetch → as any (как в крипто-fetch).
        cf: { cacheTtl: 0, cacheTtlByStatus: { "200-299": 0, "300-399": 0, "400-599": 0 } } as any,
        headers: { "Cache-Control": "no-cache" },
    };
    let apr: number = NaN;
    try {
        const r = await fetch(LIDO_APR_SMA_URL, opts);
        if (r.ok) {
            const b = (await r.json()) as { data?: { smaApr?: number } };
            if (b?.data?.smaApr != null) apr = Number(b.data.smaApr);
        }
    } catch { /* fallback ниже */ }
    if (!isFinite(apr) || apr <= 0) {
        const r = await fetch(LIDO_APR_LAST_URL, opts);
        if (!r.ok) throw new Error(`lido apr http ${r.status}`);
        const b = (await r.json()) as { data?: { apr?: number } };
        apr = Number(b?.data?.apr);
    }
    if (!isFinite(apr) || apr <= 0 || apr > 100) throw new Error(`lido apr bad value: ${apr}`);
    return apr;
}

/** Последний тик per quote (SPEC-028). Общий помощник для getLatestRates и loadRatesIndex. */
async function latestTicksPerQuote(env: Env): Promise<Array<{ quote: string; rate: number; fetched_at: string }>> {
    const r = await env.DB.prepare(
        "SELECT quote, rate, fetched_at FROM rate_ticks rt WHERE base = 'EUR' AND fetched_at = " +
        "(SELECT MAX(fetched_at) FROM rate_ticks WHERE quote = rt.quote AND base = 'EUR')",
    ).all<{ quote: string; rate: number; fetched_at: string }>();
    return r.results;
}

/** Все курсы за последнюю доступную дату (фиат + крипта-закрытие); крипту перезаписываем
 *  последним внутридневным тиком (SPEC-028: свежесть по времени фетча). Mini App забирает при старте. */
export async function getLatestRates(env: Env): Promise<{
    date: string | null;
    base: string;
    quotes: Record<string, number>;
    fetched_at: string | null;     // момент последнего крипто-тика (свежесть)
}> {
    const row = await env.DB.prepare(
        "SELECT MAX(date) AS d FROM rates",
    ).first<{ d: string | null }>();
    const date = row?.d ?? null;
    const quotes: Record<string, number> = {};
    if (date) {
        const r = await env.DB.prepare(
            "SELECT quote, rate FROM rates WHERE date = ? AND base = 'EUR'",
        ).bind(date).all<{ quote: string; rate: number }>();
        for (const row of r.results) quotes[row.quote] = row.rate;
    }
    // SPEC-028: крипту берём из последнего тика (свежее дневного закрытия)
    const ticks = await latestTicksPerQuote(env);
    let fetchedAt: string | null = null;
    for (const t of ticks) {
        quotes[t.quote] = t.rate;
        if (!fetchedAt || t.fetched_at > fetchedAt) fetchedAt = t.fetched_at;
    }
    return { date, base: "EUR", quotes, fetched_at: fetchedAt };
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

// ── Date-aware индекс курсов (batch) ───────────────────────────────────────
// Альтернатива getRateAt для случаев, когда нужно много конверсий за один
// запрос (dashboard, list incomes): грузим все курсы один раз, ищем бинпоиском.
//
// CANONICAL: это единственный слой конвертации валют (ADR-014, SPEC-016).
// Клиенты НЕ конвертируют — worker отдаёт готовые *_eur поля. Модель двух
// классов задаёт, какую дату передавать:
//   • Запас (баланс в моменте: вёдра, net worth, накопленное в target_currency →
//     EUR) → курс НА СЕГОДНЯ (mark-to-market): convertAt(..., today) / toEurAt(..., today).
//   • Поток (операция на дату: расход, доход, day-total, ВКЛАД В ЦЕЛЬ →
//     target_currency) → курс НА ДАТУ ОПЕРАЦИИ (date-aware historical, ADR-020):
//     toEurAt(amount, ccy, operationDate) / convertAt(..., row.date).
// rateAt берёт ближайший курс с date ≤ target (нет точного — fallback назад),
// поэтому устаревшие/неполные котировки не дают 0, а тянут последний известный.

interface RatePoint { date: string; rate: number; }

export class RatesIndex {
    private byQuote = new Map<string, RatePoint[]>();
    private maxDate: string | null = null;
    // SPEC-028: последний внутридневной тик per quote (свежесть «сейчас» для mark-to-market)
    private tickByQuote = new Map<string, { fetchedAt: string; rate: number }>();

    add(quote: string, date: string, rate: number): void {
        let arr = this.byQuote.get(quote);
        if (!arr) { arr = []; this.byQuote.set(quote, arr); }
        arr.push({ date, rate });
        if (!this.maxDate || date > this.maxDate) this.maxDate = date;
    }

    /** Внутридневной тик (SPEC-028): держим последний по fetched_at для quote. */
    addTick(quote: string, fetchedAt: string, rate: number): void {
        const cur = this.tickByQuote.get(quote);
        if (!cur || fetchedAt > cur.fetchedAt) this.tickByQuote.set(quote, { fetchedAt, rate });
    }

    /** Отсортировать массивы по дате asc — вызвать после загрузки. */
    finalize(): void {
        for (const arr of this.byQuote.values()) {
            arr.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        }
    }

    /**
     * Курс EUR→quote на дату. SPEC-028 tick-aware: для quote с внутридневным тиком и запросом
     * «на сейчас/последнюю дату» (date ≥ последней дневной даты quote) возвращает свежий тик
     * (mark-to-market по времени фетча); для прошлых дат — дневной historical (ближайший ≤ date).
     * Фиат тиков не имеет → всегда дневной. EUR→1, нет данных→null.
     */
    rateAt(quote: string, date: string): number | null {
        if (quote === "EUR") return 1;
        const arr = this.byQuote.get(quote);
        const tick = this.tickByQuote.get(quote);
        if (tick) {
            const lastDaily = arr && arr.length ? arr[arr.length - 1].date : null;
            if (lastDaily == null || date >= lastDaily) return tick.rate;
        }
        if (!arr || !arr.length) return null;
        let lo = 0, hi = arr.length - 1, ans = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (arr[mid].date <= date) { ans = mid; lo = mid + 1; }
            else hi = mid - 1;
        }
        return ans >= 0 ? arr[ans].rate : null;
    }

    /** Перевод суммы quote-валюты в EUR на дату. null если курса нет. */
    toEurAt(amount: number, quote: string, date: string): number | null {
        const r = this.rateAt(quote, date);
        if (r == null || r === 0) return null;
        return amount / r;
    }

    /**
     * Перевод суммы из `from` в `to` через EUR на дату. null если любого
     * курса нет. Обобщение toEurAt для случая, когда целевая валюта ≠ EUR
     * (например goal balance в target_currency).
     */
    convertAt(amount: number, from: string, to: string, date: string): number | null {
        if (from === to) return amount;
        const eur = this.toEurAt(amount, from, date);
        if (eur == null) return null;
        if (to === "EUR") return eur;
        const rTo = this.rateAt(to, date);
        if (rTo == null) return null;
        return eur * rTo;
    }

    latestDate(): string | null { return this.maxDate; }

    /** Время последнего тика quote (SPEC-028: свежесть курса для UI). null если тиков нет. */
    tickFetchedAt(quote: string): string | null {
        return this.tickByQuote.get(quote)?.fetchedAt ?? null;
    }
}

/** Грузит все EUR-курсы из D1 и строит date-aware индекс (один батч-запрос). */
export async function loadRatesIndex(env: Env): Promise<RatesIndex> {
    const r = await env.DB.prepare(
        "SELECT date, quote, rate FROM rates WHERE base = 'EUR'",
    ).all<{ date: string; quote: string; rate: number }>();
    const idx = new RatesIndex();
    for (const row of r.results) idx.add(row.quote, row.date, row.rate);
    // SPEC-028: последний тик per quote (свежесть «сейчас» для mark-to-market)
    for (const t of await latestTicksPerQuote(env)) idx.addTick(t.quote, t.fetched_at, t.rate);
    idx.finalize();
    return idx;
}
