import { ArrowLeft } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
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

    const { byDay, days } = useMemo(() => {
        const byDay = new Map<string, Expense[]>();
        for (const e of expenses) {
            const a = byDay.get(e.date) ?? [];
            a.push(e);
            byDay.set(e.date, a);
        }
        const days = [...byDay.keys()].sort((a, b) => (a < b ? 1 : -1));
        return { byDay, days };
    }, [expenses]);

    // SPEC-034: day-level windowing на ОКОННОМ (document) скролле — надёжно в Telegram
    // webview, не зависит от высоты внутреннего контейнера (старая История скроллилась
    // именно документом). В DOM только видимые блоки-дни + overscan.
    // DayTotal каждого дня считается из ПОЛНОГО набора трат дня (byDay) → SPEC-033 не нарушен.
    const listRef = useRef<HTMLDivElement>(null);
    const [scrollMargin, setScrollMargin] = useState(0);
    useLayoutEffect(() => {
        setScrollMargin(listRef.current?.offsetTop ?? 0);
    }, [days.length]);
    const virtualizer = useWindowVirtualizer({
        count: days.length,
        estimateSize: () => 132, // заголовок дня + ~1–2 строки + отступ; уточняется measureElement
        overscan: 4,
        scrollMargin,
    });
    const virtualDays = virtualizer.getVirtualItems();
    // Временный счётчик-доказательство windowing: сколько трат реально сейчас в DOM.
    const domRows = virtualDays.reduce((sum, vd) => sum + (byDay.get(days[vd.index])?.length ?? 0), 0);

    return (
        <div className="min-h-screen">
            <header className="sticky top-0 bg-bg flex items-center gap-2 px-4 py-3 z-10">
                <button aria-label="Назад" onClick={() => { haptic("light"); d({ t: "screen", v: "main" }); }}
                    className="h-9 w-9 grid place-items-center rounded-full active:bg-secondary-bg transition-colors">
                    <ArrowLeft className="h-5 w-5" />
                </button>
                <h1 className="text-lg font-semibold">История</h1>
                {expenses.length > 0 && (
                    <span className="ml-auto text-[11px] text-hint tabular-nums">DOM {domRows}/{expenses.length}</span>
                )}
            </header>

            <div className="px-4 pb-10">
                {isLoading && <p className="text-center text-hint py-10 animate-pulse">Загрузка…</p>}
                {!isLoading && !days.length && <p className="text-center text-hint py-10">Пока нет трат</p>}
                {days.length > 0 && (
                    <div ref={listRef} style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
                        {virtualDays.map(vd => {
                            const day = days[vd.index];
                            const rows = byDay.get(day)!;
                            return (
                                <div key={day}
                                    data-index={vd.index}
                                    ref={virtualizer.measureElement}
                                    style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vd.start - scrollMargin}px)` }}
                                    className="pb-4">
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
                )}
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
