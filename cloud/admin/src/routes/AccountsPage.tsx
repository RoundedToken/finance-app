import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { Banknote, Coins, ArrowUpRight, Plus, AlertCircle } from "lucide-react";
import { useAccounts, useReferences } from "@/api/queries";
import { formatAmount, formatDate, cn } from "@/lib/utils";
import type { Account } from "@/api/types";

export function AccountsPage() {
    const { data, isLoading } = useAccounts();
    const { data: refs } = useReferences();

    const rates = refs?.rates?.quotes ?? {};
    const ratesDate = refs?.rates?.date;

    const toEur = (amount: number, ccy: string) => {
        if (ccy === "EUR") return amount;
        const r = rates[ccy];
        return r ? amount / r : 0;
    };

    const accounts = data?.accounts ?? [];
    const totalEur = useMemo(
        () => accounts.reduce((s, a) => s + (a.latest_snapshot ? toEur(a.latest_snapshot.amount, a.currency) : 0), 0),
        [accounts, rates],
    );

    const filledCount = accounts.filter(a => !!a.latest_snapshot).length;
    const hasGaps = accounts.some(a => !a.latest_snapshot);

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-semibold tracking-tight">Счета</h1>
                    <p className="text-muted-foreground mt-1">Семь вёдер по парам валюта × форма. Баланс = последний снапшот.</p>
                </div>
                <Link to="/snapshots" className="btn-primary px-4 py-2 self-start">
                    <Plus className="h-4 w-4" /> Снапшоты
                </Link>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <SummaryCard label="Net worth (EUR-эквив.)" value={formatAmount(totalEur, "EUR", { withSymbol: true })} />
                <SummaryCard
                    label="Заполнено вёдер"
                    value={<span>{filledCount}<span className="text-muted-foreground"> / {accounts.length}</span></span>}
                    sub={hasGaps ? "есть пустые — снапшот не вносился" : "все имеют последний снапшот"}
                />
                <SummaryCard label="Курсы от даты" value={ratesDate ?? "—"} sub="Источник: GOOGLEFINANCE" />
            </div>

            {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="card p-6 h-36 animate-pulse bg-muted/40"></div>
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {accounts.map(acc => (
                        <BucketCard key={acc.id} acc={acc} eurEquiv={acc.latest_snapshot ? toEur(acc.latest_snapshot.amount, acc.currency) : 0} />
                    ))}
                </div>
            )}
        </div>
    );
}

interface BucketCardProps { acc: Account; eurEquiv: number }

function BucketCard({ acc, eurEquiv }: BucketCardProps) {
    const isCash = acc.form === "cash";
    const Icon = isCash ? Banknote : Coins;
    const empty = !acc.latest_snapshot;

    return (
        <Link
            to="/snapshots"
            search={{ account_id: acc.id } as any}
            className={cn(
                "card p-5 block transition-all hover:bg-card/80 hover:border-primary/40 group relative",
                empty && "border-dashed",
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
                        <div className="text-xs text-muted-foreground mt-0.5">
                            {acc.currency} · {isCash ? "наличка" : "цифровой"}
                        </div>
                    </div>
                </div>
                <ArrowUpRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>

            <div className="mt-5">
                {acc.latest_snapshot ? (
                    <>
                        <div className="text-2xl font-semibold num tabular-nums">
                            {formatAmount(acc.latest_snapshot.amount, acc.currency)} <span className="text-base text-muted-foreground">{acc.currency}</span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3">
                            <span>{formatAmount(eurEquiv, "EUR")} EUR</span>
                            <span>·</span>
                            <span>от {formatDate(acc.latest_snapshot.date)}</span>
                        </div>
                    </>
                ) : (
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <AlertCircle className="h-4 w-4" />
                        <span className="text-sm">Снапшотов нет</span>
                    </div>
                )}
            </div>
        </Link>
    );
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
