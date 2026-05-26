import { ArrowLeft } from "lucide-react";
import { useBootstrap, useExpenses, useDeleteExpense } from "@/api/queries";
import { useApp } from "@/store";
import { useToast } from "@/components/Toast";
import { SwipeRow } from "@/components/SwipeRow";
import { Amount } from "@/components/Amount";
import { humanDay } from "@/lib/utils";
import { toBase } from "@/lib/money";
import { haptic, confirmDialog } from "@/lib/telegram";
import type { Expense, Category } from "@/api/types";

export function HistoryScreen() {
    const { s, d } = useApp();
    const { data, isLoading } = useExpenses();
    const boot = useBootstrap();
    const expenses = data?.expenses ?? [];
    const rates = boot.data?.rates;
    const cats = boot.data?.categories ?? [];

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
                    const total = rates ? rows.reduce((sm, e) => sm + toBase(e.amount, e.currency, s.baseCurrency, rates), 0) : 0;
                    return (
                        <div key={day}>
                            <div className="flex items-center justify-between text-xs text-hint mb-1.5">
                                <span>{humanDay(day)}</span>
                                <span className="inline-flex items-center gap-1">≈ <Amount amount={total} currency={s.baseCurrency} /></span>
                            </div>
                            <div className="space-y-0.5">
                                {rows.map(e => <HistoryRow key={e.id} e={e} cats={cats} />)}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function HistoryRow({ e, cats }: { e: Expense; cats: Category[] }) {
    const { d } = useApp();
    const del = useDeleteExpense();
    const toast = useToast();
    const c = cats.find(x => x.id === e.category_id);
    const remove = async () => {
        if (!(await confirmDialog("Удалить запись?"))) return;
        del.mutate(e.id, { onSuccess: () => { haptic("success"); toast("Удалено"); }, onError: () => { haptic("error"); toast("Ошибка", "err"); } });
    };
    return (
        <SwipeRow onTap={() => d({ t: "edit", e })} onDelete={remove}>
            <div className="flex items-center gap-2 py-1.5 px-2 bg-bg">
                <span className="text-lg">{c?.emoji ?? "🏷"}</span>
                <span className="flex-1 truncate text-sm">{e.note || c?.name || "—"}</span>
                <Amount amount={e.amount} currency={e.currency} className="text-sm" />
            </div>
        </SwipeRow>
    );
}
