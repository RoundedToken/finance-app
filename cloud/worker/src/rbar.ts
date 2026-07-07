/**
 * RBAR — Robust Baseline + Asymmetric Ratchet (SPEC-023).
 *
 * Детерминированный (не AI) механизм адаптивных бюджетов. Per-категория:
 *   1) классификатор архетипа из истории (fixed/recurring/seasonal/lumpy/
 *      intermittent/cold-start);
 *   2) Layer-1: робастная база B_t (damped-Holt level+trend на winsorized) —
 *      честный прогноз уровня, умеет расти/падать;
 *   3) Layer-2: лимит L = max(FLOOR, B_next·(1+margin)), поджимаемый
 *      асимметричным «давлением экономии» с slew-rate, turbulence-gain,
 *      breach-rollback;
 *   4) ANTI-DRIFT инвариант: вверх лимит идёт ТОЛЬКО при подтверждённом росте
 *      базы ≥3 мес, НИКОГДА из одного перебора (иначе наивная асимметрия
 *      дрейфует +23–35% из шума и анти-экономит — урок исследования).
 *
 * Lumpy-категории (9 нулей подряд, med=0) → месячный лимит математически
 * ломается → годовой конверт (sinking fund) с переносом.
 *
 * Состояние оценщика НЕ хранится — переигрывается из expenses при каждом
 * запросе (идемпотентно, устойчиво к до-вводу задним числом; G6). Чистые
 * функции тестируются без D1; D1-обёртки внизу.
 *
 * Advisory-first (G5): тут только РАСЧЁТ рекомендаций; применение лимита —
 * через существующий PUT/POST budgets (SPEC-020). Авто-применение — Фаза 3.
 */
import type { Env } from "./types";
import { loadRatesIndex, type RatesIndex } from "./rates";
import type { ExpenseLite } from "./budgets";
import {
    clamp, mean, sum, median, madScaled, quantile, theilSen,
    zeroFraction, acf,
} from "./stats";

// ── Конфигурация (фиксированная политика по архетипу; НЕ оптимизируется на
//    истории — на N=12–29 это переобучение, NG4). Дефолты из исследования. ──

export interface RbarConfig {
    alpha: number;      // Holt level
    beta: number;       // Holt trend
    phi: number;        // damping
    winsorC: number;    // порог Hampel-винзоризации в σ_MAD
    stepUp: number;     // макс. шаг лимита вверх (×g)
    stepDown: number;   // макс. шаг вниз
    margin: number;     // надбавка-headroom над прогнозом базы
    pressureStep: number;// шаг сберегательного давления за сработавшую серию
    sMax: number;       // потолок суммарного сберегательного давления (owner: 8%)
    gUp: number;        // порог «сильного» перебора → rollback
    tolMove: number;    // decision-deadband (доля L)
    streakUnder: number;// мес в рамках → доп. поджатие
    streakBaseUp: number;// мес роста базы → разрешить up-move (anti-drift)
    covLo: number;
    covHi: number;
    gMin: number;
    lumpyQuantile: number;
    warmup: number;     // мес до включения адаптации
    window: number;     // trailing-окно для med/MAD
}

export const DEFAULT_CONFIG: RbarConfig = {
    alpha: 0.25,
    beta: 0.08,
    phi: 0.9,
    winsorC: 3.0,
    stepUp: 0.05,
    stepDown: 0.025,
    margin: 0.05,
    pressureStep: 0.025, // +2.5pp давления за каждую сработавшую серию экономии
    sMax: 0.08,          // консервативно (решение owner'а 2026-05-31)
    gUp: 0.25,
    tolMove: 0.005,
    streakUnder: 2,
    streakBaseUp: 3,
    covLo: 0.4,
    covHi: 2.0,
    gMin: 0.3,
    lumpyQuantile: 0.80,
    warmup: 6,
    window: 18,
};

// ── Типы ────────────────────────────────────────────────────────────────────

export type Archetype =
    | "fixed" | "recurring" | "seasonal" | "lumpy" | "intermittent" | "cold-start";

export type ReasonCode =
    | "SAVINGS_STREAK" | "TRACKING_DOWN" | "TRACKING_UP"
    | "HOLD" | "HOLD_AFTER_BREACH" | "ROLLBACK" | "FLOOR_HIT" | "COLD_START";

