import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useBootstrap, useExpenses, useDeleteExpense } from "@/api/queries";
import { useApp } from "@/store";
import { useToast } from "@/components/Toast";
import { SwipeRow } from "@/components/SwipeRow";
import { Amount } from "@/components/Amount";
import { DayTotal } from "@/components/DayTotal";
import { cn, humanDay, todayISO, MONTHS_NOM, plural, pad2 } from "@/lib/utils";
import { haptic, confirmDialog } from "@/lib/telegram";
import type { Expense, Category, Account } from "@/api/types";

type Mode = "month" | "year" | "all";
const MODES: { key: Mode; label: string }[] = [
    { key: "month", label: "Месяц" },
    { key: "year", label: "Год" },
    { key: "all", label: "Всё" },
];

export function HistoryScreen() {
    const { s, d } = useApp();
    const { data, isLoading, isError, refetch } = useExpenses();
    const boot = useBootstrap();
    const expenses = data?.expenses ?? [];
    const cats = boot.data?.categories ?? [];
    const accounts = boot.data?.accounts ?? [];

    // SPEC-035: дефолтный период — текущий месяц (локальная дата).
    const today = todayISO();
    const curY = Number(today.slice(0, 4));
    const curM = Number(today.slice(5, 7)) - 1; // 0-11
    const [mode, setMode] = useState<Mode>("month");
    const [year, setYear] = useState(curY);
    const [month, setMonth] = useState(curM); // 0-11

    // Границы данных (самый ранний месяц/год с тратами) — для блокировки навигации (E2).
    const bounds = useMemo(() => {
        if (!expenses.length) return null;
        let min = expenses[0].date;
        for (const e of expenses) if (e.date < min) min = e.date;
        return { minY: Number(min.slice(0, 4)), minYM: min.slice(0, 7) };
    }, [expenses]);

    // Клиентский фильтр периода поверх уже загруженного набора (без обращения к серверу).
    const filtered = useMemo(() => {
        if (mode === "all") return expenses;
        const prefix = mode === "month" ? `${year}-${pad2(month + 1)}` : `${year}`;
        return expenses.filter(e => e.date.startsWith(prefix));
    }, [expenses, mode, year, month]);

    const { byDay, days } = useMemo(() => {
        const byDay = new Map<string, Expense[]>();
        for (const e of filtered) {
            const a = byDay.get(e.date) ?? [];
            a.push(e);
            byDay.set(e.date, a);
        }
        const days = [...byDay.keys()].sort((a, b) => (a < b ? 1 : -1));
        return { byDay, days };
    }, [filtered]);

    // SPEC-016: итог периода = Σ amount_eur (date-aware, с worker). EUR-эквивалент.
    const totalEur = useMemo(() => filtered.reduce((sum, e) => sum + (e.amount_eur ?? 0), 0), [filtered]);

    // SPEC-034: day-level windowing на ОКОННОМ (document) скролле — надёжно в Telegram webview.
    // DayTotal каждого дня считается из ПОЛНОГО набора трат дня (byDay) → SPEC-033 не нарушен.
    const listRef = useRef<HTMLDivElement>(null);
    const [scrollMargin, setScrollMargin] = useState(0);
    useLayoutEffect(() => {
        setScrollMargin(listRef.current?.offsetTop ?? 0);
    }, [days.length, mode]);
    const virtualizer = useWindowVirtualizer({
        count: days.length,
        estimateSize: () => 132,
        overscan: 4,
        scrollMargin,
    });
    const virtualDays = virtualizer.getVirtualItems();

    // Навигация по периоду + границы (E2): не листаем в будущее и раньше самых ранних данных.
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
    const emptyLabel = !bounds ? "Пока нет трат" : mode === "month" ? "В этом месяце трат нет" : mode === "year" ? "В этом году трат нет" : "Пока нет трат";

    return (
        <div className="min-h-screen">
            <div className="sticky top-0 z-20 bg-bg/95 backdrop-blur px-4 pt-3 pb-2 space-y-2.5">
                <div className="flex items-center gap-2">
                    <button aria-label="Назад" onClick={() => { haptic("light"); d({ t: "screen", v: "main" }); }}
                        className="h-9 w-9 grid place-items-center rounded-full -ml-1 active:bg-secondary-bg transition-colors">
                        <ArrowLeft className="h-5 w-5" />
                    </button>
                    <h1 className="text-lg font-semibold">История</h1>
                </div>

                {/* Сегмент Месяц / Год / Всё */}
                <div className="grid grid-cols-3 gap-1 rounded-xl bg-secondary-bg p-1" role="tablist" aria-label="Период">
                    {MODES.map(m => (
                        <button key={m.key} role="tab" aria-selected={mode === m.key} aria-controls="history-list" onClick={() => pickMode(m.key)}
                            className={cn(
                                "py-1.5 rounded-lg text-sm font-medium transition-colors active:animate-pop",
                                mode === m.key ? "bg-accent text-accent-fg shadow-sm" : "text-hint",
                            )}>
                            {m.label}
                        </button>
                    ))}
                </div>

                {/* Степпер периода + итог за период */}
                <div className="flex items-center justify-between gap-2 min-h-[2rem]">
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
                        <span className="text-sm font-semibold pl-1">Всё время</span>
                    )}

                    {filtered.length > 0 && (
                        <div className="text-right leading-tight">
                            <span className="inline-flex items-center gap-1 text-sm font-semibold">
                                <span className="text-hint font-normal">≈</span>
                                <Amount amount={totalEur} currency="EUR" />
                            </span>
                            <span className="block text-[11px] text-hint tabular-nums">
                                {filtered.length} {plural(filtered.length, ["трата", "траты", "трат"])}
                            </span>
                        </div>
                    )}
                </div>
            </div>

            <div id="history-list" role="tabpanel" className="px-4 pb-10">
                {isLoading && <p className="text-center text-hint py-10 animate-pulse">Загрузка…</p>}
                {/* MA-02 (SPEC-042): ошибка сети ≠ «трат нет» — различимый error-state с ретраем (паттерн Shell). */}
                {!isLoading && isError && (
                    <div className="text-center py-12 space-y-3">
                        <p className="text-hint">Не удалось загрузить траты</p>
                        <button onClick={() => refetch()} className="text-accent font-medium">Повторить</button>
                    </div>
                )}
                {!isLoading && !isError && !days.length && <p className="text-center text-hint py-12">{emptyLabel}</p>}
                {!isError && days.length > 0 && (
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
