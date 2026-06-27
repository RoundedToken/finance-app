/**
 * Чистая математика экрана «Статистика» (SPEC-036) — порт vanilla-движка SPEC-003
 * на React + метрику `amount_eur` (date-aware EUR, SPEC-016/ADR-014).
 *
 * Никаких side-effects: вся агрегация поверх уже загруженных трат (тот же набор,
 * что у Истории). Worker/D1 не задействованы.
 */
import type { Expense } from "@/api/types";
import { pad2 } from "@/lib/utils";

export type Mode = "month" | "year" | "all";

/**
 * 12-цветная hue-разнесённая палитра для donut/списка (порт SPEC-003). Соседние
 * индексы максимально разнесены по hue — даже когда в donut выпали топ-2 (а не 8)
 * категории, они не сливаются. Не пастельные cat.color (те сливаются на donut).
 */
export const CHART_PALETTE = [
    "#a78bfa", // violet
    "#fbbf24", // amber
    "#34d399", // emerald
    "#fb7185", // rose
    "#22d3ee", // cyan
    "#a3e635", // lime
    "#f472b6", // pink
    "#60a5fa", // sky
    "#fdba74", // orange
    "#c084fc", // light-purple
    "#86efac", // light-green
    "#fca5a5", // light-red
];
export const CHART_OTHER = "#5a5378"; // donut «Прочее»
export const CHART_TAIL = "#6b6494";  // хвост списка (топ-N+) — мягкий лиловый
export const TOP_N = 8;

/** Короткие имена месяцев для оси тренда (Год/Всё). */
export const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/** Префикс даты периода для клиентского фильтра (идентичен Истории). null = всё время. */
export function periodPrefix(mode: Mode, year: number, month: number): string | null {
    if (mode === "all") return null;
    return mode === "month" ? `${year}-${pad2(month + 1)}` : `${year}`;
}

/** Фильтр набора по периоду (date-prefix) — та же логика, что у Истории (R1). */
export function filterByPeriod(expenses: Expense[], mode: Mode, year: number, month: number): Expense[] {
    const prefix = periodPrefix(mode, year, month);
    if (prefix == null) return expenses;
    return expenses.filter(e => e.date.startsWith(prefix));
}

export interface Aggregate {
    total: number;                       // Σ amount_eur (EUR)
    missing: number;                     // кол-во трат без курса (amount_eur == null)
    count: number;                       // всего трат в периоде (включая missing)
    byCat: Map<string | null, number>;   // category_id → Σ amount_eur
    byDate: Map<string, number>;         // YYYY-MM-DD → Σ amount_eur
}

/**
 * Агрегат поверх УЖЕ отфильтрованного по периоду набора. Метрика — `amount_eur`.
 * Траты без курса (null) учитываются в `count`, но исключаются из сумм (E1/AC8).
 */
export function aggregate(rows: Expense[]): Aggregate {
    let total = 0, missing = 0;
    const byCat = new Map<string | null, number>();
    const byDate = new Map<string, number>();
    for (const e of rows) {
        const v = e.amount_eur;
        if (v == null) { missing++; continue; }
        total += v;
        byCat.set(e.category_id, (byCat.get(e.category_id) ?? 0) + v);
        byDate.set(e.date, (byDate.get(e.date) ?? 0) + v);
    }
    return { total, missing, count: rows.length, byCat, byDate };
}

export interface Palette {
    items: [string | null, number][];        // отсортировано по убыванию суммы
    colorByCat: Map<string | null, string>;  // общий маппинг для donut/списка/бара
    topIds: (string | null)[];               // топ-N id (получают уникальный цвет)
}

/** Маппинг цвет↔категория: топ-N — уникальные цвета палитры, хвост — CHART_TAIL. */
export function buildPalette(byCat: Map<string | null, number>): Palette {
    const items = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
    const colorByCat = new Map<string | null, string>();
    items.forEach(([cid], i) => colorByCat.set(cid, i < TOP_N ? CHART_PALETTE[i] : CHART_TAIL));
    return { items, colorByCat, topIds: items.slice(0, TOP_N).map(([cid]) => cid) };
}

/** Кол-во дней в месяце (локально-безопасно). month0 = 0..11. */
export function daysInMonth(year: number, month0: number): number {
    return new Date(year, month0 + 1, 0).getDate();
}

export interface Range { from: string; to: string; }

