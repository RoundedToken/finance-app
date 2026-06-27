import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { chartTheme } from "@/lib/chart-theme";
import { formatAmount } from "@/lib/utils";
import type { Goal, GoalContribution } from "@/api/types";

/**
 * График прогресса цели (SPEC-037): накопленный баланс цели по месяцам в
 * target_currency + линия target + маркер дедлайна + пунктирный ETA-прогноз.
 *
 * Чисто клиентский расчёт поверх уже загруженных `contributions` (поле
 * `delta_in_target` — вклад в target_currency по курсу даты вклада, ADR-020/SPEC-025).
 * Worker/D1 не задействованы. Пунктир = forecast (memory dashed-line-means-forecast):
 * пунктирная только ETA-линия; target/deadline — тонкие solid-референсы.
 */

const MON = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const pad = (n: number) => String(n).padStart(2, "0");
const ymOf = (iso: string) => iso.slice(0, 7);
const cmpYm = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const monthLabel = (ym: string) => { const [y, m] = ym.split("-"); return `${MON[+m - 1]} ’${y.slice(2)}`; };
const addMonthYm = (ym: string, d: number) => {
    const [y, m] = ym.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1 + d, 1));
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}`;
};
const todayYm = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const compact = (v: number) => {
    const a = Math.abs(v);
    if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(a % 1_000_000 === 0 ? 0 : 1)}M`;
    if (a >= 1_000) return `${(v / 1_000).toFixed(a % 1_000 === 0 ? 0 : 1)}k`;
    return String(Math.round(v));
};

interface Model {
    months: string[];
    actual: (number | null)[];       // накопленный баланс по месяцам (null в будущем)
    target: number | null;
    deadlineYm: string | null;
    eta: (number | null)[] | null;   // пунктир-прогноз, состыкован с фактом
    etaEndYm: string | null;
    rate: number;                    // средний месячный приток (для подписи)
    etaTooFar: boolean;              // темп есть, но цель дальше горизонта → честная подпись без ложной даты
    yMax: number;
    balanceNow: number;
}

const HORIZON_CAP_MONTHS = 120; // 10 лет — дальше ETA не рисуем линию-в-никуда с ложной датой (QA must-fix)

function buildModel(goal: Goal, contributions: GoalContribution[]): Model | null {
    // Бакетируем вклад (delta_in_target) по месяцу; null (нет курса) пропускаем (E8).
    const byMonth = new Map<string, number>();
    for (const c of contributions) {
        if (c.delta_in_target == null) continue;
        const ym = ymOf(c.date);
        byMonth.set(ym, (byMonth.get(ym) ?? 0) + c.delta_in_target);
    }
    if (byMonth.size === 0) return null;

    const withData = [...byMonth.keys()].sort(cmpYm);
    const firstYm = withData[0];
    const lastDataYm = withData[withData.length - 1];
    const histEnd = cmpYm(lastDataYm, todayYm()) >= 0 ? lastDataYm : todayYm();
    const target = goal.target_amount != null && goal.target_amount > 0 ? goal.target_amount : null;
    const deadlineYm = goal.deadline ? ymOf(goal.deadline) : null;

    // Накопленный баланс на конец каждого месяца (forward-fill пустых месяцев).
    const histMonths: string[] = [];
    for (let ym = firstYm; cmpYm(ym, histEnd) <= 0; ym = addMonthYm(ym, 1)) histMonths.push(ym);
    let run = 0;
    const cum = new Map<string, number>();
    for (const ym of histMonths) { run += byMonth.get(ym) ?? 0; cum.set(ym, run); }
    const balanceNow = run; // == goal.balance (R1)

    // ETA: средний приток за последние ≤3 ЗАВЕРШЁННЫХ месяца → линейная экстраполяция.
    // Текущий (неполный) календарный месяц исключаем — иначе его пустота занижает run-rate;
    // завершённые пустые месяцы остаются (реальный спад темпа их учитывает).
    let rate = 0;
    let etaTooFar = false;
    const etaMonths: string[] = [];
    if (target != null && balanceNow < target) {
        const cur = todayYm();
        const complete = histMonths.filter(ym => ym < cur);
        const tail = (complete.length ? complete : histMonths).slice(-3);
        rate = tail.reduce((s, ym) => s + (byMonth.get(ym) ?? 0), 0) / (tail.length || 1);
        if (rate > 0) {
            const n = Math.ceil((target - balanceNow) / rate);
            if (n <= HORIZON_CAP_MONTHS) {
                for (let i = 1; i <= n; i++) etaMonths.push(addMonthYm(histEnd, i));
            } else {
                etaTooFar = true; // цель дальше горизонта — пунктир не доводим до target, подпись без ложной даты
            }
        }
    }
    const etaEndYm = etaMonths.length ? etaMonths[etaMonths.length - 1] : null;

    // Ось X: [min(первый вклад, дедлайн) .. max(histEnd, дедлайн, ETA)] + буфер-месяц справа,
    // чтобы маркер дедлайна/ETA и последняя подпись не упирались в правый край (QA nice-to-have).
    let axisStart = firstYm;
    if (deadlineYm && cmpYm(deadlineYm, axisStart) < 0) axisStart = deadlineYm; // дедлайн раньше первого вклада (E7)
    let axisEnd = histEnd;
    if (deadlineYm && cmpYm(deadlineYm, axisEnd) > 0) axisEnd = deadlineYm;
    if (etaEndYm && cmpYm(etaEndYm, axisEnd) > 0) axisEnd = etaEndYm;
    axisEnd = addMonthYm(axisEnd, 1);
    const months: string[] = [];
    for (let ym = axisStart; cmpYm(ym, axisEnd) <= 0; ym = addMonthYm(ym, 1)) months.push(ym);

    // Факт только в [firstYm..histEnd]; вне (в т.ч. левее первого вклада при раннем дедлайне) — null.
    const actual = months.map(ym =>
        cmpYm(ym, firstYm) >= 0 && cmpYm(ym, histEnd) <= 0 ? Math.round(cum.get(ym) ?? balanceNow) : null);

    let eta: (number | null)[] | null = null;
    if (etaMonths.length && target != null) {
        const etaIdx = new Map(etaMonths.map((ym, i) => [ym, i]));
        eta = months.map(ym => {
            if (ym === histEnd) return Math.round(balanceNow);      // стык с фактом
            const k = etaIdx.get(ym);
            return k == null ? null : Math.min(Math.round(balanceNow + rate * (k + 1)), Math.round(target));
        });
    }

    const yMax = Math.ceil(Math.max(target ?? 0, balanceNow) * 1.08);
    return { months, actual, target, deadlineYm, eta, etaEndYm, rate, etaTooFar, yMax, balanceNow };
}