const REASON_TEXT: Record<ReasonCode, string> = {
    SAVINGS_STREAK: "несколько месяцев в рамках — поджимаем",
    TRACKING_DOWN: "база снижается — поджимаем",
    TRACKING_UP: "устойчивый рост ≥3 мес — поднимаем планку",
    HOLD: "стабильно — держим лимит",
    HOLD_AFTER_BREACH: "разовый перебор — держим планку, не поднимаем",
    ROLLBACK: "сильное превышение — возврат к комфортной планке",
    FLOOR_HIT: "достигнут пол — ниже не жмём",
    COLD_START: "мало данных — собираю историю",
};

export interface ArchetypeMetrics {
    n_months: number;
    median_eur: number;
    mean_eur: number;
    cov_resid: number;
    zero_frac: number;
    trend_pct_mo: number;
    spike: boolean;
}

export interface RecurringStep {
    month: string;
    spent_eur: number;
    baseline_eur: number;
    limit_eur: number;
    reason_code: ReasonCode;
    g: number;
    floor_eur: number;
}

export interface EnvelopeInfo {
    annual_eur: number;
    accrual_monthly_eur: number;
    accrued_eur: number;
    spent_trailing_12m_eur: number;
    alert: boolean;
}

export interface Recommendation {
    category_id: string;
    name: string;
    emoji: string | null;
    color: string | null;
    archetype: Archetype;
    archetype_override: Archetype | null;
    budget_id: string | null;             // id ручного бюджета SPEC-020 (для apply→PUT); null — бюджета нет
    current_limit_eur: number | null;     // ручной лимит SPEC-020 (для сравнения)
    recommended_limit_eur: number | null; // null для lumpy/fixed/cold-start
    delta_pct: number | null;
    baseline_eur: number | null;
    floor_eur: number | null;
    reason_code: ReasonCode | null;
    reason_text: string | null;
    confidence: "ok" | "low";
    envelope: EnvelopeInfo | null;
    dismissed: boolean;                    // рекомендация скрыта на этот период
}

export interface RecommendationsResult {
    period: string;       // "YYYY-MM" — месяц, НА который рекомендация
    currency: "EUR";
    recommendations: Recommendation[];
}

// ── Ось месяцев ──────────────────────────────────────────────────────────────

function monthIndex(ym: string): number {
    const [y, m] = ym.split("-").map(Number);
    return y * 12 + (m - 1);
}
function indexToMonth(idx: number): string {
    const y = Math.floor(idx / 12);
    const m = (idx % 12) + 1;
    return `${y}-${String(m).padStart(2, "0")}`;
}
export function prevMonth(ym: string): string {
    return indexToMonth(monthIndex(ym) - 1);
}
function enumerateMonths(startYm: string, endYm: string): string[] {
    const a = monthIndex(startYm);
    const b = monthIndex(endYm);
    const out: string[] = [];
    for (let i = a; i <= b; i++) out.push(indexToMonth(i));
    return out;
}

// ── Классификатор архетипа ───────────────────────────────────────────────────

/**
 * Остатки после снятия Theil-Sen тренда (робастная линия med-of-pairwise-slopes
 * + медианный intercept). Нужно, чтобы «шум» (cov_resid) не путался с трендом:
 * на растущем ряде сырой CoV завышен (см. SPEC §5), детрендированный — честный.
 */
function detrendResiduals(series: number[]): number[] {
    const n = series.length;
    if (n < 3) return series.slice();
    const slope = theilSen(series);
    const intercept = median(series.map((y, i) => y - slope * i));
    return series.map((y, i) => y - (intercept + slope * i));
}

export function computeMetrics(series: number[]): ArchetypeMetrics {
    const n = series.length;
    const med = median(series);
    const mn = mean(series);
    const nonZero = series.filter(x => x > 0);
    const spike = nonZero.length > 0 && Math.max(...series) > 2.5 * median(nonZero);
    const slope = theilSen(series);
    // cov_resid — масштаб ШУМА (MAD остатков) относительно УРОВНЯ (median), AC1.
    const covResid = madScaled(detrendResiduals(series)) / Math.max(med, 1);
    return {
        n_months: n,
        median_eur: med,
        mean_eur: mn,
        cov_resid: covResid,
        zero_frac: zeroFraction(series),
        trend_pct_mo: mn > 0 ? (slope / mn) * 100 : 0,
        spike,
    };
}

