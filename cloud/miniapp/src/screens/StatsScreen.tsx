import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { useBootstrap, useExpenses } from "@/api/queries";
import { useApp } from "@/store";
import { Amount } from "@/components/Amount";
import { Currency } from "@/components/Currency";
import { Modal } from "@/components/Modal";
import { cn, fmtEur0, pad2, todayISO, humanDay, MONTHS_NOM, plural } from "@/lib/utils";
import { haptic } from "@/lib/telegram";
import {
    type Mode, type Delta,
    CHART_OTHER, filterByPeriod, aggregate, buildPalette, periodRange,
    avgPerDay, computeDelta, buildTrend, axisTickIndices,
} from "@/lib/stats";
import type { Expense, Category } from "@/api/types";

const MODES: { key: Mode; label: string }[] = [
    { key: "month", label: "Месяц" },
    { key: "year", label: "Год" },
    { key: "all", label: "Всё" },
];

/** Предыдущий период для дельты (учёт перехода через год). */
function prevPeriod(mode: Mode, year: number, month: number): { year: number; month: number } {
    if (mode === "year") return { year: year - 1, month };
    return month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 };
}

export function StatsScreen() {
    const { d } = useApp();
    const { data, isLoading, isError, refetch } = useExpenses();
    const boot = useBootstrap();
    const expenses = useMemo(() => data?.expenses ?? [], [data]);
    const cats = boot.data?.categories ?? [];
    const catById = useMemo(() => new Map(cats.map(c => [c.id, c])), [cats]);

    const today = todayISO();
    const curY = Number(today.slice(0, 4));
    const curM = Number(today.slice(5, 7)) - 1;
    const [mode, setMode] = useState<Mode>("month");
    const [year, setYear] = useState(curY);
    const [month, setMonth] = useState(curM);
    const [drill, setDrill] = useState<{ cat: string | null } | null>(null);

    // Границы данных — те же, что в Истории (блокировка навигации, E7).
    const bounds = useMemo(() => {
        if (!expenses.length) return null;
        let min = expenses[0].date;
        for (const e of expenses) if (e.date < min) min = e.date;
        return { minY: Number(min.slice(0, 4)), minYM: min.slice(0, 7) };
    }, [expenses]);

    const filtered = useMemo(() => filterByPeriod(expenses, mode, year, month), [expenses, mode, year, month]);
    const agg = useMemo(() => aggregate(filtered), [filtered]);
    const palette = useMemo(() => buildPalette(agg.byCat), [agg.byCat]);
    const range = useMemo(() => periodRange(mode, year, month, expenses, today), [mode, year, month, expenses, today]);

    const prevTotal = useMemo(() => {
        if (mode === "all") return null;
        const p = prevPeriod(mode, year, month);
        return aggregate(filterByPeriod(expenses, mode, p.year, p.month)).total;
    }, [mode, year, month, expenses]);

    const avg = useMemo(() => avgPerDay(agg.total, range, today), [agg.total, range, today]);
    const delta = useMemo(() => computeDelta(agg.total, prevTotal), [agg.total, prevTotal]);
    const trend = useMemo(() => buildTrend(agg, mode, range, today), [agg, mode, range, today]);

    // Навигация по периоду + границы (зеркало Истории SPEC-035).
    const ymCur = `${year}-${pad2(month + 1)}`;
    const prevDisabled = !bounds || (mode === "month" ? ymCur <= bounds.minYM : mode === "year" ? year <= bounds.minY : true);
    const nextDisabled = !bounds || (mode === "month" ? ymCur >= today.slice(0, 7) : mode === "year" ? year >= curY : true);

    const scrollTop = () => window.scrollTo(0, 0);
    const step = (delta: number) => {
        haptic("light");
        if (mode === "month") {
            let m = month + delta, y = year;
            while (m < 0) { m += 12; y -= 1; }
            while (m > 11) { m -= 12; y += 1; }
            setYear(y); setMonth(m);
        } else if (mode === "year") {
            setYear(year + delta);
        }
        scrollTop();
    };
    const pickMode = (next: Mode) => {
        haptic("light");
        if (next !== "all") {
            const y = mode === "all" ? curY : year;
            setYear(y);
            if (next === "month") setMonth(y === curY ? curM : 11);
        }
        setMode(next);
        scrollTop();
    };

    const periodLabel = mode === "month" ? `${MONTHS_NOM[month]} ${year}` : mode === "year" ? `${year}` : "Всё время";
    const openDrill = (cat: string | null) => { haptic("light"); setDrill({ cat }); };

    return (
        <div className="min-h-screen">
            <div className="sticky top-0 z-20 bg-bg/95 backdrop-blur px-4 pt-3 pb-2 space-y-2.5">
                <div className="flex items-center gap-2">
                    <button aria-label="Назад" onClick={() => { haptic("light"); d({ t: "screen", v: "main" }); }}
                        className="h-9 w-9 grid place-items-center rounded-full -ml-1 active:bg-secondary-bg transition-colors">
                        <ArrowLeft className="h-5 w-5" />
                    </button>
                    <h1 className="text-lg font-semibold">Статистика</h1>
                </div>

                {/* Сегмент Месяц / Год / Всё — как в Истории */}
                <div className="grid grid-cols-3 gap-1 rounded-xl bg-secondary-bg p-1" role="tablist" aria-label="Период">
                    {MODES.map(m => (
                        <button key={m.key} role="tab" aria-selected={mode === m.key} onClick={() => pickMode(m.key)}
                            className={cn(
                                "py-1.5 rounded-lg text-sm font-medium transition-colors active:animate-pop",
                                mode === m.key ? "bg-accent text-accent-fg shadow-sm" : "text-hint",
                            )}>
                            {m.label}
                        </button>
                    ))}
                </div>

                {/* Степпер периода + итог */}
                {/* Степпер периода. В отличие от Истории, тут нет итога справа (он в KPI),
                    поэтому центрируем степпер, иначе justify-between прижимает его влево. */}
                <div className="flex items-center justify-center gap-2 min-h-[2rem]">
                    {mode !== "all" ? (
                        <div className="flex items-center gap-0.5">
                            <button aria-label="Предыдущий период" disabled={prevDisabled} onClick={() => step(-1)}
                                className="h-8 w-8 grid place-items-center rounded-full disabled:opacity-30 active:bg-secondary-bg transition-colors">
                                <ChevronLeft className="h-5 w-5" />
                            </button>
                            <span aria-live="polite" className="text-sm font-semibold text-center min-w-[8rem] whitespace-nowrap">{periodLabel}</span>
                            <button aria-label="Следующий период" disabled={nextDisabled} onClick={() => step(1)}
                                className="h-8 w-8 grid place-items-center rounded-full disabled:opacity-30 active:bg-secondary-bg transition-colors">
                                <ChevronRight className="h-5 w-5" />
                            </button>
                        </div>
                    ) : (
                        <span className="text-sm font-semibold">Всё время</span>
                    )}
                </div>
            </div>

            <div className="px-4 pb-12 space-y-5">
                {isLoading && <p className="text-center text-hint py-10 animate-pulse">Загрузка…</p>}

                {/* MA-02 (SPEC-042): ошибка сети ≠ «трат нет» — различимый error-state с ретраем (паттерн Shell). */}
                {!isLoading && isError && (
                    <div className="text-center py-12 space-y-3">
                        <p className="text-hint">Не удалось загрузить траты</p>
                        <button onClick={() => refetch()} className="text-accent font-medium">Повторить</button>
                    </div>
                )}

                {!isLoading && !isError && agg.count === 0 && (
                    <p className="text-center text-hint py-12">
                        {!bounds ? "Пока нет трат" : "Трат в этом периоде нет"}
                    </p>
                )}

                {!isLoading && !isError && agg.count > 0 && (
                    <>
                        <KPI total={agg.total} avg={avg} count={agg.count} missing={agg.missing} delta={delta} />
                        {agg.total > 0 && <Donut agg={agg} palette={palette} onTapCat={openDrill} />}
                        {agg.total > 0 && <CatList palette={palette} total={agg.total} catById={catById} onTapCat={openDrill} />}
                        {agg.total > 0 && <Trend trend={trend} mode={mode} />}
                    </>
                )}
            </div>

            <DrillModal
                drill={drill} onClose={() => setDrill(null)}
                filtered={filtered} catById={catById} periodLabel={periodLabel}
                onPickExpense={(e) => { setDrill(null); d({ t: "loadEdit", e }); }}
            />
        </div>
    );
}

