/**
 * Инвестиции — крипто-портфель (SPEC-026). Web Admin only (Bearer JWT).
 *
 * Холдинг ETH — обычное ведро (accounts.is_investment=1): net worth, snapshots,
 * exchange-покупка и EUR-конверсия достаются «бесплатно». Этот модуль — только
 * АНАЛИТИЧЕСКАЯ ЛИНЗА поверх (как RBAR/бюджеты): qty/стоимость/cost basis/P&L/
 * доход стейкинга — производные on-read, отдельного баланса не хранится (G6).
 *
 * Семантика (ADR-014, два класса конверсии):
 *   • value (запас, mark-to-market)  → курс НА СЕГОДНЯ:  toEurAt(qty,'ETH',today)
 *   • cost basis (поток покупки)      → курс НА ДАТУ обмена: toEurAt(from_amount,...,tx.date)
 *
 * cost basis — weighted-average cost (WAC, NG3): продажа списывает cost
 * пропорционально средней цене. Доход стейкинга (G7) = прирост qty, не
 * объяснённый покупками/продажами (ребейзинг, зафиксированный снапшотом):
 *   reward_qty = qty(today) − net_bought_qty   (≥0; <0 → 0, E3).
 */

import type { Env } from "./types";
import { loadRatesIndex, RatesIndex } from "./rates";
import { getEffectiveBalance } from "./snapshots";
import { getAppConfig } from "./db";
import { reconstructBalance, feePayerBucket, roundMoney } from "./ledger";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Ключ app_config с авто-APR stETH (Lido), пишет cron/refresh-rates (SPEC-027). */
export const STETH_APR_KEY = "steth_apr_pct";
const QUOTE_CCY = "USDT";   // вторая котировочная валюта для отображения крипты

function todayUtc(): string {
    return new Date().toISOString().slice(0, 10);
}
/** Дней между датами YYYY-MM-DD (b − a). SPEC-030: адаптивная гранулярность series. */
function daysBetween(a: string, b: string): number {
    return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}
function addDays(d: string, n: number): string {
    return new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
}

interface InvBucketRow {
    id: string; name: string; currency: string; color: string | null; sort_order: number;
}
interface ExchRow {
    date: string; created_at: string;
    from_account_id: string; to_account_id: string;
    from_amount: number; from_currency: string;
    to_amount: number; to_currency: string;
    fee_amount: number | null; fee_currency: string | null;
}
interface SnapRow { date: string; amount: number; created_at: string; }
interface SettingsRow { account_id: string; is_staked: number; staked_qty: number | null; staking_apr_pct: number | null; note: string | null; }

export async function listInvestmentBuckets(env: Env): Promise<InvBucketRow[]> {
    const r = await env.DB.prepare(
        `SELECT id, name, currency, color, sort_order FROM accounts
         WHERE is_investment = 1 AND deleted_at IS NULL ORDER BY sort_order, name`,
    ).all<InvBucketRow>();
    return r.results;
}

/**
 * Портфель инвестиций: позиции + сводка. Чистая on-read линза (переиспользует
 * getEffectiveBalance и RatesIndex.toEurAt — без копий конверсии, G8).
 */
