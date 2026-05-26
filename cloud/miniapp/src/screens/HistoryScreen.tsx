import { ArrowLeft } from "lucide-react";
import { useBootstrap, useExpenses, useDeleteExpense } from "@/api/queries";
import { useApp } from "@/store";
import { useToast } from "@/components/Toast";
import { SwipeRow } from "@/components/SwipeRow";
import { Amount } from "@/components/Amount";
import { DayTotal } from "@/components/DayTotal";
import { humanDay } from "@/lib/utils";
import { haptic, confirmDialog } from "@/lib/telegram";
import type { Expense, Category, Account } from "@/api/types";

export function HistoryScreen() {
    const { s, d } = useApp();
    const { data, isLoading } = useExpenses();
    const boot = useBootstrap();
    const expenses = data?.expenses ?? [];
    const cats = boot.data?.categories ?? [];
    const accounts = boot.data?.accounts ?? [];

    const byDay = new Map<string, typeof expenses>();
    for (const e of expenses) {
        const a = byDay.get(e.date) ?? [];
        a.push(e);
        byDay.set(e.date, a);
    }
    const days = [...byDay.keys()].sort((a, b) => (a < b ? 1 : -1));

    return (
        <div className="min-h-screen">
            <header className="sticky top-0 bg-bg/90 backdrop-blur flex items-center gap-2 px-4 py-3 z-10">
                <button aria-label="Назад" onClick={() => { haptic("light"); d({ t: "screen", v: "main" }); }}
                    className="h-9 w-9 grid place-items-center rounded-full active:bg-secondary-bg transition-colors">
                    <ArrowLeft className="h-5 w-5" />
                </button>
                <h1 className="text-lg font-semibold">История</h1>
            </header>

            <div className="px-4 pb-10 space-y-4">
                {isLoading && <p className="text-center text-hint py-10 animate-pulse">Загрузка…</p>}
                {!isLoading && !days.length && <p className="text-center text-hint py-10">Пока нет трат</p>}
                {days.map(day => {
                    const rows = byDay.get(day)!;
                    return (
                        <div key={day}>
                            <div className="flex items-center justify-between px-1 mb-1.5 text-xs text-hint gap-2">
                                <span className="font-medium uppercase tracking-wide shrink-0">{humanDay(day)}</span>
                                <DayTotal rows={rows} base={s.baseCurrency} />
                            </div>
                            <div className="rounded-2xl overflow-hidden divide-y divide-border/40">
                                {rows.map(e => <HistoryRow key={e.id} e={e} cats={cats} accounts={accounts} />)}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function HistoryRow({ e, cats, accounts }: { e: Expense; cats: Category[]; accounts: Account[] }) {
    const { d } = useApp();
    const del = useDeleteExpense();
    const toast = useToast();
    const c = cats.find(x => x.id === e.category_id);
    const acc = accounts.find(a => a.id === e.account_id);
    const remove = async () => {
        if (!(await confirmDialog("Удалить запись?"))) return;
        del.mutate(e.id, { onSuccess: () => { haptic("success"); toast("Удалено"); }, onError: () => { haptic("error"); toast("Ошибка", "err"); } });
    };
    return (
        <SwipeRow onTap={() => d({ t: "loadEdit", e })} onDelete={remove}>
            <div className="flex items-center gap-3 py-2.5 px-3" style={{ background: (c?.color ?? "#9ca3af") + "26" }}>
                <span className="h-9 w-9 rounded-full grid place-items-center text-lg shrink-0" style={{ background: (c?.color ?? "#9ca3af") + "59" }}>{c?.emoji ?? "🏷"}</span>
                <span className="flex-1 min-w-0">
                    <span className="block truncate text-sm">{c?.name || "—"}</span>
                    {e.note && <span className="block truncate text-xs text-hint">{e.note}</span>}
                </span>
                <span className="text-right shrink-0 leading-tight">
                    <Amount amount={e.amount} currency={e.currency} className="text-sm" />
                    {acc && <span className="block text-[10px] text-hint mt-0.5">{acc.name}</span>}
                </span>
            </div>
        </SwipeRow>
    );
}