/* ── KPI ─────────────────────────────────────────────────────────────────── */

function DeltaBadge({ delta }: { delta: NonNullable<Delta> }) {
    if (delta.kind === "flat") return <span className="text-xs font-medium text-hint" title="к прошлому периоду">→ 0%</span>;
    if (delta.kind === "new") return <span className="text-xs font-medium text-hint" title="к прошлому периоду">▲ new</span>;
    // Для расходов: больше трат = danger (красный), меньше = accent (зелёный).
    const up = delta.kind === "up";
    return (
        <span className={cn("text-xs font-medium", up ? "text-danger" : "text-accent")} title="к прошлому периоду">
            {up ? "▲" : "▼"} {Math.round(delta.pct)}%
        </span>
    );
}

function KPI({ total, avg, count, missing, delta }: {
    total: number; avg: number; count: number; missing: number; delta: Delta;
}) {
    return (
        <div className="space-y-1">
            <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold tabular-nums leading-none">{fmtEur0(total)}</span>
                <Currency code="EUR" size="sm" />
                {/* Δ скрываем, когда total==0 при count>0 (все траты без курса) — иначе «▼ 100%»
                    рядом с «! N без курса» вводит в заблуждение (SPEC-036 review). */}
                {delta && total > 0 && <span className="ml-auto"><DeltaBadge delta={delta} /></span>}
            </div>
            <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-xs text-hint">
                <span className="inline-flex items-center gap-1 tabular-nums">
                    ≈ {fmtEur0(avg)} <Currency code="EUR" flagOnly />/день
                </span>
                <span>·</span>
                <span className="tabular-nums">{count} {plural(count, ["трата", "траты", "трат"])}</span>
                {missing > 0 && (
                    <span className="text-danger font-medium">! {missing} без курса</span>
                )}
            </div>
        </div>
    );
}