/**
 * Классификация архетипа из истории (метрики на робастных оценках).
 * Порядок ветвей важен (white-box дерево §1.1 плана). При override —
 * возвращаем его (пользователь не согласен с авто).
 *
 * Замечание: гистерезис границы lumpy↔recurring (15%) — Фаза 3 (требует
 * хранения предыдущего архетипа). В v1 классификация детерминирована из
 * данных; пользователь может зафиксировать архетип через override.
 */
export function classifyArchetype(
    series: number[],
    cfg: RbarConfig = DEFAULT_CONFIG,
    override?: Archetype | null,
): { archetype: Archetype; metrics: ArchetypeMetrics } {
    const metrics = computeMetrics(series);
    if (override) return { archetype: override, metrics };

    const { n_months: n, median_eur: med, mean_eur: mn, cov_resid: cov, zero_frac: zero } = metrics;

    let archetype: Archetype;
    if (n < cfg.warmup) archetype = "cold-start";
    else if (zero >= 0.40 || (cov >= 1.2 && med < 0.5 * mn)) archetype = "lumpy";
    else if (med < 25 && mn < 40) archetype = "intermittent";
    else if (cov <= 0.15 && Math.abs(theilSen(series)) / Math.max(med, 1) < 0.01) archetype = "fixed";
    else if (n >= 24 && acf(series, 12) > 0.4) archetype = "seasonal";
    else archetype = "recurring";

    return { archetype, metrics };
}

// ── Layer-1 + Layer-2: recurring/seasonal закон (полный реплей) ──────────────

export interface RecurringResult {
    recommended_limit_eur: number;
    baseline_eur: number;
    floor_eur: number;
    reason_code: ReasonCode;
    trajectory: RecurringStep[];
}

/**
 * Полный реплей recurring-контура по месячному ряду. Возвращает итоговый
 * рекомендованный лимит (на следующий месяц) + траекторию (для бэктеста).
 *
 * months[i] соответствует series[i]; months используется только для меток
 * траектории. floorOverride — ручной абсолютный пол (NULL = авто 0.6·median).
 */
