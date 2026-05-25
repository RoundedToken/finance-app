/**
 * Dashboard aggregation (Stage 8, SPEC-013). Web Admin only (Bearer JWT).
 *
 * Один агрегирующий проход: батч-загрузка всех событий + курсов, затем вся
 * математика in-memory. Цель — ~10-12 D1-запросов вместо сотен (см. AC12):
 * наивный net-worth-over-time через getEffectiveBalance дал бы 7 вёдер ×
 * N месяцев × 6 запросов.
 *
 * Базовая валюта — EUR (как rates.base и AccountsPage). Курс хранится как
 * `1 EUR = rate × quote`, поэтому перевод X валюты q в EUR = X / rate(q).
 * Историческая конверсия date-aware: по курсу на дату операции (cashflow /
 * breakdown) либо на конец месяца (net worth series). KPI «сейчас» — по
 * последнему курсу (rateAt(today)), что совпадает с latest-конверсией на
 * AccountsPage (AC2).
 */

import type { Env } from "./types";
import { listGoals } from "./goals";

// ── Date helpers (UTC, строки YYYY-MM-DD / YYYY-MM) ────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function todayUtc(): string {
    return new Date().toISOString().slice(0, 10);
}

function monthKey(date: string): string {
    return date.slice(0, 7); // "YYYY-MM"
}

function startOfMonth(date: string): string {
    return date.slice(0, 7) + "-01";
}