/* ── Donut ───────────────────────────────────────────────────────────────── */

const RAD = 42, GAP_DEG = 1.0, C = 2 * Math.PI * RAD, GAP_LEN = (GAP_DEG / 360) * C;

function Donut({ agg, palette, onTapCat }: {
    agg: { total: number }; palette: ReturnType<typeof buildPalette>; onTapCat: (cat: string | null) => void;
}) {
    const segs = useMemo(() => {
        const groups: { key: string; catId: string | null; isOther: boolean; sum: number; color: string }[] = [];
        let other = 0;
        for (const [cid, sum] of palette.items) {
            if (palette.topIds.includes(cid)) {
                groups.push({ key: `cat:${cid ?? "none"}`, catId: cid, isOther: false, sum, color: palette.colorByCat.get(cid)! });
            } else {
                other += sum;
            }
        }
        if (other > 0) groups.push({ key: "other", catId: null, isOther: true, sum: other, color: CHART_OTHER });
        let acc = 0;
        return groups.map(g => {
            const frac = g.sum / agg.total;
            const dash = Math.max(0.4, frac * C - GAP_LEN);
            const offset = -acc;
            acc += frac * C;
            return { ...g, dash, gap: C - dash, offset };
        });
    }, [palette, agg.total]);

    const totalStr = fmtEur0(agg.total);
    const fs = totalStr.length > 8 ? 13 : totalStr.length > 6 ? 17 : totalStr.length > 4 ? 21 : 24;

    return (
        <div className="grid place-items-center">
            <svg viewBox="0 0 100 100" className="w-52 h-52" role="img" aria-label="Распределение по категориям">
                <circle cx="50" cy="50" r={RAD} fill="none" stroke="hsl(var(--secondary))" strokeWidth="13" />
                {segs.map((s, i) => (
                    <circle key={s.key} className="donut-seg" cx="50" cy="50" r={RAD}
                        fill="none" stroke={s.color} strokeWidth="13"
                        strokeDasharray={`${s.dash.toFixed(2)} ${s.gap.toFixed(2)}`}
                        strokeDashoffset={s.offset.toFixed(2)}
                        transform="rotate(-90 50 50)" strokeLinecap="butt"
                        style={{ animationDelay: `${40 + i * 35}ms`, cursor: s.isOther ? "default" : "pointer" }}
                        onClick={s.isOther ? undefined : () => onTapCat(s.catId)}>
                        <title>{s.isOther ? "Прочее" : ""}</title>
                    </circle>
                ))}
                {/* dominantBaseline="central" → y задаёт ВЕРТИКАЛЬНЫЙ ЦЕНТР текста (а не базовую
                    линию), иначе число «висит» выше середины кольца при любом fontSize. */}
                <text x="50" y="48" textAnchor="middle" dominantBaseline="central" fontSize={fs} fontWeight="700"
                    fill="hsl(var(--foreground))" className="tabular-nums" style={{ pointerEvents: "none" }}>{totalStr}</text>
                <text x="50" y="64" textAnchor="middle" dominantBaseline="central" fontSize="7" fill="hsl(var(--muted-foreground))" style={{ pointerEvents: "none" }}>EUR</text>
            </svg>
        </div>
    );
}