export function recommendRecurring(
    series: number[],
    months: string[],
    cfg: RbarConfig = DEFAULT_CONFIG,
    floorOverride?: number | null,
): RecurringResult {
    const n = series.length;
    const trajectory: RecurringStep[] = [];

    // Сид базы из первых `warmup` месяцев (робастно).
    const warm = series.slice(0, Math.min(cfg.warmup, n));
    const warmNonZero = warm.filter(x => x > 0);
    let bLvl = median(warmNonZero.length ? warmNonZero : warm) || mean(warm);
    let bTrd = 0;

    const med0 = median(series.filter(x => x > 0)) || median(series) || bLvl;
    const floor0 = Math.max(floorOverride ?? 0, 0.6 * med0);
    let L = Math.max(floor0, bLvl * (1 + cfg.margin));

    let streakUnder = 0;
    let streakBaseUp = 0;
    let s = 0;                            // сберегательное давление ∈ [0, S_MAX]
    const recentLimits: number[] = [];    // для L_comfort (робастная медиана последних)

    for (let i = Math.min(cfg.warmup, n); i < n; i++) {
        const x = series[i];

        // Trailing-окно для med/MAD/CoV (робастные оценки масштаба).
        const win = series.slice(Math.max(0, i - cfg.window), i);
        const med = median(win.filter(v => v > 0)) || median(win) || bLvl;
        // Floor на σ_MAD: на плоской истории (MAD=0) коридор должен быть УЗКИМ
        // (любое крупное отклонение = спайк), иначе всплеск протекает в базу.
        const sMad = Math.max(madScaled(win), 0.1 * Math.max(med, 1));
        const cov = sMad / Math.max(med, 1);
        const g = clamp(1 - (cov - cfg.covLo) / (cfg.covHi - cfg.covLo), cfg.gMin, 1);
        const floor = Math.max(floorOverride ?? 0, 0.6 * med);

        // 1) winsorize наблюдения ДО входа в EWMA (гасит one-off всплеск).
        const xw = clamp(x, bLvl - cfg.winsorC * sMad, bLvl + cfg.winsorC * sMad);

        // 2) damped-Holt база.
        const bLvlPrev = bLvl;
        bLvl = cfg.alpha * xw + (1 - cfg.alpha) * (bLvl + cfg.phi * bTrd);
        bTrd = cfg.beta * (bLvl - bLvlPrev) + (1 - cfg.beta) * cfg.phi * bTrd;
        const bNext = bLvl + cfg.phi * bTrd;

        // 3) target = база + headroom-margin − сберегательное давление s.
        //    s∈[0,S_MAX]: серии экономии тянут лимит до S_MAX ниже прогноза базы.
        const lTarget = Math.max(floor, bNext * (1 + cfg.margin - s));

        // 4) slew + decision-deadband.
        const delta = lTarget - L;
        let lRaw = L;
        if (Math.abs(delta) >= cfg.tolMove * L) {
            lRaw = L + clamp(delta, -cfg.stepDown * L, g * cfg.stepUp * L);
        }

        // 5) ANTI-DRIFT (безусловный инвариант): лимит идёт ВВЕРХ только при
        //    подтверждённом росте базы ≥3 мес — никогда из шума/одиночного спайка.
        const baseUpConfirmed = streakBaseUp >= cfg.streakBaseUp;
        if (!baseUpConfirmed) lRaw = Math.min(lRaw, L);

        // 6) breach-rollback при сильном переборе.
        const lComfort = recentLimits.length ? median(recentLimits) : L;
        let reason: ReasonCode;
        let lNext: number;
        const pressureRose = s > 0;
        if (x > L * (1 + cfg.gUp)) {
            lNext = Math.max(lRaw, lComfort);
            reason = "ROLLBACK";
        } else {
            lNext = lRaw;
            // Рост лимита = TRACKING_UP (возможен лишь при подтверждённой базе).
            if (lNext > L + 1e-6) reason = "TRACKING_UP";
            else if (x > L) reason = "HOLD_AFTER_BREACH";
            else if (lNext < L - 1e-6) reason = pressureRose ? "SAVINGS_STREAK" : "TRACKING_DOWN";
            else reason = "HOLD";
        }

        // 7) пол.
        if (lNext < floor) { lNext = floor; reason = "FLOOR_HIT"; }

        // 8) обновить счётчики + сберегательное давление (асимметрия).
        streakBaseUp = bLvl > bLvlPrev * 1.005 ? streakBaseUp + 1 : 0;
        if (x > L) {
            s = Math.max(0, s - 0.05);    // перебор → ослабить давление (к комфорту)
            streakUnder = 0;
        } else {
            streakUnder++;
            if (streakUnder >= cfg.streakUnder) {   // серия в рамках → +шаг давления
                s = Math.min(s + cfg.pressureStep, cfg.sMax);
                streakUnder = 0;
            }
        }
        recentLimits.push(lNext);
        if (recentLimits.length > 3) recentLimits.shift();

        trajectory.push({
            month: months[i] ?? indexToMonth(i),
            spent_eur: x,
            baseline_eur: bNext,
            limit_eur: lNext,
            reason_code: reason,
            g,
            floor_eur: floor,
        });
        L = lNext;
    }

    const last = trajectory[trajectory.length - 1];
    return {
        recommended_limit_eur: last ? last.limit_eur : L,
        baseline_eur: last ? last.baseline_eur : bLvl,
        floor_eur: last ? last.floor_eur : floor0,
        reason_code: last ? last.reason_code : "COLD_START",
        trajectory,
    };
}

// ── Lumpy: годовой конверт (sinking fund) ────────────────────────────────────