export function GoalProgressChart({ goal, contributions }: { goal: Goal; contributions: GoalContribution[] }) {
    const ccy = goal.target_currency;
    const model = useMemo(() => buildModel(goal, contributions), [goal, contributions]);

    // Гард (E2/E3): без валюты или без оценимых вкладов карточку не рендерим.
    if (!ccy || !model) return null;

    const t = chartTheme();
    const color = goal.color ?? t.positive;
    const fmt = (v: number) => `${formatAmount(v, ccy)} ${ccy}`;
    const { months, actual, target, deadlineYm, eta, etaEndYm, rate, etaTooFar, yMax } = model;

    // target/deadline — тонкие solid-референсы (НЕ пунктир: пунктир зарезервирован за forecast).
    const markLineData = [
        ...(target != null ? [{ yAxis: target, label: { formatter: `цель ${compact(target)}`, position: "insideEndTop" as const, color: t.muted, fontSize: 10 } }] : []),
        ...(deadlineYm ? [{ xAxis: deadlineYm, label: { formatter: "дедлайн", position: "insideStartTop" as const, color: t.muted, fontSize: 10 } }] : []),
    ];

    let series: EChartsOption["series"] = [
        {
            name: "Накоплено", type: "line", smooth: false,
            showSymbol: actual.filter(v => v != null).length === 1,
            symbolSize: 6, lineStyle: { width: 2.5 }, color,
            areaStyle: { opacity: 0.12, color },
            data: actual,
            markLine: markLineData.length ? {
                silent: true, symbol: "none",
                lineStyle: { color: t.muted, type: "solid", width: 1, opacity: 0.6 },
                data: markLineData,
            } : undefined,
        },
    ];
    if (eta) {
        series.push({
            name: "Прогноз", type: "line", smooth: false, showSymbol: false,
            lineStyle: { width: 2, type: "dashed", color: t.muted }, color: t.muted,
            data: eta,
        });
    }

    const option: EChartsOption = {
        backgroundColor: "transparent",
        grid: { left: 8, right: 18, top: eta ? 30 : 16, bottom: 4, containLabel: true },
        legend: eta ? { top: 0, textStyle: { color: t.muted }, icon: "roundRect", data: ["Накоплено", "Прогноз"] } : undefined,
        tooltip: { trigger: "axis", valueFormatter: v => (v == null ? "—" : fmt(Number(v))) },
        xAxis: {
            type: "category", data: months, boundaryGap: false,
            axisLabel: { color: t.muted, formatter: monthLabel }, axisLine: { lineStyle: { color: t.border } }, axisTick: { show: false },
        },
        yAxis: {
            type: "value", min: 0, max: yMax || undefined,
            axisLabel: { color: t.muted, formatter: (v: number) => compact(v) }, splitLine: { lineStyle: { color: t.border, opacity: 0.5 } },
        },
        series,
    };

    return (
        <div className="card p-5 space-y-2">
            <h2 className="font-medium">Прогресс</h2>
            <ReactECharts option={option} style={{ height: 280 }} notMerge />
            {eta && etaEndYm && (
                <p className="text-xs text-muted-foreground">
                    При текущем темпе ≈ {fmt(Math.round(rate))}/мес — цель к {monthLabel(etaEndYm)}
                    {deadlineYm && (cmpYm(etaEndYm, deadlineYm) <= 0
                        ? <span className="text-positive"> · в срок</span>
                        : <span className="text-destructive"> · позже дедлайна</span>)}
                </p>
            )}
            {etaTooFar && (
                <p className="text-xs text-muted-foreground">
                    При текущем темпе ≈ {fmt(Math.round(rate))}/мес — цель далеко (&gt;{Math.round(HORIZON_CAP_MONTHS / 12)} лет)
                </p>
            )}
        </div>
    );
}
