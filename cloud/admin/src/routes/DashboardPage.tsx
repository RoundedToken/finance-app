import { useState } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { Link } from "@tanstack/react-router";
import { Wallet, TrendingDown, TrendingUp, PiggyBank, Clock, AlertCircle, Info, RefreshCw } from "lucide-react";
import { useDashboard, useGoals } from "@/api/queries";
import { Currency } from "@/components/Currency";
import { formatAmount, cn } from "@/lib/utils";
import type { DashboardResponse, NetWorthPoint, DashboardBucket, Goal } from "@/api/types";

/**
 * Stage 8 (SPEC-013). Дашборд: блок «Сейчас» (5 KPI, фильтры не трогают) +
 * блок «История за период» (период-пресеты + графики на ECharts).
 *
 * Матрица фильтров: период → все графики (серверный диапазон); форма счёта →
 * только график net worth; категория → только donut расходов.
 */

// ── Date helpers для пресетов периода (local time, YYYY-MM-DD) ─────────────
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayIso = () => iso(new Date());
function startOfMonthMinus(monthsBack: number): string {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - monthsBack);
    return iso(d);
}

type Preset = "12m" | "6m" | "year" | "all" | "custom";
const PRESETS: { key: Preset; label: string }[] = [
    { key: "12m", label: "12 мес" },
    { key: "6m", label: "6 мес" },
    { key: "year", label: "Год" },
    { key: "all", label: "Всё" },
    { key: "custom", label: "Период" },
];
function presetRange(p: Preset, cf: string, ct: string): { from?: string; to?: string } {
    const today = todayIso();
    switch (p) {
        case "12m": return { from: startOfMonthMinus(11), to: today };
        case "6m": return { from: startOfMonthMinus(5), to: today };
        case "year": return { from: `${new Date().getFullYear()}-01-01`, to: today };
        case "all": return { from: "2000-01-01", to: today };
        case "custom": return { from: cf || undefined, to: ct || today };
    }
}