export function computeEnvelope(
    series: number[],
    cfg: RbarConfig = DEFAULT_CONFIG,
    currentMonthSpentEur: number | null = null,
): EnvelopeInfo {
    const n = series.length;
    const last12 = series.slice(Math.max(0, n - 12));

    // Скользящие 12-мес суммы (за всю историю).
    const rolling: number[] = [];
    for (let i = 12; i <= n; i++) rolling.push(sum(series.slice(i - 12, i)));

    // Винзоризованная сумма последних 12 (нижняя оценка).
    const nz = last12.filter(x => x > 0);
    const med = median(nz.length ? nz : last12);
    const sMad = madScaled(last12) || med || 1;
    const last12w = last12.map(x => Math.min(x, med + 3 * sMad));

    const annualA = rolling.length ? quantile(rolling, cfg.lumpyQuantile) : sum(last12);
    const annualB = 1.1 * sum(last12w);
    const annual = Math.max(annualA, annualB);
    const accrual = annual / 12;

    // Накоплено: реплей баланса конверта по закрытым месяцам (capped, не уходит в минус).
    let bal = 0;
    const cap = 12 * accrual;
    for (const x of series) bal = clamp(bal + accrual - x, 0, cap);
    // Текущий (незакрытый) месяц — тот же шаг реплея: +отчисление − уже потраченное.
    // Размер конверта (annual/accrual) считается по закрытым месяцам, но БАЛАНС обязан
    // быть живым: иначе линза «доступно потратить сейчас» (SPEC-023) застывала на конце
    // прошлого месяца и не реагировала на свежую трату (был баг — трата на поездку не
    // уменьшала конверт). Отчисление за текущий месяц начисляется сразу, в начале месяца
    // (owner-решение 2026-06-02). null = нет контекста текущего месяца (чистый бэктест/
    // история) → шаг пропускается, поведение как раньше.
    if (currentMonthSpentEur != null) {
        bal = clamp(bal + accrual - currentMonthSpentEur, 0, cap);
    }

    const spentTrailing12 = sum(last12);
    return {
        annual_eur: round2(annual),
        accrual_monthly_eur: round2(accrual),
        accrued_eur: round2(bal),
        spent_trailing_12m_eur: round2(spentTrailing12),
        alert: spentTrailing12 > annual * 1.15,
    };
}

const round2 = (x: number) => Math.round(x * 100) / 100;

// ── Оркестратор (чистое ядро) ────────────────────────────────────────────────

export interface CategoryRef {
    id: string;
    name: string;
    emoji: string | null;
    color: string | null;
}

export interface CategorySettings {
    archetype_override: Archetype | null;
    floor_eur: number | null;
    adaptive_enabled: boolean;
}

export interface RecommendationsInput {
    expenses: ExpenseLite[];
    rates: RatesIndex;
    categories: CategoryRef[];
    budgets: Map<string, { id: string; limit_eur: number }>;  // category_id → manual budget
    settings: Map<string, CategorySettings>;
    dismissed: Set<string>;                                    // category_id скрыт на period
    period: string;                                            // "YYYY-MM"
}

interface CatSeries {
    series: number[];
    months: string[];
    missing: number;
    total: number;
    currentEur: number;   // EUR-сумма трат текущего (незакрытого) месяца — для живого баланса конверта
}

/**
 * Строит per-категория месячный EUR-ряд (date-aware) по ЗАКРЫТЫМ месяцам (≤ lastClosed)
 * + отдельно EUR-сумму трат ТЕКУЩЕГО (незакрытого) месяца `period`. Ряд и метрики
 * (классификация / recurring / sizing конверта) — только закрытые месяцы; `currentEur`
 * нужен лишь для живого баланса lumpy-конверта, чтобы линза реагировала на свежую трату.
 */
function buildSeries(
    expenses: ExpenseLite[],
    rates: RatesIndex,
    lastClosed: string,
    period: string,
): Map<string, CatSeries> {
    const byCat = new Map<string, { ymSum: Map<string, number>; missing: number; total: number; minYm: string | null; currentEur: number }>();
    for (const e of expenses) {
        const cid = e.category_id;
        if (cid == null) continue;
        const ym = e.date.slice(0, 7);
        if (ym > period) continue;       // будущее относительно текущего месяца — игнор
        let rec = byCat.get(cid);
        if (!rec) { rec = { ymSum: new Map(), missing: 0, total: 0, minYm: null, currentEur: 0 }; byCat.set(cid, rec); }
        const v = rates.toEurAt(e.amount, e.currency, e.date);
        if (ym > lastClosed) {           // текущий незакрытый месяц → только для живого баланса конверта,
            if (v != null) rec.currentEur += v;   // вне ряда/метрик закрытых месяцев (классификацию не трогаем)
            continue;
        }
        rec.total++;
        if (v == null) { rec.missing++; continue; }
        rec.ymSum.set(ym, (rec.ymSum.get(ym) ?? 0) + v);
        if (rec.minYm == null || ym < rec.minYm) rec.minYm = ym;
    }

    const out = new Map<string, CatSeries>();
    for (const [cid, rec] of byCat) {
        if (rec.minYm == null) continue;
        const months = enumerateMonths(rec.minYm, lastClosed);
        const series = months.map(m => rec.ymSum.get(m) ?? 0);
        out.set(cid, { series, months, missing: rec.missing, total: rec.total, currentEur: rec.currentEur });
    }
    return out;
}