/** Границы периода как ISO. all → min..max дат набора (today..today если пусто, E3). */
export function periodRange(mode: Mode, year: number, month: number, all: Expense[], todayIso: string): Range {
    if (mode === "month") {
        const mm = pad2(month + 1);
        return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${pad2(daysInMonth(year, month))}` };
    }
    if (mode === "year") return { from: `${year}-01-01`, to: `${year}-12-31` };
    if (!all.length) return { from: todayIso, to: todayIso };
    let min = all[0].date, max = all[0].date;
    for (const e of all) { if (e.date < min) min = e.date; if (e.date > max) max = e.date; }
    return { from: min, to: max };
}

/** Кол-во календарных дней [from..to] включительно. Парсим в UTC (`Z`), иначе
 *  переход DST делает сутки 23/25 ч → Math.floor теряет/добавляет день (SPEC-036 review). */
export function daysInclusive(from: string, to: string): number {
    const a = Date.parse(`${from}T00:00:00Z`);
    const b = Date.parse(`${to}T00:00:00Z`);
    return Math.max(1, Math.floor((b - a) / 86_400_000) + 1);
}

/**
 * ≈ средняя трата в день. Для текущего (in-progress) периода делим на ПРОШЕДШИЕ
 * дни (from..today), иначе средняя занижена в начале месяца. Для прошлых — на всю длину.
 */
export function avgPerDay(total: number, range: Range, todayIso: string): number {
    const span = range.to >= todayIso && range.from <= todayIso
        ? daysInclusive(range.from, todayIso)
        : daysInclusive(range.from, range.to);
    return total / Math.max(1, span);
}

export type Delta =
    | { kind: "up" | "down"; pct: number }
    | { kind: "flat" }
    | { kind: "new" }
    | null;

/** Дельта текущего total к прошлому периоду (AC3, E4). */
export function computeDelta(curTotal: number, prevTotal: number | null): Delta {
    if (prevTotal == null) return null;
    if (prevTotal > 0) {
        const pct = ((curTotal - prevTotal) / prevTotal) * 100;
        if (Math.abs(pct) < 0.5) return { kind: "flat" };
        return { kind: pct > 0 ? "up" : "down", pct: Math.abs(pct) };
    }
    return curTotal > 0 ? { kind: "new" } : null;
}

export interface TrendBin {
    label: string;      // подпись бара/тика
    sum: number;        // Σ amount_eur бина
    isToday: boolean;   // текущий день/месяц — выделяется
    key: string;        // iso дня (month) или YYYY-MM (year/all)
}

export interface Trend {
    title: string;
    bins: TrendBin[];
    avg: number;        // средняя по прошедшим бинам
    max: number;        // максимум (для нормировки высоты)
    byMonth: boolean;   // true → бины по месяцам (год/всё), false → по дням (месяц)
}

/** Тренд: Месяц → бины по дням; Год/Всё → по месяцам. */
export function buildTrend(agg: Aggregate, mode: Mode, range: Range, todayIso: string): Trend {
    const todayYM = todayIso.slice(0, 7);
    const bins: TrendBin[] = [];

    if (mode === "month") {
        const [y, m] = range.from.split("-").map(Number); // m = 1..12
        const dim = daysInMonth(y, m - 1);
        for (let day = 1; day <= dim; day++) {
            const iso = `${range.from.slice(0, 8)}${pad2(day)}`;
            bins.push({ label: String(day), sum: agg.byDate.get(iso) ?? 0, isToday: iso === todayIso, key: iso });
        }
        return finishTrend(bins, "Тренд по дням", false, todayIso);
    }

    // year / all → по месяцам
    const showYear = mode === "all";
    const [fy, fm] = range.from.split("-").map(Number);
    const [ty, tm] = range.to.split("-").map(Number);
    let y = fy, m = fm; // m = 1..12
    while (y < ty || (y === ty && m <= tm)) {
        const ym = `${y}-${pad2(m)}`;
        let sum = 0;
        for (const [iso, v] of agg.byDate) if (iso.startsWith(ym)) sum += v;
        const label = showYear ? `${MONTHS_SHORT[m - 1]} '${String(y).slice(2)}` : MONTHS_SHORT[m - 1];
        bins.push({ label, sum, isToday: ym === todayYM, key: ym });
        m++; if (m > 12) { m = 1; y++; }
    }
    return finishTrend(bins, "Тренд по месяцам", true, todayIso);
}

function finishTrend(bins: TrendBin[], title: string, byMonth: boolean, todayIso: string): Trend {
    const todayKey = byMonth ? todayIso.slice(0, 7) : todayIso;
    const elapsed = Math.max(1, bins.filter(b => b.key <= todayKey).length);
    const total = bins.reduce((s, b) => s + b.sum, 0);
    const max = bins.reduce((mx, b) => Math.max(mx, b.sum), 0) || 1;
    return { title, bins, avg: total / elapsed, max, byMonth };
}

/** Индексы тиков оси X: Месяц → 5, Год/Всё → до 6 (равномерно). */
export function axisTickIndices(n: number, mode: Mode): number[] {
    if (n <= 1) return [0];
    const count = mode === "month" ? Math.min(5, n) : Math.min(6, n);
    const picks: number[] = [];
    for (let i = 0; i < count; i++) picks.push(Math.round((n - 1) * (i / (count - 1))));
    return [...new Set(picks)];
}
