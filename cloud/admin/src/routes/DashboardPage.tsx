import { useMemo } from "react";
import { Wallet, TrendingDown, Clock, ListChecks } from "lucide-react";
import { useExpenses, useReferences } from "@/api/queries";
import { Currency } from "@/components/Currency";
import { formatAmount } from "@/lib/utils";

export function DashboardPage() {
    const { data: expenses, isLoading } = useExpenses();
    const { data: refs } = useReferences();

    const stats = useMemo(() => {
        if (!expenses?.expenses || !refs?.rates?.quotes) return null;
        const rates = refs.rates.quotes;
        const base = "EUR";
        const convert = (amount: number, ccy: string) => {
            if (ccy === base) return amount;
            const r = rates[ccy];
            return r ? amount / r : 0;
        };
        const all = expenses.expenses;
        const now = new Date();
        const isThisMonth = (d: string) => {
            const date = new Date(d);
            return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
        };
        const last30 = (d: string) => (now.getTime() - new Date(d).getTime()) < 30 * 86_400_000;
        const sumIn = (pred: (d: string) => boolean) =>
            all.filter(e => pred(e.date)).reduce((s, e) => s + convert(e.amount, e.currency), 0);

        return {
            total: all.length,
            monthSum: sumIn(isThisMonth),
            last30Sum: sumIn(last30),
            earliest: all.length ? all.reduce((acc, e) => e.date < acc ? e.date : acc, all[0].date) : null,
            base,
        };
    }, [expenses, refs]);

    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-3xl font-semibold tracking-tight">Дашборд</h1>
                <p className="text-muted-foreground mt-1">Сводка по расходам. Снапшоты, доходы, дашборд по net worth — в следующих этапах.</p>
            </div>

            {isLoading || !stats ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="card p-6 h-32 animate-pulse bg-muted/40"></div>
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                    <KpiCard icon={ListChecks} label="Всего трат" value={String(stats.total)} sub="за всё время" />
                    <KpiCard icon={TrendingDown} label="В этом месяце" value={<><span>{formatAmount(stats.monthSum, stats.base)}</span> <Currency code={stats.base} /></>} sub="EUR-эквивалент" tone="negative" />
                    <KpiCard icon={Wallet} label="За 30 дней" value={<><span>{formatAmount(stats.last30Sum, stats.base)}</span> <Currency code={stats.base} /></>} sub="EUR-эквивалент" />
                    <KpiCard icon={Clock} label="Первая запись" value={stats.earliest ? new Date(stats.earliest).toLocaleDateString("ru-RU", { year: "numeric", month: "2-digit", day: "2-digit" }) : "—"} sub="старт истории" />
                </div>
            )}

            <div className="card p-8 border-dashed border-2 border-border/60 bg-card/40 text-center">
                <h2 className="text-lg font-medium">Здесь скоро появятся графики</h2>
                <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                    Stage 5–8: net worth over time, monthly burn vs income, breakdown по счетам, savings rate.
                    Пока используем эту админку для read-only анализа расходов.
                </p>
            </div>
        </div>
    );
}

interface KpiCardProps {
    icon: typeof Wallet;
    label: string;
    value: React.ReactNode;
    sub?: string;
    tone?: "default" | "positive" | "negative";
}

function KpiCard({ icon: Icon, label, value, sub, tone = "default" }: KpiCardProps) {
    const valueColor = tone === "negative" ? "text-foreground" : tone === "positive" ? "text-positive" : "text-foreground";
    return (
        <div className="card p-5 transition-colors hover:bg-card/80">
            <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{label}</span>
                <Icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className={`mt-3 text-2xl font-semibold tracking-tight num ${valueColor}`}>{value}</div>
            {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
        </div>
    );
}