export function computeRecommendationsCore(
    input: RecommendationsInput,
    cfg: RbarConfig = DEFAULT_CONFIG,
): RecommendationsResult {
    const lastClosed = prevMonth(input.period);
    const seriesByCat = buildSeries(input.expenses, input.rates, lastClosed, input.period);

    const recommendations: Recommendation[] = [];
    for (const cat of input.categories) {
        const cs = seriesByCat.get(cat.id);
        const settings = input.settings.get(cat.id);
        if (settings && settings.adaptive_enabled === false) continue;  // адаптация выключена

        const series = cs ? cs.series : [];
        const months = cs ? cs.months : [];
        const { archetype, metrics } = classifyArchetype(series, cfg, settings?.archetype_override ?? null);
        const budget = input.budgets.get(cat.id) ?? null;
        const currentLimit = budget ? budget.limit_eur : null;
        const confidence: "ok" | "low" =
            cs && cs.total > 0 && cs.missing / cs.total > 0.1 ? "low" : "ok";

        const base: Recommendation = {
            category_id: cat.id,
            name: cat.name,
            emoji: cat.emoji,
            color: cat.color,
            archetype,
            archetype_override: settings?.archetype_override ?? null,
            budget_id: budget ? budget.id : null,
            current_limit_eur: currentLimit,
            recommended_limit_eur: null,
            delta_pct: null,
            baseline_eur: null,
            floor_eur: null,
            reason_code: null,
            reason_text: null,
            confidence,
            envelope: null,
            dismissed: input.dismissed.has(cat.id),
        };

        if (archetype === "lumpy") {
            base.envelope = computeEnvelope(series, cfg, cs ? cs.currentEur : 0);
        } else if (archetype === "recurring" || archetype === "seasonal") {
            // seasonal в v1 использует recurring-закон (YoY-уточнение — Фаза 3/4).
            const r = recommendRecurring(series, months, cfg, settings?.floor_eur ?? null);
            base.recommended_limit_eur = round2(r.recommended_limit_eur);
            base.baseline_eur = round2(r.baseline_eur);
            base.floor_eur = round2(r.floor_eur);
            base.reason_code = r.reason_code;
            base.reason_text = REASON_TEXT[r.reason_code];
            if (currentLimit != null && currentLimit > 0) {
                base.delta_pct = round2(((r.recommended_limit_eur - currentLimit) / currentLimit) * 100);
            }
        } else if (archetype === "cold-start") {
            base.reason_code = "COLD_START";
            base.reason_text = `мало данных (${metrics.n_months}/${cfg.warmup} мес) — собираю историю`;
        }
        // fixed/intermittent — без рекомендации (recommended=null); fixed change-point — Фаза 2/3.

        recommendations.push(base);
    }

    return { period: input.period, currency: "EUR", recommendations };
}

// ── D1-обёртки ───────────────────────────────────────────────────────────────

function todayUtc(): string {
    return new Date().toISOString().slice(0, 10);
}