const MON = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const monthLabel = (ym: string) => { const [y, m] = ym.split("-"); return `${MON[+m - 1]} ’${y.slice(2)}`; };
const addMonthYm = (ym: string, d: number) => { const [y, m] = ym.split("-").map(Number); const dt = new Date(Date.UTC(y, m - 1 + d, 1)); return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}`; };
const fmtMonthYear = (ym: string) => { const [y, m] = ym.split("-"); return `${MON[+m - 1]} ${y}`; };
const monthDiff = (fromYm: string, toYm: string) => { const [fy, fm] = fromYm.split("-").map(Number); const [ty, tm] = toYm.split("-").map(Number); return (ty - fy) * 12 + (tm - fm); };

// ── Палитра + маппинги форм ─────────────────────────────────────────────────
const PALETTE = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16"];
const FORM_LABEL: Record<string, string> = { cash: "Наличные", digital: "Цифровые", crypto: "Крипто", external: "Внешние" };
const FORM_COLOR: Record<string, string> = { cash: "#f59e0b", digital: "#3b82f6", crypto: "#8b5cf6", external: "#94a3b8" };

/** Цвета из текущей темы (HSL-vars). Читаем на каждый рендер — переживает смену темы. */
function chartTheme() {
    const cs = getComputedStyle(document.documentElement);
    const hsl = (name: string) => {
        const parts = cs.getPropertyValue(name).trim().split(/\s+/);
        return parts.length >= 3 ? `hsl(${parts[0]}, ${parts[1]}, ${parts[2]})` : parts.join(" ");
    };
    return {
        fg: hsl("--foreground"), muted: hsl("--muted-foreground"), border: hsl("--border"),
        positive: hsl("--positive"), negative: hsl("--negative"),
    };
}

const eur = (v: number) => `${formatAmount(v, "EUR")} €`;
const compact = (v: number) => {
    if (Math.abs(v) < 1000) return String(Math.round(v));
    const k = v / 1000;
    return `${Math.abs(k) < 10 ? k.toFixed(1) : Math.round(k)}k`;   // 1500→1.5k, 12345→12k
};

// ── Page ─────────────────────────────────────────────────────────────────────

export function DashboardPage() {
    const [preset, setPreset] = useState<Preset>("12m");
    const [cf, setCf] = useState<string>(startOfMonthMinus(11));
    const [ct, setCt] = useState<string>(todayIso());
    const range = presetRange(preset, cf, ct);
    const { data, isLoading, isError, refetch, isFetching } = useDashboard(range);

    const [lens, setLens] = useState<Lens>("free");               // SPEC-015: дефолт — свободные деньги
    const [nwMode, setNwMode] = useState<"total" | "form" | "currency">("total");
    const [forms, setForms] = useState<Set<string>>(new Set());   // пусто = все
    const [cats, setCats] = useState<Set<string>>(new Set());     // пусто = все

    return (
        <div className="space-y-8">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-semibold tracking-tight">Дашборд</h1>
                    <p className="text-muted-foreground mt-1">
                        Сводка в EUR-эквиваленте. Курсы date-aware (по дате операции).
                        {data?.rates_date && <span className="ml-1">Последний курс: {data.rates_date}.</span>}
                    </p>
                </div>
                <button onClick={() => refetch()} className="btn-ghost self-start" title="Обновить" aria-label="Обновить">
                    <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
                </button>
            </div>

            {isError ? (
                <ErrorState onRetry={() => refetch()} />
            ) : (
                <>
                    {/* Баннеры */}
                    {data && data.kpi.buckets_without_baseline > 0 && <NoBaselineBanner n={data.kpi.buckets_without_baseline} />}

                    {/* Блок «Сейчас» — KPI, фильтры не трогают */}
                    <section className="space-y-3">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                            <SectionTitle>Сейчас</SectionTitle>
                            <LensToggle lens={lens} setLens={setLens} />
                        </div>
                        {isLoading || !data ? <KpiSkeleton /> : <KpiRow data={data} lens={lens} />}
                    </section>

                    {/* Блок «История за период» — графики + фильтры */}
                    <section className="space-y-4">
                        <div className="flex flex-wrap items-end justify-between gap-3">
                            <SectionTitle>История за период</SectionTitle>
                            <div className="flex items-center gap-2">
                                {data && data.kpi.missing_rates > 0 && (
                                    <span className="text-xs text-amber-600 dark:text-amber-400 inline-flex items-center gap-1" title="операции без курса на дату — исключены из EUR-сумм">
                                        <Info className="h-3 w-3" /> {data.kpi.missing_rates} без курса
                                    </span>
                                )}
                                <PeriodPresets preset={preset} setPreset={setPreset} cf={cf} ct={ct} setCf={setCf} setCt={setCt} />
                            </div>
                        </div>

                        {isLoading || !data ? <ChartsSkeleton /> : (
                            <>
                                {/* Net worth over time */}
                                <div className="card p-5">
                                    <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                                        <h3 className="font-medium">Net worth по времени</h3>
                                        <div className="flex items-center gap-2">
                                            <Segmented
                                                options={[["total", "Всего"], ["form", "Форма"], ["currency", "Валюта"]]}
                                                value={nwMode}
                                                onChange={v => setNwMode(v as typeof nwMode)}
                                            />
                                        </div>
                                    </div>
                                    {nwMode !== "currency" && (
                                        <FormFilter buckets={data.buckets} forms={forms} setForms={setForms} />
                                    )}
                                    <NetWorthChart data={data} mode={nwMode} forms={forms} lens={lens}
                                        project projectRate={(lens === "free" ? data.kpi.monthly_income_free_eur : data.kpi.monthly_income_eur) - data.kpi.monthly_burn_eur} />
                                </div>

                                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                                    {/* Income vs expenses */}
                                    <div className="card p-5">
                                        <h3 className="font-medium mb-3">Доходы vs Расходы</h3>
                                        <CashflowChart data={data} lens={lens} />
                                    </div>
                                    {/* Expenses by category */}
                                    <div className="card p-5">
                                        <div className="flex items-center justify-between mb-3">
                                            <h3 className="font-medium">Расходы по категориям</h3>
                                        </div>
                                        <CategoryDonut data={data} cats={cats} setCats={setCats} />
                                    </div>
                                </div>
                            </>
                        )}
                    </section>

                    {/* Цели — прогноз достижения (SPEC-015) */}
                    {!isLoading && data && (
                        <GoalsForecastSection monthlySavings={data.kpi.monthly_income_free_eur - data.kpi.monthly_burn_eur} />
                    )}
                </>
            )}
        </div>
    );
}

// ── KPI ───────────────────────────────────────────────────────────────────────

/** Линза дашборда (SPEC-015): «свободные деньги» (без целевых фондов) или «всё». */
type Lens = "free" | "total";

const pct = (x: number) => `${Math.round(x * 100)}%`;

function KpiRow({ data, lens }: { data: DashboardResponse; lens: Lens }) {
    const k = data.kpi;
    const free = lens === "free";
    const t = chartTheme();
    const hasGoals = k.targeted_eur > 0.005;

    // Цвет spark = цвет Δ-бейджа: считается по тем же cur/prev (3-мес окно), чтобы KPI
    // читался как ОДИН сигнал «хорошо/плохо» — нет конфликта между линией и бейджем.
    // goodUp=true — вверх хорошо (Net worth / Доход / Норма / Runway);
    // goodUp=false — вниз хорошо (Траты).
    const sparkTone = (cur: number | null, prev: number | null | undefined, goodUp: boolean): string => {
        if (cur == null || prev == null || !isFinite(prev) || Math.abs(prev) < 0.005) return t.muted;
        const rel = (cur - prev) / Math.abs(prev);
        if (Math.abs(rel) < 0.005) return t.muted;
        const good = goodUp ? cur > prev : cur < prev;
        return good ? t.positive : t.negative;
    };

    // Значения по линзе (free = без целевых фондов / без goal-доходов)
    const nw = free ? k.free_net_worth_eur : k.net_worth_eur;
    const prevNw = free ? k.prev_free_net_worth_eur : k.prev_net_worth_eur;
    const inc = free ? k.monthly_income_free_eur : k.monthly_income_eur;
    const prevInc = free ? k.prev_monthly_income_free_eur : k.prev_monthly_income_eur;
    const sr = free ? k.savings_rate_free : k.savings_rate;
    const prevSr = prevInc > 0 ? (prevInc - k.prev_monthly_burn_eur) / prevInc : null;
    const rw = free ? k.runway_months : k.runway_months_total;
    const prevRw = k.prev_monthly_burn_eur > 0 ? Math.max(0, prevNw) / k.prev_monthly_burn_eur : null;

    // Спарклайны из существующих series. free net worth ≈ total − текущее
    // targeted (форма тренда сохраняется; историч. goal balance не реконструируем).
    const nwSpark = data.net_worth_series.map(p => (free ? Math.max(0, p.total_eur - k.targeted_eur) : p.total_eur));
    const incSpark = data.cashflow_series.map(p => (free ? p.income_free_eur : p.income_eur));
    const burnSpark = data.cashflow_series.map(p => p.expense_eur);
    const srSpark = data.cashflow_series.map(p => {
        const i = free ? p.income_free_eur : p.income_eur;
        return i > 0 ? (i - p.expense_eur) / i : 0;
    });

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
            <KpiCard icon={Wallet} label="Net worth" value={eur(nw)} negative={nw < 0}
                delta={<DeltaBadge cur={nw} prev={prevNw} />}
                spark={<Sparkline values={nwSpark} color={sparkTone(nw, prevNw, true)} />}
                sub={free ? "свободно, без целевых фондов" : "всё, включая целевые фонды"}>
                {hasGoals && (
                    <div className="mt-2 space-y-0.5 text-xs">
                        {free
                            ? <Row label="Всего" value={eur(k.net_worth_eur)} />
                            : <Row label="Свободно" value={eur(k.free_net_worth_eur)} danger={k.free_net_worth_eur < 0} />}
                        <Row label="Целевые фонды" value={eur(k.targeted_eur)} />
                    </div>
                )}
            </KpiCard>

            <KpiCard icon={TrendingDown} label="Траты / мес" value={eur(k.monthly_burn_eur)}
                delta={<DeltaBadge cur={k.monthly_burn_eur} prev={k.prev_monthly_burn_eur} goodUp={false} />}
                spark={<Sparkline values={burnSpark} color={sparkTone(k.monthly_burn_eur, k.prev_monthly_burn_eur, false)} inProgressTail={1} />}
                sub={`все траты, ср. за ${k.burn_window_months} полных мес`} />

            <KpiCard icon={TrendingUp} label="Доход / мес" value={eur(inc)}
                delta={<DeltaBadge cur={inc} prev={prevInc} />}
                spark={<Sparkline values={incSpark} color={sparkTone(inc, prevInc, true)} inProgressTail={1} />}
                sub={free ? `свободный доход, ср. за ${k.burn_window_months} полных мес` : `весь доход, ср. за ${k.burn_window_months} полных мес`} />

            <KpiCard icon={PiggyBank} label="Норма сбережений" value={sr == null ? "—" : pct(sr)}
                positive={(sr ?? 0) > 0} negative={(sr ?? 1) < 0}
                delta={sr != null && prevSr != null ? <DeltaBadge cur={sr} prev={prevSr} unit="pp" /> : null}
                spark={<Sparkline values={srSpark} color={sparkTone(sr, prevSr, true)} inProgressTail={1} />}
                sub={free ? "из свободного дохода" : "из всего дохода"} />

            <KpiCard icon={Clock} label="Runway" value={rw == null ? "∞" : `${rw.toFixed(1)} мес`}
                delta={rw != null && prevRw != null ? <DeltaBadge cur={rw} prev={prevRw} /> : null}
                spark={<Sparkline values={nwSpark} color={sparkTone(rw, prevRw, true)} />}
                sub={free ? "без целевых фондов" : "со всеми фондами"} />
        </div>
    );
}

interface KpiCardProps { icon: typeof Wallet; label: string; value: React.ReactNode; sub?: string; positive?: boolean; negative?: boolean; delta?: React.ReactNode; spark?: React.ReactNode; children?: React.ReactNode; }
function KpiCard({ icon: Icon, label, value, sub, positive, negative, delta, spark, children }: KpiCardProps) {
    return (
        <div className="card p-5">
            <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{label}</span>
                <Icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="mt-2 flex items-baseline gap-2 flex-wrap">
                <span className={cn("text-2xl font-semibold tracking-tight num", positive && "text-positive", negative && "text-destructive")}>{value}</span>
                {delta}
            </div>
            {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
            {spark && <div className="mt-2">{spark}</div>}
            {children}
        </div>
    );
}

function Row({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
    return (
        <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{label}</span>
            <span className={cn("num tabular-nums", danger && "text-destructive")}>{value}</span>
        </div>
    );
}

/** Мини-тренд в KPI-карточке — без осей, из существующих series. */
function Sparkline({ values, color, inProgressTail = 0 }: { values: number[]; color: string; inProgressTail?: number }) {
    if (values.length < 2) return null;
    // values без Math.round — дробные KPI (норма) иначе теряют вариацию (0.27 → 0).
    // inProgressTail — сколько последних точек считать «неполными» (для потоков
    // Траты / Доход / Норма последний месяц = текущий, в Δ-бейдж не входит).
    // Пунктир здесь означает «происходит сейчас, к этому идём; через месяц
    // отразится в Δ» — согласовано с пользователем 2026-05-28. На большом
    // графике Net worth пунктир по-прежнему означает forecast — разные
    // контексты, не путать.
    const last = values.length - 1;
    const cut = Math.max(0, last - inProgressTail);
    const fullData = values.map((v, i) => (i <= cut ? v : null));
    const tailData = values.map((v, i) => (i >= cut ? v : null));
    const option: EChartsOption = {
        backgroundColor: "transparent",
        grid: { left: 2, right: 2, top: 3, bottom: 3 },
        xAxis: { type: "category", show: false, data: values.map((_, i) => i) },
        yAxis: { type: "value", show: false, scale: true },
        tooltip: { show: false },
        series: inProgressTail > 0 ? [
            { type: "line", data: fullData, showSymbol: false, smooth: true,
              lineStyle: { width: 1.5, color }, areaStyle: { opacity: 0.1, color } },
            { type: "line", data: tailData, showSymbol: false, smooth: true,
              lineStyle: { width: 1.5, color, type: "dashed" }, areaStyle: { opacity: 0.04, color } },
        ] : [
            { type: "line", data: values, showSymbol: false, smooth: true,
              lineStyle: { width: 1.5, color }, areaStyle: { opacity: 0.1, color } },
        ],
    };
    return <ReactECharts option={option} style={{ height: 34, width: "100%" }} notMerge />;
}

/** Δ к предыдущему окну. unit="rel" — относительный %, "pp" — процентные пункты (для нормы). */
function DeltaBadge({ cur, prev, goodUp = true, unit = "rel" }: { cur: number; prev: number; goodUp?: boolean; unit?: "rel" | "pp" }) {
    if (!isFinite(prev) || Math.abs(prev) < 0.005) return null;        // нет базы — скрываем
    const diff = unit === "pp" ? cur - prev : (cur - prev) / Math.abs(prev);
    if (Math.abs(diff) < 0.005) return null;
    const text = unit === "pp" ? `${diff >= 0 ? "+" : ""}${Math.round(diff * 100)} п.п.` : `${diff >= 0 ? "+" : ""}${Math.round(diff * 100)}%`;
    const good = goodUp ? diff > 0 : diff < 0;
    const Icon = diff > 0 ? TrendingUp : TrendingDown;
    return (
        <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium", good ? "text-positive" : "text-destructive")} title="к предыдущему периоду">
            <Icon className="h-3 w-3" /> {text}
        </span>
    );
}

function LensToggle({ lens, setLens }: { lens: Lens; setLens: (l: Lens) => void }) {
    return <Segmented options={[["free", "Свободные"], ["total", "Со всеми фондами"]]} value={lens} onChange={v => setLens(v as Lens)} />;
}

// ── Charts ──────────────────────────────────────────────────────────────────

const sumBuckets = (p: NetWorthPoint, ids: string[]) => ids.reduce((s, id) => s + (p.by_bucket[id] ?? 0), 0);

function NetWorthChart({ data, mode, forms, lens, project = false, projectRate = 0 }: {
    data: DashboardResponse; mode: "total" | "form" | "currency"; forms: Set<string>; lens: Lens;
    project?: boolean; projectRate?: number;
}) {
    const t = chartTheme();
    const histMonths = data.net_worth_series.map(p => p.month);
    if (histMonths.length === 0 || data.net_worth_series.every(p => p.total_eur === 0)) {
        return <EmptyChart label="Нет данных за период" />;
    }
    // в режиме currency фильтр формы не применяем (ortho-измерение)
    const selected = data.buckets.filter(b => mode === "currency" || forms.size === 0 || forms.has(b.form));

    // Проекция — только для линии total: пунктир на projectMonths вперёд по темпу.
    const doProject = mode === "total" && project && histMonths.length > 0;
    // Длина проекции — ~четверть истории, [2..6] мес (вдвое короче прежнего:
    // длинный пунктир тянул верх оси вверх и поджимал наглядность истории net worth).
    const projMonths = Math.min(6, Math.max(2, Math.round(histMonths.length / 4)));
    const futureMonths: string[] = [];
    if (doProject) {
        let ym = histMonths[histMonths.length - 1];
        for (let i = 0; i < projMonths; i++) { ym = addMonthYm(ym, 1); futureMonths.push(ym); }
    }
    const months = [...histMonths, ...futureMonths];

    let series: EChartsOption["series"];
    if (mode === "total") {
        const ids = selected.map(b => b.id);
        // SPEC-018: линза «Свободные» вычитает текущее targeted_eur (аппроксимация —
        // историч. goal balance не реконструируем). Применяется только когда форма-
        // фильтр не активен — иначе сдвиг искажает разбивку по выбранным вёдрам.
        const shift = lens === "free" && forms.size === 0 ? data.kpi.targeted_eur : 0;
        const hist = data.net_worth_series.map(p => Math.max(0, Math.round(sumBuckets(p, ids) - shift)));
        series = [{
            name: "Net worth", type: "line", smooth: true, showSymbol: false,
            lineStyle: { width: 2.5 }, color: t.positive,   // линия без заливки: с non-zero базой заливка-от-нуля врёт о магнитуде
            data: [...hist, ...Array(futureMonths.length).fill(null)],
        }];
        if (doProject && hist.length > 0) {
            const last = hist[hist.length - 1] ?? 0;
            const proj: (number | null)[] = Array(Math.max(0, hist.length - 1)).fill(null);
            proj.push(last);   // стыкуем пунктир с последней фактической точкой
            for (let i = 1; i <= futureMonths.length; i++) proj.push(Math.round(last + projectRate * i));
            series.push({
                name: "Прогноз", type: "line", smooth: false, showSymbol: false,
                lineStyle: { width: 2, type: "dashed", color: t.muted }, color: t.muted, data: proj,
            });
        }
    } else {
        const groups = new Map<string, { label: string; color: string; ids: string[] }>();
        selected.forEach((b, i) => {
            const key = mode === "form" ? b.form : b.currency;
            if (!groups.has(key)) {
                groups.set(key, {
                    label: mode === "form" ? (FORM_LABEL[key] ?? key) : key,
                    color: mode === "form" ? (FORM_COLOR[key] ?? PALETTE[i % PALETTE.length]) : PALETTE[groups.size % PALETTE.length],
                    ids: [],
                });
            }
            groups.get(key)!.ids.push(b.id);
        });
        series = [...groups.values()].map(g => ({
            name: g.label, type: "line", stack: "nw", smooth: true, showSymbol: false,
            areaStyle: { opacity: 0.35 }, lineStyle: { width: 1 }, color: g.color,
            data: data.net_worth_series.map(p => Math.round(sumBuckets(p, g.ids))),
        }));
    }

    const showLegend = mode !== "total" || doProject;
    const option: EChartsOption = {
        backgroundColor: "transparent",
        grid: { left: 8, right: 12, top: showLegend ? 36 : 16, bottom: 4, containLabel: true },
        legend: showLegend ? { top: 0, textStyle: { color: t.muted }, icon: "roundRect" } : undefined,
        tooltip: { trigger: "axis", valueFormatter: (v) => (v == null ? "—" : eur(Number(v))) },
        xAxis: { type: "category", data: months, axisLabel: { color: t.muted, formatter: monthLabel }, axisLine: { lineStyle: { color: t.border } }, axisTick: { show: false } },
        // total — линия значения-во-времени: scale=true (база не от нуля, автозум к
        // данным, как в KPI-спарклайне) → перепад net worth читается. Стэк-режимы
        // (форма/валюта) — zero-baseline, иначе стэк-площади врут о магнитуде.
        yAxis: { type: "value", scale: mode === "total", axisLabel: { color: t.muted, formatter: (v: number) => compact(v) }, splitLine: { lineStyle: { color: t.border, opacity: 0.5 } } },
        series,
    };
    return <ReactECharts option={option} style={{ height: 320 }} notMerge />;
}

function CashflowChart({ data, lens }: { data: DashboardResponse; lens: Lens }) {
    const t = chartTheme();
    const free = lens === "free";
    const months = data.cashflow_series.map(p => p.month);
    if (!data.cashflow_series.some(p => p.income_eur > 0 || p.expense_eur > 0)) return <EmptyChart />;
    const option: EChartsOption = {
        backgroundColor: "transparent",
        grid: { left: 8, right: 12, top: 28, bottom: 4, containLabel: true },
        legend: { top: 0, textStyle: { color: t.muted }, icon: "roundRect" },
        tooltip: { trigger: "axis", valueFormatter: (v) => eur(Number(v)) },
        xAxis: { type: "category", data: months, axisLabel: { color: t.muted, formatter: monthLabel }, axisLine: { lineStyle: { color: t.border } }, axisTick: { show: false } },
        yAxis: { type: "value", axisLabel: { color: t.muted, formatter: (v: number) => compact(v) }, splitLine: { lineStyle: { color: t.border, opacity: 0.5 } } },
        series: [
            { name: free ? "Свободный доход" : "Доход", type: "bar", color: t.positive,
              data: data.cashflow_series.map(p => Math.round(free ? p.income_free_eur : p.income_eur)) },
            { name: "Расход", type: "bar", color: t.negative, data: data.cashflow_series.map(p => Math.round(p.expense_eur)) },
        ],
    };
    return <ReactECharts option={option} style={{ height: 300 }} notMerge />;
}

function CategoryDonut({ data, cats, setCats }: { data: DashboardResponse; cats: Set<string>; setCats: (s: Set<string>) => void }) {
    const t = chartTheme();
    const all = data.expenses_by_category;
    const slices = cats.size === 0 ? all : all.filter(s => cats.has(s.category_id));
    const toggle = (id: string) => { const next = new Set(cats); next.has(id) ? next.delete(id) : next.add(id); setCats(next); };
    // D6: при активном фильтре доли пересчитываются от суммы выбранных категорий.
    const activeSum = slices.reduce((s, x) => s + x.total_eur, 0);
    const shareOf = (s: typeof all[number]) => (cats.size === 0 ? s.share : activeSum > 0 ? s.total_eur / activeSum : 0);

    if (all.length === 0) return <EmptyChart label="Нет расходов за период" />;

    const option: EChartsOption = {
        backgroundColor: "transparent",
        tooltip: { trigger: "item", valueFormatter: (v) => eur(Number(v)) },
        series: [{
            type: "pie", radius: ["52%", "78%"], center: ["50%", "50%"], avoidLabelOverlap: true,
            itemStyle: { borderColor: "transparent", borderWidth: 1 },
            label: { show: false }, labelLine: { show: false },
            data: slices.map((s, i) => ({ name: `${s.emoji ?? ""} ${s.name}`.trim(), value: Math.round(s.total_eur), itemStyle: { color: s.color ?? PALETTE[i % PALETTE.length] } })),
        }],
    };
    return (
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 items-center">
            <ReactECharts option={option} style={{ height: 260 }} notMerge />
            <div className="flex flex-col gap-1 max-h-64 overflow-y-auto pr-1 text-sm">
                {all.map((s, i) => {
                    const on = cats.size === 0 || cats.has(s.category_id);
                    return (
                        <button key={s.category_id} onClick={() => toggle(s.category_id)}
                            className={cn("flex items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-accent/50", !on && "opacity-35")}>
                            <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: s.color ?? PALETTE[i % PALETTE.length] }} />
                            <span className="truncate">{s.emoji} {s.name}</span>
                            <span className="ml-auto num tabular-nums text-muted-foreground">{on ? `${Math.round(shareOf(s) * 100)}%` : ""}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

// ── Filters / controls ──────────────────────────────────────────────────────

function PeriodPresets({ preset, setPreset, cf, ct, setCf, setCt }: {
    preset: Preset; setPreset: (p: Preset) => void; cf: string; ct: string; setCf: (s: string) => void; setCt: (s: string) => void;
}) {
    return (
        <div className="flex flex-col items-end gap-2">
            <div className="inline-flex gap-1 p-1 bg-secondary/60 rounded-xl">
                {PRESETS.map(p => (
                    <button key={p.key} type="button" aria-pressed={preset === p.key} onClick={() => setPreset(p.key)}
                        className={cn("py-1.5 px-3 rounded-lg text-xs font-medium transition-colors",
                            preset === p.key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-accent/40 hover:text-foreground")}>
                        {p.label}
                    </button>
                ))}
            </div>
            {preset === "custom" && (
                <div className="flex items-center gap-2">
                    <input type="date" value={cf} max={ct} onChange={e => setCf(e.target.value)}
                        className="px-2 py-1 rounded-lg border bg-background text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring" />
                    <span className="text-muted-foreground text-sm">–</span>
                    <input type="date" value={ct} min={cf} max={todayIso()} onChange={e => setCt(e.target.value)}
                        className="px-2 py-1 rounded-lg border bg-background text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
            )}
        </div>
    );
}

function FormFilter({ buckets, forms, setForms }: { buckets: DashboardBucket[]; forms: Set<string>; setForms: (s: Set<string>) => void }) {
    const available = [...new Set(buckets.map(b => b.form))];
    if (available.length <= 1) return null;
    const toggle = (f: string) => { const next = new Set(forms); next.has(f) ? next.delete(f) : next.add(f); setForms(next); };
    return (
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
            <span className="text-xs text-muted-foreground mr-1">Форма:</span>
            {available.map(f => {
                const on = forms.size === 0 || forms.has(f);
                return (
                    <button key={f} onClick={() => toggle(f)}
                        className={cn("text-xs px-2 py-0.5 rounded-full border transition-colors", on ? "border-primary/50 bg-primary/10 text-foreground" : "border-border text-muted-foreground opacity-60")}>
                        {FORM_LABEL[f] ?? f}
                    </button>
                );
            })}
            {forms.size > 0 && <button onClick={() => setForms(new Set())} className="text-xs text-muted-foreground underline ml-1">сброс</button>}
        </div>
    );
}

function Segmented({ options, value, onChange }: { options: [string, string][]; value: string; onChange: (v: string) => void }) {
    return (
        <div className="inline-flex gap-1 p-1 bg-secondary/60 rounded-xl">
            {options.map(([key, label]) => (
                <button key={key} type="button" aria-pressed={value === key} onClick={() => onChange(key)}
                    className={cn("py-1 px-2.5 rounded-lg text-xs font-medium transition-colors",
                        value === key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-accent/40 hover:text-foreground")}>
                    {label}
                </button>
            ))}
        </div>
    );
}

// ── Goals forecast (SPEC-015) ────────────────────────────────────────────────

function GoalsForecastSection({ monthlySavings }: { monthlySavings: number }) {
    const { data: goalsData } = useGoals("active");
    const goals = goalsData?.goals ?? [];
    if (goals.length === 0) return null;
    return (
        <section className="space-y-3">
            <SectionTitle>Цели — прогноз достижения</SectionTitle>
            <p className="text-xs text-muted-foreground -mt-1">
                Прогноз по текущему темпу свободных сбережений (доход − траты). Линейная оценка, не гарантия.
                {goals.length > 1 && " ETA каждой цели — при условии, что весь свободный поток идёт в неё; несколько активных целей делят один поток, реальные сроки дальше."}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {goals.map(g => <GoalForecastCard key={g.id} goal={g} monthlySavings={monthlySavings} />)}
            </div>
        </section>
    );
}

function GoalForecastCard({ goal, monthlySavings }: { goal: Goal; monthlySavings: number }) {
    const ccy = goal.target_currency;
    const hasTarget = goal.target_amount != null && goal.target_amount > 0;
    const reached = hasTarget && goal.balance >= goal.target_amount!;
    // SPEC-017: остаток до цели в EUR — из worker-полей (mark-to-market today,
    // ADR-014), без клиентской конверсии по latest-курсу.
    const remainingEur = hasTarget && goal.target_amount_eur != null && goal.balance_eur != null
        ? Math.max(0, goal.target_amount_eur - goal.balance_eur) : null;
    const months = remainingEur != null && monthlySavings > 0 ? remainingEur / monthlySavings : null;
    const etaYm = months != null ? addMonthYm(todayIso().slice(0, 7), Math.ceil(months)) : null;
    const deadlineYm = goal.deadline ? goal.deadline.slice(0, 7) : null;
    const late = !!(etaYm && deadlineYm && etaYm > deadlineYm);
    const monthsLate = etaYm && deadlineYm && late ? monthDiff(deadlineYm, etaYm) : 0;
    const color = goal.color ?? "#94a3b8";
    const pctDone = hasTarget ? Math.min(100, (goal.balance / goal.target_amount!) * 100) : null;

    return (
        <div className="card p-4">
            <div className="flex items-center gap-3">
                <span className="h-9 w-9 rounded-xl grid place-items-center text-lg shrink-0" style={{ background: color + "22", color }}>{goal.emoji ?? "🎯"}</span>
                <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{goal.name}</div>
                    <div className="text-xs text-muted-foreground tabular-nums">
                        {hasTarget
                            ? <>{formatAmount(goal.balance, ccy ?? "")} / {formatAmount(goal.target_amount!, ccy ?? "")} {ccy}{pctDone != null ? ` · ${Math.round(pctDone)}%` : ""}</>
                            : "цель без суммы"}
                    </div>
                </div>
            </div>
            {hasTarget && pctDone != null && (
                <div className="mt-3 h-1.5 rounded-full bg-secondary overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pctDone}%`, background: color }} />
                </div>
            )}
            <div className="mt-3 text-sm">
                {reached ? (
                    <span className="text-positive font-medium">✓ достигнута</span>
                ) : !hasTarget ? (
                    <span className="text-muted-foreground">задай целевую сумму для прогноза</span>
                ) : monthlySavings <= 0 ? (
                    <span className="text-amber-600 dark:text-amber-400">при текущем темпе не достигается (нет свободных сбережений)</span>
                ) : (
                    <div className="space-y-1">
                        <div className="text-muted-foreground">
                            при +{eur(monthlySavings)}/мес → <span className="text-foreground font-medium">{etaYm && fmtMonthYear(etaYm)}</span>
                        </div>
                        {deadlineYm && (
                            <div className={cn("text-xs", late ? "text-destructive" : "text-positive")}>
                                дедлайн {fmtMonthYear(deadlineYm)} · {late ? `⚠ опаздываешь на ~${monthsLate} мес` : "✓ успеваешь"}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

// ── States / misc ─────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
    return <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</h2>;
}

function NoBaselineBanner({ n }: { n: number }) {
    return (
        <div className="card p-4 border-amber-500/50 bg-amber-500/10 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="text-sm">
                <div className="font-medium text-amber-700 dark:text-amber-300">
                    {n === 1 ? "Одно ведро без baseline" : `${n} вёдер без baseline`}
                </div>
                <div className="text-amber-700/80 dark:text-amber-200/80 mt-1">
                    Net worth может быть неполным. Внеси начальные снимки по выписке — <Link to="/snapshots" className="underline">/snapshots</Link>.
                </div>
            </div>
        </div>
    );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
    return (
        <div className="card p-8 text-center space-y-3">
            <AlertCircle className="h-8 w-8 text-destructive mx-auto" />
            <div className="font-medium">Не удалось загрузить дашборд</div>
            <button onClick={onRetry} className="btn-primary mx-auto"><RefreshCw className="h-4 w-4" /> Повторить</button>
        </div>
    );
}

function EmptyChart({ label = "Нет данных за период" }: { label?: string }) {
    return <div className="h-[260px] grid place-items-center text-sm text-muted-foreground">{label}</div>;
}

function KpiSkeleton() {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="card p-6 h-28 animate-pulse bg-muted/40" />)}
        </div>
    );
}

function ChartsSkeleton() {
    return (
        <div className="space-y-4">
            <div className="card h-80 animate-pulse bg-muted/40" />
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="card h-72 animate-pulse bg-muted/40" />
                <div className="card h-72 animate-pulse bg-muted/40" />
            </div>
        </div>
    );
}