/* ── Список категорий ────────────────────────────────────────────────────── */

function CatList({ palette, total, catById, onTapCat }: {
    palette: ReturnType<typeof buildPalette>; total: number;
    catById: Map<string, Category>; onTapCat: (cat: string | null) => void;
}) {
    return (
        <div className="space-y-2.5">
            {palette.items.map(([cid, sum]) => {
                const pct = (sum / total) * 100;
                const color = palette.colorByCat.get(cid)!;
                const cat = cid ? catById.get(cid) : undefined;
                const pctStr = pct >= 1 ? Math.round(pct) : pct.toFixed(1);
                return (
                    <button key={cid ?? "__none__"} onClick={() => onTapCat(cid)}
                        className="w-full text-left active:animate-pop transition-colors rounded-lg -mx-1 px-1 py-0.5 hover:bg-secondary-bg/40">
                        <div className="flex items-center gap-2 text-sm">
                            <span className="h-6 w-6 rounded-full grid place-items-center text-xs shrink-0" style={{ background: color }}>
                                {cat?.emoji ?? "🏷"}
                            </span>
                            <span className="flex-1 min-w-0 truncate">{cat?.name ?? "Без категории"}</span>
                            <span className="text-hint tabular-nums shrink-0">{pctStr}%</span>
                            <span className="tabular-nums shrink-0 inline-flex items-center gap-1">
                                {fmtEur0(sum)}<Currency code="EUR" flagOnly />
                            </span>
                        </div>
                        <div className="mt-1 h-1.5 rounded-full bg-secondary-bg overflow-hidden">
                            <div className="stat-bar-fill h-full rounded-full" style={{ width: `${pct.toFixed(2)}%`, background: color }} />
                        </div>
                    </button>
                );
            })}
        </div>
    );
}

/* ── Тренд ───────────────────────────────────────────────────────────────── */

const TREND_H = 62;