async function loadCommon(env: Env, period: string, ratesArg?: RatesIndex, expensesArg?: ExpenseLite[]) {
    const [exp, rates, cats, budgetsR, settingsR, dismissedR] = await Promise.all([
        // WRK-22 (SPEC-047): bootstrap уже загрузил траты — не сканируем второй раз.
        expensesArg
            ? Promise.resolve({ results: expensesArg })
            : env.DB.prepare(
                "SELECT date, amount, currency, category_id FROM expenses WHERE deleted_at IS NULL",
            ).all<ExpenseLite>(),
        ratesArg ? Promise.resolve(ratesArg) : loadRatesIndex(env),   // SPEC-038: bootstrap шарит индекс
        env.DB.prepare(
            "SELECT id, name, emoji, color FROM categories WHERE type = 'expense' AND is_active = 1 ORDER BY sort_order, name",
        ).all<CategoryRef>(),
        env.DB.prepare(
            "SELECT id, category_id, limit_eur FROM budgets WHERE deleted_at IS NULL AND scope = 'category'",
        ).all<{ id: string; category_id: string; limit_eur: number }>(),
        env.DB.prepare(
            "SELECT category_id, archetype_override, floor_eur, adaptive_enabled FROM budget_settings",
        ).all<{ category_id: string; archetype_override: string | null; floor_eur: number | null; adaptive_enabled: number }>(),
        env.DB.prepare(
            "SELECT DISTINCT category_id FROM budget_recommendation_log WHERE period = ? AND decision = 'dismissed'",
        ).bind(period).all<{ category_id: string }>(),
    ]);

    const budgets = new Map<string, { id: string; limit_eur: number }>();
    for (const b of budgetsR.results) budgets.set(b.category_id, { id: b.id, limit_eur: b.limit_eur });

    const settings = new Map<string, CategorySettings>();
    for (const s of settingsR.results) {
        settings.set(s.category_id, {
            archetype_override: (s.archetype_override as Archetype | null) ?? null,
            floor_eur: s.floor_eur,
            adaptive_enabled: s.adaptive_enabled !== 0,
        });
    }

    const dismissed = new Set<string>(dismissedR.results.map(r => r.category_id));

    return { expenses: exp.results, rates, categories: cats.results, budgets, settings, dismissed };
}

/** Полные рекомендации для Admin (advisory). */
export async function getRecommendations(env: Env, opts: { period?: string } = {}): Promise<RecommendationsResult> {
    const period = opts.period ?? todayUtc().slice(0, 7);
    const common = await loadCommon(env, period);
    return computeRecommendationsCore({ ...common, period }, DEFAULT_CONFIG);
}

/** Классификация всех активных расходных категорий + метрики (для UX override). */
export async function getArchetypes(env: Env): Promise<{
    categories: Array<{
        category_id: string; name: string; emoji: string | null; color: string | null;
        detected_archetype: Archetype; archetype_override: Archetype | null;
        floor_eur: number | null; adaptive_enabled: boolean; metrics: ArchetypeMetrics;
    }>;
}> {
    const period = todayUtc().slice(0, 7);
    const common = await loadCommon(env, period);
    const lastClosed = prevMonth(period);
    const seriesByCat = buildSeries(common.expenses, common.rates, lastClosed, period);

    const categories = common.categories.map(cat => {
        const cs = seriesByCat.get(cat.id);
        const series = cs ? cs.series : [];
        const settings = common.settings.get(cat.id);
        const { archetype, metrics } = classifyArchetype(series, DEFAULT_CONFIG, null);  // detected = авто, без override
        return {
            category_id: cat.id,
            name: cat.name,
            emoji: cat.emoji,
            color: cat.color,
            detected_archetype: archetype,
            archetype_override: settings?.archetype_override ?? null,
            floor_eur: settings?.floor_eur ?? null,
            adaptive_enabled: settings ? settings.adaptive_enabled : true,
            metrics,
        };
    });
    return { categories };
}

/** Lumpy-конверты для read-only lens в Mini App (bootstrap). expensesArg — уже
 *  загруженные bootstrap'ом траты (WRK-22: без второго полного скана таблицы). */
export async function getEnvelopesForBootstrap(env: Env, ratesArg?: RatesIndex, expensesArg?: ExpenseLite[]): Promise<Array<{ category_id: string; accrued_eur: number; annual_eur: number }>> {
    const period = todayUtc().slice(0, 7);
    const common = await loadCommon(env, period, ratesArg, expensesArg);
    const lastClosed = prevMonth(period);
    const seriesByCat = buildSeries(common.expenses, common.rates, lastClosed, period);

    const out: Array<{ category_id: string; accrued_eur: number; annual_eur: number }> = [];
    for (const cat of common.categories) {
        const cs = seriesByCat.get(cat.id);
        if (!cs) continue;
        const settings = common.settings.get(cat.id);
        if (settings && settings.adaptive_enabled === false) continue;
        const { archetype } = classifyArchetype(cs.series, DEFAULT_CONFIG, settings?.archetype_override ?? null);
        if (archetype !== "lumpy") continue;
        const env_ = computeEnvelope(cs.series, DEFAULT_CONFIG, cs.currentEur);
        out.push({ category_id: cat.id, accrued_eur: env_.accrued_eur, annual_eur: env_.annual_eur });
    }
    return out;
}