/** Последний день месяца "YYYY-MM" (UTC). */
function endOfMonth(ym: string): string {
    const [y, m] = ym.split("-").map(Number);
    // день 0 месяца с индексом m (0-based) = последний день месяца m (1-based)
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Прибавить delta месяцев к "YYYY-MM" → "YYYY-MM". */
function addMonths(ym: string, delta: number): string {
    const [y, m] = ym.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

/** Ключи месяцев [fromYm..toYm] включительно. */
function monthRange(fromYm: string, toYm: string): string[] {
    const out: string[] = [];
    let cur = fromYm;
    for (let i = 0; i < 600 && cur <= toYm; i++) {
        out.push(cur);
        cur = addMonths(cur, 1);
    }
    return out;
}

const round = (x: number, p: number) => {
    const f = 10 ** p;
    return Math.round(x * f) / f;
};
const r2 = (x: number) => round(x, 2);

// ── Rates index: ближайший курс на дату (date-aware) ───────────────────────

interface RatePoint { date: string; rate: number; }

class RatesIndex {
    private byQuote = new Map<string, RatePoint[]>();

    add(quote: string, date: string, rate: number): void {
        let arr = this.byQuote.get(quote);
        if (!arr) { arr = []; this.byQuote.set(quote, arr); }
        arr.push({ date, rate });
    }

    /** Отсортировать массивы по дате asc — вызвать после загрузки. */
    finalize(): void {
        for (const arr of this.byQuote.values()) {
            arr.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        }
    }

    /** Курс quote на дату (ближайший с date ≤ target). null если данных нет. */
    rateAt(quote: string, date: string): number | null {
        if (quote === "EUR") return 1;
        const arr = this.byQuote.get(quote);
        if (!arr || !arr.length) return null;
        let lo = 0, hi = arr.length - 1, ans = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (arr[mid].date <= date) { ans = mid; lo = mid + 1; }
            else hi = mid - 1;
        }
        return ans >= 0 ? arr[ans].rate : null;
    }
}

// ── Row types ───────────────────────────────────────────────────────────────

interface BucketRow { id: string; name: string; type: string; currency: string; form: string; color: string | null; sort_order: number; }
interface RateRow { date: string; quote: string; rate: number; }
interface CatRow { id: string; name: string; emoji: string | null; color: string | null; }
interface SnapRow { account_id: string; date: string; amount: number; }
interface IncRow { account_id: string; date: string; amount: number; currency_code: string; }
interface ExpRow { account_id: string | null; date: string; amount: number; currency: string; category_id: string | null; }
interface TxRow { from_account_id: string; to_account_id: string; date: string; from_amount: number; to_amount: number; }
interface GcRow { account_id: string | null; date: string; amount: number; }

interface NativeEvent { date: string; delta: number; }  // в валюте ведра

// ── Main ─────────────────────────────────────────────────────────────────────

export async function getDashboard(env: Env, opts: { from?: string; to?: string }): Promise<unknown> {
    const today = todayUtc();

    // Окно для графиков: дефолт — последние 12 месяцев .. today.
    const toDate = opts.to && ISO_DATE.test(opts.to) ? opts.to : today;
    const toYm = monthKey(toDate);
    let fromDate = opts.from && ISO_DATE.test(opts.from) ? opts.from : addMonths(toYm, -11) + "-01";
    if (fromDate > toDate) fromDate = addMonths(toYm, -11) + "-01";   // невалидный диапазон → дефолт
    const months = monthRange(monthKey(fromDate), toYm);

    // ── Батч-загрузка ──────────────────────────────────────────────────────
    const [bucketsR, ratesR, catsR, snapsR, incR, expR, txR, gcR] = await Promise.all([
        env.DB.prepare(`SELECT id, name, type, currency, form, color, sort_order FROM accounts
                        WHERE form != 'external' AND deleted_at IS NULL ORDER BY sort_order, name`).all<BucketRow>(),
        env.DB.prepare(`SELECT date, quote, rate FROM rates WHERE base = 'EUR'`).all<RateRow>(),
        env.DB.prepare(`SELECT id, name, emoji, color FROM categories WHERE type = 'expense'`).all<CatRow>(),
        env.DB.prepare(`SELECT account_id, date, amount FROM snapshots
                        WHERE source = 'manual' AND deleted_at IS NULL ORDER BY date, created_at`).all<SnapRow>(),
        env.DB.prepare(`SELECT account_id, date, amount, currency_code FROM incomes WHERE deleted_at IS NULL`).all<IncRow>(),
        env.DB.prepare(`SELECT account_id, date, amount, currency, category_id FROM expenses WHERE deleted_at IS NULL`).all<ExpRow>(),
        env.DB.prepare(`SELECT from_account_id, to_account_id, date, from_amount, to_amount FROM transactions WHERE deleted_at IS NULL`).all<TxRow>(),
        env.DB.prepare(`SELECT account_id, date, amount FROM goal_contributions WHERE deleted_at IS NULL`).all<GcRow>(),
    ]);
    // Активные цели — для targeted net worth. Инкапсулирует конверсию goal balance
    // в target_currency (по latest rate), не дублируем логику.
    const goals = await listGoals(env, { status: "active" });

    const buckets = bucketsR.results;
    const validBucket = new Set(buckets.map(b => b.id));

    // ── Rates index ──────────────────────────────────────────────────────────
    const rates = new RatesIndex();
    let ratesDate: string | null = null;
    for (const r of ratesR.results) {
        rates.add(r.quote, r.date, r.rate);
        if (!ratesDate || r.date > ratesDate) ratesDate = r.date;
    }
    rates.finalize();

    /** Перевод суммы в EUR на дату; null если курса нет. */
    const toEurAt = (amount: number, quote: string, date: string): number | null => {
        const r = rates.rateAt(quote, date);
        if (r == null || r === 0) return null;
        return amount / r;
    };

    // ── Группировка событий по ведру (native delta) ──────────────────────────
    const evtByBucket = new Map<string, NativeEvent[]>();
    const snapByBucket = new Map<string, SnapRow[]>();  // в SQL-порядке date, created_at
    for (const b of buckets) { evtByBucket.set(b.id, []); snapByBucket.set(b.id, []); }

    for (const s of snapsR.results) snapByBucket.get(s.account_id)?.push(s);
    for (const i of incR.results) evtByBucket.get(i.account_id)?.push({ date: i.date, delta: +i.amount });
    for (const e of expR.results) if (e.account_id) evtByBucket.get(e.account_id)?.push({ date: e.date, delta: -e.amount });
    for (const t of txR.results) {
        evtByBucket.get(t.from_account_id)?.push({ date: t.date, delta: -t.from_amount });
        evtByBucket.get(t.to_account_id)?.push({ date: t.date, delta: +t.to_amount });
    }
    for (const g of gcR.results) if (g.account_id) evtByBucket.get(g.account_id)?.push({ date: g.date, delta: +g.amount });
    for (const arr of evtByBucket.values()) arr.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    /**
     * Effective balance ведра в native на дату asOf (SPEC-011):
     * baseline = последний manual snapshot с date ≤ asOf; затем + события
     * строго после baseline.date и ≤ asOf. Нет baseline → 0 + все события.
     */
    const balanceAt = (bucketId: string, asOf: string): number => {
        const snaps = snapByBucket.get(bucketId) ?? [];
        let base = 0, baseDate = "0000-01-01";
        for (let i = snaps.length - 1; i >= 0; i--) {       // последний по date,created_at
            if (snaps[i].date <= asOf) { base = snaps[i].amount; baseDate = snaps[i].date; break; }
        }
        let bal = base;
        for (const e of evtByBucket.get(bucketId) ?? []) {
            if (e.date > baseDate && e.date <= asOf) bal += e.delta;
        }
        return bal;
    };

    // ── KPI «сейчас» (asOf = today, latest rate) ─────────────────────────────
    // missing_rates (E3) — единый счётчик позиций/операций без курса. Считаем
    // в net worth «сейчас», targeted и в period-цикле (cashflow/category) ниже.
    // В KPI-окне burn/income НЕ считаем — оно пересекается с period-окном
    // (иначе одна операция учлась бы дважды).
    let missingRates = 0;
    let netNow = 0, bucketsWithoutBaseline = 0;
    for (const b of buckets) {
        if (!(snapByBucket.get(b.id) ?? []).some(s => s.date <= today)) bucketsWithoutBaseline++;
        const eur = toEurAt(balanceAt(b.id, today), b.currency, today);
        if (eur == null) missingRates++; else netNow += eur;
    }
    let targeted = 0;
    for (const g of goals) {
        if (g.target_currency) {
            const eur = toEurAt(g.balance, g.target_currency, today);
            if (eur == null) missingRates++; else targeted += eur;
        } else {
            targeted += g.balance;   // legacy без target_currency — balance в EUR-нейтрале
        }
    }
    const freeNow = netNow - targeted;

    // ── KPI burn / income / savings (3 полных календарных месяца) ────────────
    const curMonth = monthKey(today);
    const start3 = addMonths(curMonth, -3) + "-01";          // начало 3-го месяца назад
    const end3 = endOfMonth(addMonths(curMonth, -1));        // конец прошлого месяца
    let burnSum = 0, incomeSum = 0;
    for (const e of expR.results) {
        if (e.date < start3 || e.date > end3) continue;
        const v = toEurAt(e.amount, e.currency, e.date);
        if (v != null) burnSum += v;     // missing считаем в net worth/period (overlap), не здесь
    }
    for (const i of incR.results) {
        if (i.date < start3 || i.date > end3) continue;
        const v = toEurAt(i.amount, i.currency_code, i.date);
        if (v != null) incomeSum += v;
    }
    const monthlyBurn = burnSum / 3;
    const monthlyIncome = incomeSum / 3;
    const savingsRate = monthlyIncome > 0 ? round((monthlyIncome - monthlyBurn) / monthlyIncome, 4) : null;
    const runway = monthlyBurn > 0 ? round(Math.max(0, freeNow) / monthlyBurn, 1) : null;
    const runwayTotal = monthlyBurn > 0 ? round(Math.max(0, netNow) / monthlyBurn, 1) : null;

    // ── Net worth series (по месяцам окна, конец месяца) ─────────────────────
    const netSeries = months.map(m => {
        const T = endOfMonth(m) <= today ? endOfMonth(m) : today;   // текущий месяц — до today
        const by_bucket: Record<string, number> = {};
        const by_form: Record<string, number> = {};
        const by_currency: Record<string, number> = {};
        let total = 0;
        for (const b of buckets) {
            const eur = toEurAt(balanceAt(b.id, T), b.currency, T) ?? 0;   // нет курса → 0 (rates backfill с 2024)
            by_bucket[b.id] = r2(eur);
            by_form[b.form] = r2((by_form[b.form] ?? 0) + eur);
            by_currency[b.currency] = r2((by_currency[b.currency] ?? 0) + eur);
            total += eur;
        }
        return { month: m, total_eur: r2(total), by_bucket, by_form, by_currency };
    });

    // ── Cashflow + expenses by category (за окно [fromDate, toDate]) ─────────
    const cash = new Map<string, { income: number; expense: number }>();
    for (const m of months) cash.set(m, { income: 0, expense: 0 });
    const catTotals = new Map<string, number>();
    let periodExpenseTotal = 0;

    for (const e of expR.results) {
        if (e.date < fromDate || e.date > toDate) continue;
        const v = toEurAt(e.amount, e.currency, e.date);
        if (v == null) { missingRates++; continue; }
        const c = cash.get(monthKey(e.date)); if (c) c.expense += v;
        const cid = e.category_id ?? "uncategorized";
        catTotals.set(cid, (catTotals.get(cid) ?? 0) + v);
        periodExpenseTotal += v;
    }
    for (const i of incR.results) {
        if (i.date < fromDate || i.date > toDate) continue;
        const v = toEurAt(i.amount, i.currency_code, i.date);
        if (v == null) { missingRates++; continue; }
        const c = cash.get(monthKey(i.date)); if (c) c.income += v;
    }

    const cashflow_series = months.map(m => {
        const c = cash.get(m)!;
        return { month: m, income_eur: r2(c.income), expense_eur: r2(c.expense) };
    });

    const catMeta = new Map(catsR.results.map(c => [c.id, c]));
    const expenses_by_category = [...catTotals.entries()]
        .map(([cid, total]) => {
            const meta = catMeta.get(cid);
            return {
                category_id: cid,
                name: meta?.name ?? "Без категории",
                emoji: meta?.emoji ?? null,
                color: meta?.color ?? null,
                total_eur: r2(total),
                share: periodExpenseTotal > 0 ? round(total / periodExpenseTotal, 4) : 0,
            };
        })
        .sort((a, b) => b.total_eur - a.total_eur);

    return {
        as_of: today,
        base: "EUR",
        rates_date: ratesDate,
        window: { from: fromDate, to: toDate, months: months.length },
        kpi: {
            net_worth_eur: r2(netNow),
            free_net_worth_eur: r2(freeNow),
            targeted_eur: r2(targeted),
            monthly_burn_eur: r2(monthlyBurn),
            monthly_income_eur: r2(monthlyIncome),
            savings_rate: savingsRate,
            runway_months: runway,
            runway_months_total: runwayTotal,
            burn_window_months: 3,
            buckets_without_baseline: bucketsWithoutBaseline,
            missing_rates: missingRates,
        },
        net_worth_series: netSeries,
        cashflow_series,
        expenses_by_category,
        buckets: buckets.map(b => ({
            id: b.id, name: b.name, form: b.form, type: b.type, currency: b.currency, color: b.color, sort_order: b.sort_order,
        })),
    };
}