function Trend({ trend, mode }: { trend: ReturnType<typeof buildTrend>; mode: Mode }) {
    const ticks = axisTickIndices(trend.bins.length, mode);
    const avgPct = trend.max > 0 ? trend.avg / trend.max : 0;
    return (
        <div className="space-y-1.5 pt-1">
            <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-hint">{trend.title}</span>
                <span className="text-[11px] text-hint tabular-nums">
                    средн. {fmtEur0(trend.avg)} € · макс. {fmtEur0(trend.max)} €
                </span>
            </div>
            <div className="relative flex items-end gap-[2px]" style={{ height: TREND_H }}>
                {trend.bins.map(b => {
                    const h = b.sum === 0 ? 2 : Math.max(2, (b.sum / trend.max) * TREND_H);
                    return (
                        <div key={b.key} title={`${b.label}: ${fmtEur0(b.sum)} €`}
                            className={cn("flex-1 rounded-t-sm min-w-[2px]", b.sum === 0 ? "bg-border" : b.isToday ? "bg-accent" : "bg-accent/45")}
                            style={{ height: h }} />
                    );
                })}
                {avgPct > 0.02 && avgPct < 1 && (
                    <div aria-hidden className="absolute left-0 right-0 border-t border-hint/45"
                        style={{ bottom: avgPct * TREND_H }} />
                )}
            </div>
            <div className="flex justify-between text-[10px] text-hint tabular-nums">
                {ticks.map(i => <span key={i}>{trend.bins[i].label}</span>)}
            </div>
        </div>
    );
}

/* ── Drill-down ──────────────────────────────────────────────────────────── */

function DrillModal({ drill, onClose, filtered, catById, periodLabel, onPickExpense }: {
    drill: { cat: string | null } | null;
    onClose: () => void;
    filtered: Expense[];
    catById: Map<string, Category>;
    periodLabel: string;
    onPickExpense: (e: Expense) => void;
}) {
    const cat = drill?.cat ? catById.get(drill.cat) : undefined;
    const title = drill ? (cat?.name ?? "Без категории") : "";
    const items = useMemo(() => {
        if (!drill) return [];
        return filtered
            .filter(e => e.category_id === drill.cat)
            .sort((a, b) => b.date.localeCompare(a.date) || (b.created_at ?? "").localeCompare(a.created_at ?? ""));
    }, [drill, filtered]);
    const sumEur = items.reduce((s, e) => s + (e.amount_eur ?? 0), 0);

    return (
        <Modal open={drill !== null} onClose={onClose} title={title}>
            <p className="text-xs text-hint mb-3 -mt-1 tabular-nums">
                {periodLabel} · {items.length} {plural(items.length, ["трата", "траты", "трат"])} · {fmtEur0(sumEur)} €
            </p>
            <div className="space-y-1 max-h-[60vh] overflow-y-auto -mx-1 px-1">
                {items.length === 0 && <p className="text-center text-hint py-8">Нет трат</p>}
                {items.map(e => {
                    const c = e.category_id ? catById.get(e.category_id) : undefined;
                    return (
                        <button key={e.id} onClick={() => { haptic("light"); onPickExpense(e); }}
                            className="w-full flex items-center gap-3 py-2.5 px-2 rounded-xl active:animate-pop transition-colors text-left"
                            style={{ background: (c?.color ?? "#9ca3af") + "1f" }}>
                            <span className="h-8 w-8 rounded-full grid place-items-center text-base shrink-0"
                                style={{ background: (c?.color ?? "#9ca3af") + "59" }}>{c?.emoji ?? "🏷"}</span>
                            <span className="flex-1 min-w-0">
                                <span className="block truncate text-sm">{e.note || <span className="text-hint">Без описания</span>}</span>
                                <span className="block text-xs text-hint">{humanDay(e.date)}</span>
                            </span>
                            <Amount amount={e.amount} currency={e.currency} className="text-sm shrink-0" />
                        </button>
                    );
                })}
            </div>
        </Modal>
    );
}
