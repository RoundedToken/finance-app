import { Link } from "@tanstack/react-router";
import { Banknote, Coins, ArrowUpRight, Plus, AlertCircle, Info } from "lucide-react";
import { useAccounts, useGoals, useDashboard } from "@/api/queries";
import { ErrorState } from "@/components/ErrorState";
import { Currency } from "@/components/Currency";
import { Sparkline } from "@/components/Sparkline";
import { chartTheme } from "@/lib/chart-theme";
import { formatAmount, formatDate, cn } from "@/lib/utils";
import type { Account } from "@/api/types";

/**
 * SPEC-011: balance = effective_balance (manual baseline + events).
 * Auto-snapshots больше не используются. Drift indicator показывает разницу
 * между manual baseline и computed (но только если manual есть).
 */
export function AccountsPage() {
    const { data, isLoading, isError, refetch } = useAccounts();
    const { data: goalsData } = useGoals("active");
    // SPEC-021: помесячный ряд по ведру уже считается дашбордом (net_worth_series).
    // Переиспользуем его для мини-трендов (тёплый кэш landing-дашборда, staleTime 30s).
    const { data: dash } = useDashboard();

    // SPEC-016: конверсия в EUR — на worker (mark-to-market, курс на сегодня,
    // per-quote). Клиент рендерит готовые поля, сам ничего не делит на курс.
    const accounts = data?.accounts ?? [];
    const summary = data?.summary;
    const totalEur = summary?.net_worth_eur ?? 0;
    const targetedEur = summary?.targeted_eur ?? 0;
    const freeEur = summary?.free_eur ?? 0;        // может быть отрицательный — это сигнал
    const investedEur = summary?.invested_eur ?? 0;   // SPEC-026: исключено из free
    const ratesDate = summary?.rates_date ?? null;
    const missingRates = summary?.missing_rates ?? 0;

    const goalCount = goalsData?.goals?.length ?? 0;

    const withBaseline = accounts.filter(a => !!a.manual_snapshot).length;
    const negativeBuckets = accounts.filter(a => (a.effective_balance ?? 0) < 0);

    // SPEC-021: нативный ряд по ведру + EUR-итог для спарклайнов. Рисуем только
    // при реальной вариации (плоская линия сигнала не несёт — см. sparkSeries).
    const nwSeries = dash?.net_worth_series;
    const netWorthSpark = sparkSeries(nwSeries?.map(p => p.total_eur));
    const bucketSpark = (id: string) => sparkSeries(nwSeries?.map(p => p.by_bucket_native[id] ?? 0));
    const sparkMuted = chartTheme().muted;

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-semibold tracking-tight">Счета</h1>
                    <p className="text-muted-foreground mt-1">
                        Семь вёдер по парам валюта × форма. Баланс = последний manual snapshot + события (доходы, расходы, обмены).
                    </p>
                </div>
                <Link to="/snapshots" className="btn-primary px-4 py-2 self-start">
                    <Plus className="h-4 w-4" /> Снапшоты
                </Link>
            </div>

            {negativeBuckets.length > 0 && (
                <div className="card p-4 border-amber-500/50 bg-amber-500/10 flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <div className="text-sm">
                        <div className="font-medium text-amber-700 dark:text-amber-300">
                            {negativeBuckets.length === 1 ? "Одно ведро в минусе" : `${negativeBuckets.length} вёдер в минусе`}
                        </div>
                        <div className="text-amber-700/80 dark:text-amber-200/80 mt-1">
                            Это значит — нет начального manual snapshot, а события уже сняли деньги.
                            Открой /snapshots и внеси baseline по выписке из банка: {negativeBuckets.map(b => b.name).join(", ")}.
                        </div>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="card p-5">
                    <div className="text-sm text-muted-foreground">Net worth (EUR-эквив.)</div>
                    <div className={cn("mt-2 text-xl font-semibold num tabular-nums", totalEur < 0 && "text-destructive")}>
                        {formatAmount(totalEur, "EUR")} <Currency code="EUR" />
                    </div>
                    {(goalCount > 0 || investedEur > 0.005) && (
                        <div className="mt-3 space-y-1 text-xs">
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">Свободно</span>
                                <span className={cn("num tabular-nums", freeEur < 0 && "text-destructive")}>
                                    {formatAmount(freeEur, "EUR")} <Currency code="EUR" size="xs" />
                                </span>
                            </div>
                            {targetedEur > 0.005 && (
                                <div className="flex items-center justify-between">
                                    <span className="text-muted-foreground">Целевые фонды</span>
                                    <span className="num tabular-nums">
                                        {formatAmount(targetedEur, "EUR")} <Currency code="EUR" size="xs" />
                                    </span>
                                </div>
                            )}
                            {investedEur > 0.005 && (
                                <div className="flex items-center justify-between">
                                    <span className="text-muted-foreground">Инвестиции</span>
                                    <span className="num tabular-nums">
                                        {formatAmount(investedEur, "EUR")} <Currency code="EUR" size="xs" />
                                    </span>
                                </div>
                            )}
                            {goalCount > 0 && (
                                <div className="text-muted-foreground/70 pt-0.5">
                                    {goalCount} {pluralizeGoals(goalCount)}
                                </div>
                            )}
                        </div>
                    )}
                    {missingRates > 0 && (
                        <div className="text-xs text-amber-600 dark:text-amber-400 mt-2 inline-flex items-center gap-1">
                            <Info className="h-3 w-3" /> {missingRates} без курса
                        </div>
                    )}
                    {netWorthSpark && (
                        <div className="mt-3"><Sparkline values={netWorthSpark} color={sparkMuted} height={32} /></div>
                    )}
                </div>
                <SummaryCard
                    label="Manual baseline"
                    value={<span>{withBaseline}<span className="text-muted-foreground"> / {accounts.length}</span></span>}
                    sub={withBaseline < accounts.length ? "у каких вёдер нет «нулевой точки»" : "у всех вёдер есть baseline"}
                />
                <SummaryCard label="Курсы от даты" value={ratesDate ?? "—"} sub="Источник: GOOGLEFINANCE" />
            </div>

            {isError ? (
                <ErrorState onRetry={() => refetch()} label="Не удалось загрузить счета" />
            ) : isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="card p-6 h-36 animate-pulse bg-muted/40"></div>
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {accounts.map(acc => (
                        <BucketCard key={acc.id} acc={acc} eurEquiv={acc.effective_balance_eur ?? 0} spark={bucketSpark(acc.id)} />
                    ))}
                </div>
            )}
        </div>
    );
}