export async function getInvestments(
    env: Env,
    opts: { today?: string; from?: string; to?: string } = {},
    ratesArg?: RatesIndex,
): Promise<unknown> {
    const today = opts.today && ISO_DATE.test(opts.today) ? opts.today : todayUtc();
    // SPEC-029/030: окно value_series. to не в будущее; from — явный (выбранный период) или авто
    // от первой операции позиции (per bucket ниже) — без пустых 12 мес слева.
    const seriesTo = opts.to && ISO_DATE.test(opts.to) && opts.to < today ? opts.to : today;
    const requestedFrom = opts.from && ISO_DATE.test(opts.from) ? opts.from : null;
    const rates = ratesArg ?? await loadRatesIndex(env);
    const buckets = await listInvestmentBuckets(env);

    const settingsR = await env.DB.prepare(
        `SELECT account_id, is_staked, staked_qty, staking_apr_pct, note FROM investment_settings`,
    ).all<SettingsRow>();
    const settings = new Map(settingsR.results.map(s => [s.account_id, s] as const));

    // SPEC-027: авто-APR stETH с Lido (cron→app_config); эффективный = override ?? auto.
    const autoAprRaw = await getAppConfig(env, STETH_APR_KEY);
    const autoApr = autoAprRaw != null && isFinite(parseFloat(autoAprRaw)) ? parseFloat(autoAprRaw) : null;

    let missingRates = 0;
    let sumValue = 0, sumValueUsdt = 0, sumCostKnown = 0, sumValueKnown = 0, sumStaking = 0;
    let sumStakingForecast = 0, sumStakingAnnual = 0;   // SPEC-030: агрегаты прогноза стейкинга
    let allCostKnown = true;
    const positions: any[] = [];

    for (const b of buckets) {
        // qty (today) — авторитетный effective_balance (зеркалит net worth /accounts)
        const eff = await getEffectiveBalance(env, b.id, today);
        const qty = eff.balance;

        // Все exchange/transfer, касающиеся ведра, в хронологии (для WAC + серии)
        const exR = await env.DB.prepare(
            `SELECT date, created_at, from_account_id, to_account_id,
                    from_amount, from_currency, to_amount, to_currency, fee_amount, fee_currency
             FROM transactions
             WHERE deleted_at IS NULL AND (from_account_id = ? OR to_account_id = ?)
             ORDER BY date, created_at`,
        ).bind(b.id, b.id).all<ExchRow>();

        // Снапшоты ведра (manual) — baseline'ы для исторической серии
        const snapR = await env.DB.prepare(
            `SELECT date, amount, created_at FROM snapshots
             WHERE account_id = ? AND source = 'manual' AND deleted_at IS NULL
             ORDER BY date, created_at`,
        ).bind(b.id).all<SnapRow>();

        // ── WAC cost basis (поток по дате обмена) ──────────────────────────────
        let cbQty = 0, cost = 0, hadBuy = false, costMissing = false;
        for (const t of exR.results) {
            if (t.to_account_id === b.id) {                 // покупка актива (приход в ведро)
                const eur = rates.toEurAt(t.from_amount, t.from_currency, t.date);
                if (eur == null) costMissing = true;
                let feeEur = 0;
                if (t.fee_amount && t.fee_currency) {
                    const fe = rates.toEurAt(t.fee_amount, t.fee_currency, t.date);
                    if (fe == null) costMissing = true; else feeEur = fe;
                }
                cbQty += t.to_amount;
                cost += (eur ?? 0) + feeEur;
                hadBuy = true;
            }
            if (t.from_account_id === b.id) {               // продажа актива (отток из ведра)
                if (cbQty > 1e-12) {
                    const avg = cost / cbQty;
                    cost = Math.max(0, cost - avg * t.from_amount);
                    cbQty -= t.from_amount;
                } else {
                    cbQty -= t.from_amount;                  // edge: продажа без учтённой покупки
                }
            }
            // FIN-15 (SPEC-047): комиссия в валюте актива платится этим же ведром (fee-leg
            // уже вычтен из effective_balance) — нетто-принятое количество меньше брутто
            // to_amount. Без вычета reward = qty − netBought занижался ровно на Σ fee-in-asset
            // (доход стейкинга «съедался» комиссиями). Стоимость fee в cost уже входит.
            const feePayer = feePayerBucket({
                from_account_id: t.from_account_id, to_account_id: t.to_account_id,
                from_currency: t.from_currency, to_currency: t.to_currency,
                fee_currency: t.fee_currency, fee_amount: t.fee_amount,
            });
            if (feePayer === b.id && t.fee_amount) cbQty -= t.fee_amount;
        }
        const netBoughtQty = cbQty;
        // E2/AC8: если есть manual-снапшот РАНЬШЕ первой покупки (amount>0) — это
        // un-costed opening balance (ETH был до начала ведения). Тогда cost basis
        // неизвестен, а прирост qty над покупками НЕ доход стейкинга (это принципал).
        // Без этой проверки P&L и доход стейкинга катастрофически завышаются.
        const firstBuy = exR.results.find(t => t.to_account_id === b.id);
        const openingBeforeBuy = !!firstBuy && snapR.results.some(s =>
            s.amount > 0 && (s.date < firstBuy.date || (s.date === firstBuy.date && s.created_at < firstBuy.created_at)));
        const costBasisKnown = hadBuy && !costMissing && !openingBeforeBuy;

        const valueEur = rates.toEurAt(qty, b.currency, today);
        if (valueEur == null) missingRates++; else sumValue += valueEur;

        const costBasisEur = costBasisKnown ? roundMoney(cost) : null;
        const plEur = (costBasisKnown && valueEur != null) ? roundMoney(valueEur - (costBasisEur as number)) : null;
        const plPct = (plEur != null && costBasisEur && costBasisEur > 0)
            ? Math.round((plEur / costBasisEur) * 1000) / 10 : null;
        if (costBasisKnown && valueEur != null) { sumCostKnown += costBasisEur as number; sumValueKnown += valueEur; }
        if (!costBasisKnown) allCostKnown = false;

        // ── Доход стейкинга (факт): прирост qty, не объяснённый покупками (G7) ──
        let stakingQty: number | null = null, stakingEur: number | null = null;
        if (costBasisKnown) {
            stakingQty = Math.max(0, roundMoney(qty - netBoughtQty));
            const se = rates.toEurAt(stakingQty, b.currency, today);
            stakingEur = se == null ? null : r2(se);
            if (se != null) sumStaking += se;
        }

        const st = settings.get(b.id);
        // SPEC-027: частичный стейкинг. staked_qty явный, иначе legacy is_staked=1 → вся
        // позиция (E3); кламп [0, qty]. liquid = qty − staked.
        let stakedQty = st?.staked_qty != null ? st.staked_qty : (st?.is_staked ? qty : 0);
        stakedQty = Math.min(Math.max(0, roundMoney(stakedQty)), Math.max(0, qty));
        const liquidQty = Math.max(0, roundMoney(qty - stakedQty));
        const isStaked = stakedQty > 1e-12;
        const aprOverride = st?.staking_apr_pct ?? null;             // ручной override
        const effectiveApr = aprOverride ?? autoApr;                 // override ?? авто Lido
        const priceEur = rates.toEurAt(1, b.currency, today);
        const priceUsdt = rates.convertAt(1, b.currency, QUOTE_CCY, today);   // ETH→USDT
        const valueUsdt = rates.convertAt(qty, b.currency, QUOTE_CCY, today);
        if (valueUsdt != null) sumValueUsdt += valueUsdt;
        const lastSnapDate = snapR.results.length ? snapR.results[snapR.results.length - 1].date : null;

        // SPEC-030: живой прогноз накопления стейкинга по APR (растёт ежедневно) + ожидаемый €/год.
        // Отсчёт — последний снапшот (факт зафиксирован там) или первая покупка; на застейканную
        // стоимость. Прогноз ≠ реальные деньги (не в net worth, на фронте помечается «ожидаемо»).
        const stakedValueEur = isStaked ? rates.toEurAt(stakedQty, b.currency, today) : null;
        const stakedSince = isStaked ? (lastSnapDate ?? firstBuy?.date ?? null) : null;
        const aprFrac = effectiveApr != null ? effectiveApr / 100 : 0;
        let stakingForecastEur: number | null = null;
        let stakingExpectedAnnualEur: number | null = null;
        if (stakedValueEur != null && aprFrac > 0) {
            stakingExpectedAnnualEur = r2(stakedValueEur * aprFrac);
            sumStakingAnnual += stakingExpectedAnnualEur;
            if (stakedSince) {
                const days = Math.max(0, daysBetween(stakedSince, today));
                stakingForecastEur = r2(stakedValueEur * (Math.pow(1 + aprFrac, days / 365) - 1));
                sumStakingForecast += stakingForecastEur;
            }
        }

        // ── Серия стоимости (окно [from..to], конец месяца), in-memory (SPEC-029) ──
        // События ведра (tx in/out + fee) — у инвест-ведра нет income/expense/gc
        // (фильтр пикеров + guard goal_contribution), поэтому tx+snap достаточно
        // и совпадает с getEffectiveBalance.
        const events: { date: string; createdAt: string; delta: number }[] = [];
        for (const t of exR.results) {
            if (t.to_account_id === b.id) events.push({ date: t.date, createdAt: t.created_at, delta: +t.to_amount });
            if (t.from_account_id === b.id) events.push({ date: t.date, createdAt: t.created_at, delta: -t.from_amount });
            const payer = feePayerBucket({
                from_account_id: t.from_account_id, to_account_id: t.to_account_id,
                from_currency: t.from_currency, to_currency: t.to_currency,
                fee_currency: t.fee_currency, fee_amount: t.fee_amount,
            });
            if (payer === b.id && t.fee_amount) events.push({ date: t.date, createdAt: t.created_at, delta: -t.fee_amount });
        }
        events.sort((a, c) => (a.date < c.date ? -1 : a.date > c.date ? 1 : 0));
        const balanceAt = (asOf: string): number => {
            let base = 0, baseDate = "0000-01-01", baseCreatedAt = "";
            for (let i = snapR.results.length - 1; i >= 0; i--) {
                if (snapR.results[i].date <= asOf) {
                    base = snapR.results[i].amount; baseDate = snapR.results[i].date; baseCreatedAt = snapR.results[i].created_at; break;
                }
            }
            return reconstructBalance(base, baseDate, baseCreatedAt, events, asOf);
        };
        // SPEC-030: авто-окно от первой операции (если период не выбран) + адаптивная гранулярность
        // (~≤46 равномерных точек по дням: дневные для короткой истории, реже для длинной).
        const firstTxDate = exR.results.length ? exR.results[0].date : null;
        const firstSnapDate = snapR.results.length ? snapR.results[0].date : null;
        const earliest = [firstTxDate, firstSnapDate].filter((d): d is string => !!d).sort()[0]
            ?? addDays(seriesTo, -365);
        let seriesStart = requestedFrom ?? earliest;
        if (seriesStart > seriesTo) seriesStart = seriesTo;       // окно раньше истории → одна точка
        const totalDays = Math.max(0, daysBetween(seriesStart, seriesTo));
        const stepDays = Math.max(1, Math.ceil(totalDays / 45));
        const series: { date: string; value_eur: number; qty: number }[] = [];
        const pushPoint = (T: string) => {
            const native = balanceAt(T);
            const ev = rates.toEurAt(native, b.currency, T);
            series.push({ date: T, value_eur: ev == null ? 0 : r2(ev), qty: roundMoney(native) });
        };
        for (let d = 0; d < totalDays; d += stepDays) pushPoint(addDays(seriesStart, d));
        pushPoint(seriesTo);                                       // последняя точка — всегда конец окна

        positions.push({
            account_id: b.id, name: b.name, currency: b.currency, color: b.color,
            qty: roundMoney(qty),
            price_eur: priceEur == null ? null : r2(priceEur),
            price_usdt: priceUsdt == null ? null : r2(priceUsdt),
            value_eur: valueEur == null ? null : r2(valueEur),
            value_usdt: valueUsdt == null ? null : r2(valueUsdt),
            cost_basis_eur: costBasisEur == null ? null : r2(costBasisEur),
            cost_basis_known: costBasisKnown,
            unrealized_pl_eur: plEur == null ? null : r2(plEur),
            unrealized_pl_pct: plPct,
            is_staked: isStaked,
            staked_qty: stakedQty,
            liquid_qty: liquidQty,
            staking_apr_pct: effectiveApr,             // эффективный (override ?? авто)
            staking_apr_override: aprOverride,
            staking_apr_auto: autoApr,
            staking_income_qty: stakingQty,
            staking_income_eur: stakingEur,
            staking_forecast_eur: stakingForecastEur,           // SPEC-030: накопл. прогноз по APR
            staking_expected_annual_eur: stakingExpectedAnnualEur,
            staked_since: stakedSince,
            note: st ? st.note : null,
            last_snapshot_date: lastSnapDate,
            value_series: series,
        });
    }

    // SPEC-028: время последнего тика курса (свежесть «по времени фетча») — max по позициям.
    let rateFetchedAt: string | null = null;
    for (const b of buckets) {
        const f = rates.tickFetchedAt(b.currency);
        if (f && (!rateFetchedAt || f > rateFetchedAt)) rateFetchedAt = f;
    }

    return {
        ok: true,
        as_of: today,
        currency: "EUR",
        rates_date: rates.latestDate(),
        rate_fetched_at: rateFetchedAt,   // SPEC-028: момент последнего фетча курса (свежесть)
        summary: {
            value_eur: r2(sumValue),
            value_usdt: r2(sumValueUsdt),
            cost_basis_eur: r2(sumCostKnown),
            cost_basis_known: allCostKnown,
            unrealized_pl_eur: r2(sumValueKnown - sumCostKnown),
            unrealized_pl_pct: sumCostKnown > 0 ? Math.round(((sumValueKnown - sumCostKnown) / sumCostKnown) * 1000) / 10 : null,
            staking_income_eur: r2(sumStaking),
            staking_forecast_eur: r2(sumStakingForecast),           // SPEC-030
            staking_expected_annual_eur: r2(sumStakingAnnual),
            missing_rates: missingRates,
        },
        positions,
    };
}