// ── Settings CRUD + decision log ─────────────────────────────────────────────

export type Result<T extends Record<string, any> = {}> =
    | ({ ok: true } & T)
    | { ok: false; error: string };

const ARCHETYPES: Archetype[] = ["fixed", "recurring", "seasonal", "lumpy", "intermittent"];

export interface SettingsPatch {
    archetype_override?: Archetype | null;
    floor_eur?: number | null;
    adaptive_enabled?: boolean;
}

export async function upsertBudgetSettings(env: Env, categoryId: string, patch: SettingsPatch): Promise<Result<{ updated: boolean }>> {
    const cat = await env.DB.prepare(
        "SELECT 1 FROM categories WHERE id = ? AND type = 'expense'",
    ).bind(categoryId).first();
    if (!cat) return { ok: false, error: "unknown expense category" };
    if (patch.archetype_override != null && !ARCHETYPES.includes(patch.archetype_override)) {
        return { ok: false, error: "invalid archetype_override" };
    }

    // UPSERT: непереданные поля сохраняются, явный null очищает (WRK-02: прежний
    // COALESCE делал сброс override/floor на «авто» невозможным). Паттерн — как в
    // upsertInvestmentSettings (investments.ts).
    const hasOverride = Object.prototype.hasOwnProperty.call(patch, "archetype_override");
    const hasFloor = Object.prototype.hasOwnProperty.call(patch, "floor_eur");
    const hasEnabled = patch.adaptive_enabled !== undefined;
    const r = await env.DB.prepare(
        `INSERT INTO budget_settings (category_id, archetype_override, floor_eur, adaptive_enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
         ON CONFLICT(category_id) DO UPDATE SET
            archetype_override = ${hasOverride ? "?" : "archetype_override"},
            floor_eur          = ${hasFloor ? "?" : "floor_eur"},
            adaptive_enabled   = ${hasEnabled ? "?" : "adaptive_enabled"},
            updated_at         = datetime('now')`,
    ).bind(
        categoryId,
        patch.archetype_override ?? null,
        patch.floor_eur ?? null,
        hasEnabled ? (patch.adaptive_enabled ? 1 : 0) : 1,
        ...(hasOverride ? [patch.archetype_override ?? null] : []),
        ...(hasFloor ? [patch.floor_eur ?? null] : []),
        ...(hasEnabled ? [patch.adaptive_enabled ? 1 : 0] : []),
    ).run();
    return { ok: true, updated: (r.meta.changes ?? 0) > 0 };
}

export interface DecisionPayload {
    category_id: string;
    period: string;
    archetype: string;
    prev_limit_eur?: number | null;
    reco_limit_eur: number;
    reason_code: string;
    decision: "accepted" | "dismissed";
}

export async function logRecommendationDecision(env: Env, p: DecisionPayload): Promise<Result<{ id: string }>> {
    // Guard: категория существует и расходная (консистентно с upsertBudgetSettings;
    // FK в D1 не enforced, не даём загрязнять аудит-лог произвольным category_id).
    const cat = await env.DB.prepare(
        "SELECT 1 FROM categories WHERE id = ? AND type = 'expense'",
    ).bind(p.category_id).first();
    if (!cat) return { ok: false, error: "unknown expense category" };

    const id = crypto.randomUUID();
    await env.DB.prepare(
        `INSERT INTO budget_recommendation_log
            (id, category_id, period, archetype, prev_limit_eur, reco_limit_eur, reason_code, decision, decided_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    ).bind(
        id, p.category_id, p.period, p.archetype,
        p.prev_limit_eur ?? null, p.reco_limit_eur, p.reason_code, p.decision,
    ).run();
    return { ok: true, id };
}
