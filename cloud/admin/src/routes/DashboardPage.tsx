import { useState } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { Link } from "@tanstack/react-router";
import { Wallet, TrendingDown, TrendingUp, PiggyBank, Clock, AlertCircle, Info, RefreshCw } from "lucide-react";
import { useDashboard } from "@/api/queries";
import { Currency } from "@/components/Currency";
import { formatAmount, cn } from "@/lib/utils";
import type { DashboardResponse, NetWorthPoint, DashboardBucket } from "@/api/types";

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
                        <SectionTitle>Сейчас</SectionTitle>
                        {isLoading || !data ? <KpiSkeleton /> : <KpiRow data={data} />}
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
                                    <NetWorthChart data={data} mode={nwMode} forms={forms} />
                                </div>

                                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                                    {/* Income vs expenses */}
                                    <div className="card p-5">
                                        <h3 className="font-medium mb-3">Доходы vs Расходы</h3>
                                        <CashflowChart data={data} />
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
                </>
            )}
        </div>
    );
}

// ── KPI ───────────────────────────────────────────────────────────────────────

function KpiRow({ data }: { data: DashboardResponse }) {
    const k = data.kpi;
    const hasGoals = k.targeted_eur > 0.005;
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
            <KpiCard icon={Wallet} label="Net worth" value={eur(k.net_worth_eur)} negative={k.net_worth_eur < 0}>
                {hasGoals && (
                    <div className="mt-2 space-y-0.5 text-xs">
                        <Row label="Свободно" value={eur(k.free_net_worth_eur)} danger={k.free_net_worth_eur < 0} />
                        <Row label="Целевые фонды" value={eur(k.targeted_eur)} />
                    </div>
                )}
            </KpiCard>
            <KpiCard icon={TrendingDown} label="Траты / мес" value={eur(k.monthly_burn_eur)} sub={`среднее за ${k.burn_window_months} мес`} />
            <KpiCard icon={TrendingUp} label="Доход / мес" value={eur(k.monthly_income_eur)} sub={`среднее за ${k.burn_window_months} мес`} />
            <KpiCard icon={PiggyBank} label="Норма сбережений" value={k.savings_rate == null ? "—" : `${Math.round(k.savings_rate * 100)}%`} sub="доход − траты" positive={(k.savings_rate ?? 0) > 0} negative={(k.savings_rate ?? 1) < 0} />
            <KpiCard icon={Clock} label="Runway" value={k.runway_months == null ? "∞" : `${k.runway_months.toFixed(1)} мес`}
                sub={k.runway_months_total == null ? "по свободным" : `со всеми фондами: ${k.runway_months_total.toFixed(1)} мес`} />
        </div>
    );
}

interface KpiCardProps { icon: typeof Wallet; label: string; value: React.ReactNode; sub?: string; positive?: boolean; negative?: boolean; children?: React.ReactNode; }
function KpiCard({ icon: Icon, label, value, sub, positive, negative, children }: KpiCardProps) {
    return (
        <div className="card p-5">
            <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{label}</span>
                <Icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className={cn("mt-2 text-2xl font-semibold tracking-tight num", positive && "text-positive", negative && "text-destructive")}>{value}</div>
            {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
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

// ── Charts ──────────────────────────────────────────────────────────────────

const sumBuckets = (p: NetWorthPoint, ids: string[]) => ids.reduce((s, id) => s + (p.by_bucket[id] ?? 0), 0);

function NetWorthChart({ data, mode, forms }: { data: DashboardResponse; mode: "total" | "form" | "currency"; forms: Set<string> }) {
    const t = chartTheme();
    const months = data.net_worth_series.map(p => p.month);
    if (months.length === 0 || data.net_worth_series.every(p => p.total_eur === 0)) {
        return <EmptyChart label="Нет данных за период" />;
    }
    // в режиме currency фильтр формы не применяем (ortho-измерение)
    const selected = data.buckets.filter(b => mode === "currency" || forms.size === 0 || forms.has(b.form));

    let series: EChartsOption["series"];
    if (mode === "total") {
        const ids = selected.map(b => b.id);
        series = [{
            name: "Net worth", type: "line", smooth: true, showSymbol: false,
            areaStyle: { opacity: 0.18 }, lineStyle: { width: 2 }, color: t.positive,
            data: data.net_worth_series.map(p => Math.round(sumBuckets(p, ids))),
        }];
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

    const option: EChartsOption = {
        backgroundColor: "transparent",
        grid: { left: 8, right: 12, top: mode === "total" ? 16 : 36, bottom: 4, containLabel: true },
        legend: mode === "total" ? undefined : { top: 0, textStyle: { color: t.muted }, icon: "roundRect" },
        tooltip: { trigger: "axis", valueFormatter: (v) => eur(Number(v)) },
        xAxis: { type: "category", data: months, axisLabel: { color: t.muted, formatter: monthLabel }, axisLine: { lineStyle: { color: t.border } }, axisTick: { show: false } },
        yAxis: { type: "value", axisLabel: { color: t.muted, formatter: (v: number) => compact(v) }, splitLine: { lineStyle: { color: t.border, opacity: 0.5 } } },
        series,
    };
    return <ReactECharts option={option} style={{ height: 320 }} notMerge />;
}

function CashflowChart({ data }: { data: DashboardResponse }) {
    const t = chartTheme();
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
            { name: "Доход", type: "bar", color: t.positive, data: data.cashflow_series.map(p => Math.round(p.income_eur)) },
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