interface BucketCardProps { acc: Account; eurEquiv: number; spark: number[] | null }

function BucketCard({ acc, eurEquiv, spark }: BucketCardProps) {
    const isCash = acc.form === "cash";
    const Icon = isCash ? Banknote : Coins;
    const balance = acc.effective_balance ?? 0;
    const hasManual = !!acc.manual_snapshot;
    const isNegative = balance < 0;
    const drift = hasManual ? balance - (acc.manual_snapshot!.amount) : null;
    const eventsCount = acc.events_count ?? 0;

    return (
        <Link
            to="/snapshots"
            search={{ account_id: acc.id } as any}
            className={cn(
                "card p-5 block transition-all hover:bg-card/80 hover:border-primary/40 group relative",
                !hasManual && "border-dashed",
                isNegative && "border-destructive/40",
            )}
        >
            <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                    <div
                        className="h-9 w-9 rounded-lg grid place-items-center text-foreground"
                        style={{ background: (acc.color ?? "#9ca3af") + "22", color: acc.color ?? "currentColor" }}
                    >
                        <Icon className="h-4 w-4" />
                    </div>
                    <div>
                        <div className="font-medium leading-tight">{acc.name}</div>
                        <div className="text-xs text-muted-foreground mt-0.5 inline-flex items-center gap-1">
                            <Currency code={acc.currency} size="xs" /> · {isCash ? "наличка" : "цифровой"}
                        </div>
                    </div>
                </div>
                <ArrowUpRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>

            <div className="mt-5">
                <div className={cn("text-2xl font-semibold num tabular-nums", isNegative && "text-destructive")}>
                    {formatAmount(balance, acc.currency)} <Currency code={acc.currency} size="base" />
                </div>
                <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
                    <span className="inline-flex items-center gap-1">≈ {formatAmount(eurEquiv, "EUR")} <Currency code="EUR" size="xs" /></span>
                    {hasManual ? (
                        <>
                            <span>·</span>
                            <span title="последний manual snapshot">baseline {formatAmount(acc.manual_snapshot!.amount, acc.currency)} от {formatDate(acc.manual_snapshot!.date)}</span>
                            {drift !== null && Math.abs(drift) > 0.01 && (
                                <>
                                    <span>·</span>
                                    <span className={cn(drift > 0 ? "text-positive" : "text-destructive")} title="drift = computed − baseline">
                                        {drift > 0 ? "+" : ""}{formatAmount(drift, acc.currency)} от событий
                                    </span>
                                </>
                            )}
                        </>
                    ) : (
                        <>
                            <span>·</span>
                            <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                                <Info className="h-3 w-3" />
                                нет baseline
                            </span>
                        </>
                    )}
                    {eventsCount > 0 && (
                        <>
                            <span>·</span>
                            <span>{eventsCount} {pluralizeEvents(eventsCount)}</span>
                        </>
                    )}
                </div>
                {spark && (
                    // pointer-events-none — клик по искре навигирует через карточку-Link (искра не интерактивна)
                    <div className="mt-3 pointer-events-none">
                        <Sparkline values={spark} color={acc.color ?? "#9ca3af"} height={28} />
                    </div>
                )}
            </div>
        </Link>
    );
}

/** Ряд для спарклайна: null если точек < 2 или нет вариации (плоская линия
 *  сигнала не несёт — искру не рисуем). SPEC-021 edge cases E1/E3. */
function sparkSeries(series: number[] | undefined): number[] | null {
    if (!series || series.length < 2) return null;
    const min = Math.min(...series), max = Math.max(...series);
    if (max === min) return null;
    return series;
}

function pluralizeGoals(n: number): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return "активная цель";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "активные цели";
    return "активных целей";
}

function pluralizeEvents(n: number): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return "событие";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "события";
    return "событий";
}

interface SummaryCardProps { label: string; value: React.ReactNode; sub?: string }
function SummaryCard({ label, value, sub }: SummaryCardProps) {
    return (
        <div className="card p-5">
            <div className="text-sm text-muted-foreground">{label}</div>
            <div className="mt-2 text-xl font-semibold num tabular-nums">{value}</div>
            {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
        </div>
    );
}