// ── Settings (стейкинг: APR для прогноза + признак «застейкано») ───────────────

export interface InvestmentSettingsPatch {
    staked_qty?: number | null;       // сколько единиц в стейкинге (0 = убрать); is_staked производный
    staking_apr_pct?: number | null;  // ручной override; null = авто Lido
    note?: string | null;
}

export type Result<T extends Record<string, any> = {}> =
    | ({ ok: true } & T)
    | { ok: false; error: string };

export async function upsertInvestmentSettings(
    env: Env, accountId: string, patch: InvestmentSettingsPatch,
): Promise<Result<{ updated: boolean }>> {
    const acc = await env.DB.prepare(
        "SELECT id, is_investment FROM accounts WHERE id = ? AND deleted_at IS NULL",
    ).bind(accountId).first<{ id: string; is_investment: number }>();
    if (!acc) return { ok: false, error: "unknown account_id" };
    if (!acc.is_investment) return { ok: false, error: "account is not an investment bucket (is_investment=1 required)" };
    if (patch.staking_apr_pct != null && (typeof patch.staking_apr_pct !== "number" || patch.staking_apr_pct < 0 || patch.staking_apr_pct > 100)) {
        return { ok: false, error: "staking_apr_pct must be in [0, 100]" };
    }
    if (patch.staked_qty != null && (typeof patch.staked_qty !== "number" || patch.staked_qty < 0)) {
        return { ok: false, error: "staked_qty must be >= 0" };
    }

    const hasStaked = Object.prototype.hasOwnProperty.call(patch, "staked_qty");
    const hasApr = Object.prototype.hasOwnProperty.call(patch, "staking_apr_pct");
    const hasNote = Object.prototype.hasOwnProperty.call(patch, "note");
    const stakedVal = hasStaked ? (patch.staked_qty ?? null) : null;   // null = очистить
    const isStakedDerived = (stakedVal ?? 0) > 0 ? 1 : 0;              // SPEC-027: is_staked производный

    // UPSERT: вставляем дефолты при первом обращении, затем патчим переданное.
    const r = await env.DB.prepare(
        `INSERT INTO investment_settings (account_id, is_staked, staked_qty, staking_apr_pct, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
         ON CONFLICT(account_id) DO UPDATE SET
            is_staked       = ${hasStaked ? "?" : "is_staked"},
            staked_qty      = ${hasStaked ? "?" : "staked_qty"},
            staking_apr_pct = ${hasApr ? "?" : "staking_apr_pct"},
            note            = ${hasNote ? "?" : "note"},
            updated_at      = datetime('now')`,
    ).bind(
        accountId,
        hasStaked ? isStakedDerived : 0,
        hasStaked ? stakedVal : null,
        hasApr ? (patch.staking_apr_pct ?? null) : null,
        hasNote ? (patch.note ?? null) : null,
        ...(hasStaked ? [isStakedDerived] : []),
        ...(hasStaked ? [stakedVal] : []),
        ...(hasApr ? [patch.staking_apr_pct ?? null] : []),
        ...(hasNote ? [patch.note ?? null] : []),
    ).run();
    return { ok: true, updated: (r.meta.changes ?? 0) > 0 };
}
