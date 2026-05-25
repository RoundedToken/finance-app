import { Link, useParams, useRouter } from "@tanstack/react-router";
import { ArrowLeft, Trash2, ArrowRight } from "lucide-react";
import { useAccounts, useChainDetail, useDeleteChain } from "@/api/queries";
import { Currency } from "@/components/Currency";
import { formatAmount, formatDate, formatExchangeRate } from "@/lib/utils";

export function ChainDetailPage() {
    const { chainId } = useParams({ strict: false }) as { chainId: string };
    const router = useRouter();
    const { data, isLoading } = useChainDetail(chainId);
    const { data: accData } = useAccounts();
    const remove = useDeleteChain();

    const accounts = accData?.accounts ?? [];
    const accName = (id: string) => accounts.find(a => a.id === id)?.name ?? id;

    if (isLoading) return <div className="card p-12 text-center text-muted-foreground">Загрузка…</div>;
    if (!data) {
        return (
            <div className="card p-12 text-center space-y-3">
                <div className="text-muted-foreground">Цепочка не найдена</div>
                <Link to="/transactions" className="btn-primary px-4 py-2 inline-flex">← К обменам</Link>
            </div>
        );
    }

    const handleDelete = async () => {
        if (!confirm(`Удалить всю цепочку из ${data.step_count} ${data.step_count === 1 ? "звена" : "звеньев"}?\nВсе связанные snapshots тоже удалятся.`)) return;
        await remove.mutateAsync(chainId);
        router.navigate({ to: "/transactions" });
    };

    const initial = data.initial;
    const final = data.final;
    const effectiveText = initial && final
        ? formatExchangeRate(initial.amount, initial.currency, final.amount, final.currency)
        : null;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-4">
                <Link to="/transactions" className="btn-ghost px-3 py-2">
                    <ArrowLeft className="h-4 w-4" /> Обмены
                </Link>
                <button onClick={handleDelete} className="btn-ghost px-3 py-2 text-destructive">
                    <Trash2 className="h-4 w-4" /> Удалить цепочку
                </button>
            </div>

            <div className="card p-6 space-y-4">
                <div>
                    <div className="text-sm text-muted-foreground">Цепочка</div>
                    <div className="font-mono text-base">{chainId.slice(0, 16)}…</div>
                </div>

                {initial && final && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                        <div className="rounded-xl border p-4 bg-background/40">
                            <div className="text-xs text-muted-foreground">Начальная позиция</div>
                            <div className="num tabular-nums font-semibold text-lg mt-1">
                                {formatAmount(initial.amount, initial.currency)} <Currency code={initial.currency} size="sm" />
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">{accName(initial.account_id)}</div>
                        </div>
                        <div className="text-center">
                            <ArrowRight className="h-6 w-6 mx-auto text-muted-foreground" />
                            {effectiveText && (
                                <div className="text-xs text-muted-foreground mt-1 tabular-nums">{effectiveText}</div>
                            )}
                        </div>
                        <div className="rounded-xl border p-4 bg-background/40">
                            <div className="text-xs text-muted-foreground">Конечная позиция</div>
                            <div className="num tabular-nums font-semibold text-lg mt-1">
                                {formatAmount(final.amount, final.currency)} <Currency code={final.currency} size="sm" />
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">{accName(final.account_id)}</div>
                        </div>
                    </div>
                )}

                <div className="text-xs text-muted-foreground">
                    {data.step_count} {data.step_count === 1 ? "шаг" : data.step_count < 5 ? "шага" : "шагов"} ·
                    {data.transactions[0]?.date && ` ${formatDate(data.transactions[0].date)}`}
                </div>
            </div>

            <div className="card overflow-hidden">
                <div className="p-4 border-b font-medium">Шаги цепочки</div>
                <table className="w-full text-sm">
                    <thead className="bg-secondary/30 border-b">
                        <tr>
                            <th className="text-left px-4 py-3 font-medium text-muted-foreground w-12">#</th>
                            <th className="text-left px-4 py-3 font-medium text-muted-foreground">Откуда → Куда</th>
                            <th className="text-right px-4 py-3 font-medium text-muted-foreground">Сумма</th>
                            <th className="text-left px-4 py-3 font-medium text-muted-foreground">Курс</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.transactions.map(tx => {
                            const rateText = formatExchangeRate(tx.from_amount, tx.from_currency, tx.to_amount, tx.to_currency) ?? "—";
                            return (
                                <tr key={tx.id} className="border-b last:border-b-0">
                                    <td className="px-4 py-2.5 text-muted-foreground">{tx.chain_sequence}</td>
                                    <td className="px-4 py-2.5">
                                        <div>{accName(tx.from_account_id)}</div>
                                        <div className="text-xs text-muted-foreground">→ {accName(tx.to_account_id)}</div>
                                    </td>
                                    <td className="px-4 py-2.5 text-right num tabular-nums whitespace-nowrap">
                                        <div>{formatAmount(tx.from_amount, tx.from_currency)} <Currency code={tx.from_currency} size="xs" /></div>
                                        <div className="text-muted-foreground">→ {formatAmount(tx.to_amount, tx.to_currency)} <Currency code={tx.to_currency} size="xs" /></div>
                                    </td>
                                    <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap tabular-nums">{rateText}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
