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
import { loadRatesIndex } from "./rates";
import { reconstructBalance, feePayerBucket } from "./ledger";

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

// ── Row types ───────────────────────────────────────────────────────────────

interface BucketRow { id: string; name: string; type: string; currency: string; form: string; color: string | null; sort_order: number; }
interface CatRow { id: string; name: string; emoji: string | null; color: string | null; }
interface SnapRow { account_id: string; date: string; amount: number; created_at: string; }
interface IncRow { account_id: string; date: string; amount: number; currency_code: string; goal_id: string | null; created_at: string; }
interface ExpRow { account_id: string | null; date: string; amount: number; currency: string; category_id: string | null; created_at: string; }
interface TxRow { from_account_id: string; to_account_id: string; date: string; from_amount: number; to_amount: number; fee_amount: number | null; fee_currency: string | null; created_at: string; }
interface GcRow { account_id: string | null; date: string; amount: number; created_at: string; }

interface NativeEvent { date: string; createdAt: string; delta: number; }  // в валюте ведра (createdAt — tie-break внутри дня, SPEC-024)

// ── Main ─────────────────────────────────────────────────────────────────────

export async function getDashboard(env: Env, opts: { from?: string; to?: string; today?: string }): Promise<unknown> {
    // SPEC-024: «сегодня» — локальный день клиента (?today=), иначе UTC fallback.
    const today = opts.today && ISO_DATE.test(opts.today) ? opts.today : todayUtc();

    // Окно для графиков: дефолт — последние 12 месяцев .. today.
    const toDate = opts.to && ISO_DATE.test(opts.to) ? opts.to : today;
    const toYm = monthKey(toDate);
    let fromDate = opts.from && ISO_DATE.test(opts.from) ? opts.from : addMonths(toYm, -11) + "-01";
    if (fromDate > toDate) fromDate = addMonths(toYm, -11) + "-01";   // невалидный диапазон → дефолт

    // ── Батч-загрузка ──────────────────────────────────────────────────────
    const [rates, bucketsR, catsR, snapsR, incR, expR, txR, gcR] = await Promise.all([
        loadRatesIndex(env),
        env.DB.prepare(`SELECT id, name, type, currency, form, color, sort_order FROM accounts
                        WHERE form != 'external' AND deleted_at IS NULL ORDER BY sort_order, name`).all<BucketRow>(),
        env.DB.prepare(`SELECT id, name, emoji, color FROM categories WHERE type = 'expense'`).all<CatRow>(),
        env.DB.prepare(`SELECT account_id, date, amount, created_at FROM snapshots
                        WHERE source = 'manual' AND deleted_at IS NULL ORDER BY date, created_at`).all<SnapRow>(),
        env.DB.prepare(`SELECT account_id, date, amount, currency_code, goal_id, created_at FROM incomes WHERE deleted_at IS NULL`).all<IncRow>(),
        env.DB.prepare(`SELECT account_id, date, amount, currency, category_id, created_at FROM expenses WHERE deleted_at IS NULL`).all<ExpRow>(),
        env.DB.prepare(`SELECT from_account_id, to_account_id, date, from_amount, to_amount, fee_amount, fee_currency, created_at FROM transactions WHERE deleted_at IS NULL`).all<TxRow>(),
        env.DB.prepare(`SELECT account_id, date, amount, created_at FROM goal_contributions WHERE deleted_at IS NULL`).all<GcRow>(),
    ]);
    // Активные цели — для targeted net worth. Инкапсулирует конверсию goal balance
    // в target_currency (по latest rate), не дублируем логику.
    const goals = await listGoals(env, { status: "active" }, rates);   // Фаза 1.8: rates уже загружен выше

    const buckets = bucketsR.results;
    const bucketCcy = new Map(buckets.map(b => [b.id, b.currency] as const));

    // Окно не уходит раньше первых реальных данных — иначе график начинается
    // длинным пустым нулевым хвостом (особенно пресет «Всё» = from 2000-01).
    let earliest = today;
    const scanMin = (rows: { date: string }[]) => { for (const r of rows) if (r.date < earliest) earliest = r.date; };
    scanMin(snapsR.results); scanMin(incR.results); scanMin(expR.results); scanMin(gcR.results);
    for (const t of txR.results) if (t.date < earliest) earliest = t.date;
    if (fromDate < earliest) fromDate = startOfMonth(earliest);
    const months = monthRange(monthKey(fromDate), toYm);

    // ── Date-aware конверсия (rates index загружен батчем выше, shared с incomes) ─
    const ratesDate = rates.latestDate();
    // Фаза 1.9: история до первого manual snapshot — реконструкция «0 + события»
    // (приблизительно). snapsR упорядочен по date,created_at → [0] = самый ранний.
    const dataTrustFrom = snapsR.results.length ? snapsR.results[0].date : null;
    const toEurAt = (amount: number, quote: string, date: string): number | null =>
        rates.toEurAt(amount, quote, date);

    // ── Группировка событий по ведру (native delta) ──────────────────────────
    const evtByBucket = new Map<string, NativeEvent[]>();
    const snapByBucket = new Map<string, SnapRow[]>();  // в SQL-порядке date, created_at
    for (const b of buckets) { evtByBucket.set(b.id, []); snapByBucket.set(b.id, []); }

    for (const s of snapsR.results) snapByBucket.get(s.account_id)?.push(s);
    for (const i of incR.results) evtByBucket.get(i.account_id)?.push({ date: i.date, createdAt: i.created_at, delta: +i.amount });
    for (const e of expR.results) if (e.account_id) evtByBucket.get(e.account_id)?.push({ date: e.date, createdAt: e.created_at, delta: -e.amount });
    for (const t of txR.results) {
        evtByBucket.get(t.from_account_id)?.push({ date: t.date, createdAt: t.created_at, delta: -t.from_amount });
        evtByBucket.get(t.to_account_id)?.push({ date: t.date, createdAt: t.created_at, delta: +t.to_amount });
        // Комиссия (L2) — отток из ведра-плательщика (валюта = fee_currency, приоритет from).
        const feePayer = feePayerBucket({
            from_account_id: t.from_account_id, to_account_id: t.to_account_id,
            from_currency: bucketCcy.get(t.from_account_id) ?? "",
            to_currency: bucketCcy.get(t.to_account_id) ?? "",
            fee_currency: t.fee_currency, fee_amount: t.fee_amount,
        });
        if (feePayer) evtByBucket.get(feePayer)?.push({ date: t.date, createdAt: t.created_at, delta: -(t.fee_amount as number) });
    }
    for (const g of gcR.results) if (g.account_id) evtByBucket.get(g.account_id)?.push({ date: g.date, createdAt: g.created_at, delta: +g.amount });
    for (const arr of evtByBucket.values()) arr.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    /**
     * Effective balance ведра в native на дату asOf (SPEC-011):
     * baseline = последний manual snapshot с date ≤ asOf; затем + события
     * строго после baseline.date и ≤ asOf. Нет baseline → 0 + все события.
     */
    const balanceAt = (bucketId: string, asOf: string): number => {
        const snaps = snapByBucket.get(bucketId) ?? [];
        let base = 0, baseDate = "0000-01-01", baseCreatedAt = "";
        for (let i = snaps.length - 1; i >= 0; i--) {       // последний по date,created_at
            if (snaps[i].date <= asOf) { base = snaps[i].amount; baseDate = snaps[i].date; baseCreatedAt = snaps[i].created_at; break; }
        }
        // Единая формула с snapshots.ts:getEffectiveBalance (SPEC-011/024, ledger.ts):
        // tie-break внутри дня снапшота по created_at.
        return reconstructBalance(base, baseDate, baseCreatedAt, evtByBucket.get(bucketId) ?? [], asOf);
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

    // ── KPI burn / income / savings (WIN полных календарных месяцев) ─────────
    // SPEC-015: считаем окно дважды — текущее (shift=0) и предыдущее (shift=WIN),
    // для Δ к прошлому периоду. income_free = доход без goal-помеченного (линза
    // «свободные деньги»). missing считаем в net worth/period (overlap), не здесь.
    const curMonth = monthKey(today);
    const WIN = 3;
    const earliestMonth = monthKey(earliest);
    const windowSums = (shift: number) => {
        const start = addMonths(curMonth, -(WIN + shift)) + "-01";
        const end = endOfMonth(addMonths(curMonth, -(1 + shift)));
        let burn = 0, income = 0, incomeFree = 0;
        for (const e of expR.results) {
            if (e.date < start || e.date > end) continue;
            const v = toEurAt(e.amount, e.currency, e.date);
            if (v != null) burn += v;
        }
        for (const i of incR.results) {
            if (i.date < start || i.date > end) continue;
            const v = toEurAt(i.amount, i.currency_code, i.date);
            if (v == null) continue;
            income += v;
            if (i.goal_id == null) incomeFree += v;   // свободный доход — не отложенный в цель
        }
        // M2: знаменатель = число месяцев окна, попадающих в историю данных
        // (>= первого месяца с данными). Деление на фикс. WIN при неполной истории
        // занижало бы средние (и завышало runway) в первые недели ведения.
        let monthsCovered = 0;
        for (let i = 1; i <= WIN; i++) if (addMonths(curMonth, -(i + shift)) >= earliestMonth) monthsCovered++;
        const denom = Math.max(1, monthsCovered);
        return { burn: burn / denom, income: income / denom, incomeFree: incomeFree / denom, months: denom };
    };
    const cur = windowSums(0);
    const prev = windowSums(WIN);
    const monthlyBurn = cur.burn;
    const monthlyIncome = cur.income;
    const monthlyIncomeFree = cur.incomeFree;
    const savingsRate = monthlyIncome > 0 ? round((monthlyIncome - monthlyBurn) / monthlyIncome, 4) : null;
    const savingsRateFree = monthlyIncomeFree > 0 ? round((monthlyIncomeFree - monthlyBurn) / monthlyIncomeFree, 4) : null;
    const runway = monthlyBurn > 0 ? round(Math.max(0, freeNow) / monthlyBurn, 1) : null;
    const runwayTotal = monthlyBurn > 0 ? round(Math.max(0, netNow) / monthlyBurn, 1) : null;

    // Net worth «WIN месяцев назад» (для Δ): тот же in-memory balanceAt на конец
    // месяца WIN назад, по курсу НА ТУ дату. prev_free ≈ prevNet − targeted (текущее
    // targeted — историч. goal balance не реконструируем; для Δ-сигнала достаточно).
    // M1 (осознанно): Δ = netNow − prevNet включает валютную переоценку (FX) — это
    // реальное изменение капитала в EUR, не «чистые сбережения». При мультивалютном
    // портфеле часть Δ — движение курса, а не отложенные деньги. Формулу не меняем
    // (иначе Δ разойдётся с net-worth-series на графике); семантику фиксируем здесь.
    const prevAsOf = endOfMonth(addMonths(curMonth, -WIN));
    let prevNet = 0;
    for (const b of buckets) {
        const eur = toEurAt(balanceAt(b.id, prevAsOf), b.currency, prevAsOf);
        if (eur != null) prevNet += eur;
    }

    // ── Net worth series (по месяцам окна, конец месяца) ─────────────────────
    const netSeries = months.map(m => {
        const T = endOfMonth(m) <= today ? endOfMonth(m) : today;   // текущий месяц — до today
        const by_bucket: Record<string, number> = {};
        const by_bucket_native: Record<string, number> = {};   // SPEC-021: нативный ряд для спарклайнов /accounts
        const by_form: Record<string, number> = {};
        const by_currency: Record<string, number> = {};
        let total = 0;
        for (const b of buckets) {
            const native = balanceAt(b.id, T);                            // SPEC-021: баланс в валюте ведра (до конверсии)
            const eur = toEurAt(native, b.currency, T) ?? 0;              // нет курса → 0 (rates backfill с 2024)
            by_bucket[b.id] = r2(eur);
            by_bucket_native[b.id] = r2(native);
            by_form[b.form] = r2((by_form[b.form] ?? 0) + eur);
            by_currency[b.currency] = r2((by_currency[b.currency] ?? 0) + eur);
            total += eur;
        }
        return { month: m, total_eur: r2(total), by_bucket, by_bucket_native, by_form, by_currency };
    });

    // ── Cashflow + expenses by category (за окно [fromDate, toDate]) ─────────
    const cash = new Map<string, { income: number; income_free: number; expense: number }>();
    for (const m of months) cash.set(m, { income: 0, income_free: 0, expense: 0 });
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
        const c = cash.get(monthKey(i.date));
        if (c) { c.income += v; if (i.goal_id == null) c.income_free += v; }   // SPEC-018: линза «Свободные» per month
    }

    const cashflow_series = months.map(m => {
        const c = cash.get(m)!;
        return { month: m, income_eur: r2(c.income), income_free_eur: r2(c.income_free), expense_eur: r2(c.expense) };
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
        data_trust_from: dataTrustFrom,
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
            burn_window_months: cur.months,   // M2: фактически покрытых месяцев (≤ WIN при неполной истории)
            buckets_without_baseline: bucketsWithoutBaseline,
            missing_rates: missingRates,
            // SPEC-015: линза «свободные деньги» + Δ к предыдущему окну
            monthly_income_free_eur: r2(monthlyIncomeFree),
            savings_rate_free: savingsRateFree,
            prev_monthly_burn_eur: r2(prev.burn),
            prev_monthly_income_eur: r2(prev.income),
            prev_monthly_income_free_eur: r2(prev.incomeFree),
            prev_net_worth_eur: r2(prevNet),
            prev_free_net_worth_eur: r2(prevNet - targeted),
        },
        net_worth_series: netSeries,
        cashflow_series,
        expenses_by_category,
        buckets: buckets.map(b => ({
            id: b.id, name: b.name, form: b.form, type: b.type, currency: b.currency, color: b.color, sort_order: b.sort_order,
        })),
    };
}
