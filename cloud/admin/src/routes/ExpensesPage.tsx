import { useMemo, useState } from "react";
import {
    createColumnHelper,
    flexRender,
    getCoreRowModel,
    getFilteredRowModel,
    getSortedRowModel,
    useReactTable,
    type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, Search } from "lucide-react";
import { useExpenses, useReferences } from "@/api/queries";
import { cn, formatAmount, formatDate } from "@/lib/utils";
import type { Expense } from "@/api/types";

interface Row extends Expense {
    category_name?: string;
    category_emoji?: string | null;
    account_name?: string;
    eur_equivalent: number;
}

const columnHelper = createColumnHelper<Row>();

export function ExpensesPage() {
    const { data: expensesData, isLoading } = useExpenses();
    const { data: refs } = useReferences();

    const [sorting, setSorting] = useState<SortingState>([{ id: "date", desc: true }]);
    const [globalFilter, setGlobalFilter] = useState("");
    const [currencyFilter, setCurrencyFilter] = useState<string>("");
    const [categoryFilter, setCategoryFilter] = useState<string>("");
    const [periodFilter, setPeriodFilter] = useState<"all" | "30d" | "90d" | "ytd" | "month">("all");

    const enriched = useMemo<Row[]>(() => {
        if (!expensesData?.expenses || !refs) return [];
        const catById = new Map(refs.categories.map(c => [c.id, c]));
        const accById = new Map(refs.accounts.map(a => [a.id, a]));
        const rates = refs.rates?.quotes ?? {};
        return expensesData.expenses.map(e => {
            const cat = e.category_id ? catById.get(e.category_id) : undefined;
            const acc = e.account_id ? accById.get(e.account_id) : undefined;
            const eur = e.currency === "EUR"
                ? e.amount
                : rates[e.currency] ? e.amount / rates[e.currency] : 0;
            return {
                ...e,
                category_name: cat?.name,
                category_emoji: cat?.emoji ?? null,
                account_name: acc?.name,
                eur_equivalent: eur,
            };
        });
    }, [expensesData, refs]);

    const filtered = useMemo(() => {
        let rows = enriched;
        if (currencyFilter) rows = rows.filter(r => r.currency === currencyFilter);
        if (categoryFilter) rows = rows.filter(r => r.category_id === categoryFilter);
        if (periodFilter !== "all") rows = filterByPeriod(rows, periodFilter);
        return rows;
    }, [enriched, currencyFilter, categoryFilter, periodFilter]);

    const columns = useMemo(() => [
        columnHelper.accessor("date", {
            header: "Дата",
            cell: info => <span className="num text-muted-foreground whitespace-nowrap">{formatDate(info.getValue())}</span>,
            size: 110,
        }),
        columnHelper.accessor("category_name", {
            header: "Категория",
            cell: info => {
                const row = info.row.original;
                return (
                    <span className="flex items-center gap-2">
                        <span className="text-base">{row.category_emoji ?? "📁"}</span>
                        <span>{info.getValue() ?? <span className="text-muted-foreground italic">—</span>}</span>
                    </span>
                );
            },
            size: 180,
        }),
        columnHelper.accessor("note", {
            header: "Описание",
            cell: info => {
                const v = info.getValue();
                return v ? <span>{v}</span> : <span className="text-muted-foreground italic">—</span>;
            },
        }),
        columnHelper.accessor("amount", {
            header: "Сумма",
            cell: info => {
                const r = info.row.original;
                return (
                    <span className="num font-medium tabular-nums">
                        {formatAmount(r.amount, r.currency)} <span className="text-muted-foreground">{r.currency}</span>
                    </span>
                );
            },
            size: 160,
            sortDescFirst: true,
        }),
        columnHelper.accessor("eur_equivalent", {
            header: "EUR-эквив.",
            cell: info => {
                const v = info.getValue() ?? 0;
                if (!v) return <span className="text-muted-foreground">—</span>;
                return <span className="num text-muted-foreground tabular-nums">{formatAmount(v, "EUR")}</span>;
            },
            size: 130,
            sortDescFirst: true,
        }),
        columnHelper.accessor("account_name", {
            header: "Счёт",
            cell: info => info.getValue() ?? <span className="text-muted-foreground">—</span>,
            size: 140,
        }),
    ], []);

    const table = useReactTable({
        data: filtered,
        columns,
        state: { sorting, globalFilter },
        onSortingChange: setSorting,
        onGlobalFilterChange: setGlobalFilter,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        globalFilterFn: (row, _columnId, value) => {
            if (!value) return true;
            const v = String(value).toLowerCase();
            const r = row.original;
            return (
                (r.note?.toLowerCase().includes(v) ?? false) ||
                (r.category_name?.toLowerCase().includes(v) ?? false) ||
                String(r.amount).includes(v) ||
                r.currency.toLowerCase().includes(v)
            );
        },
    });

    const totalEur = useMemo(() => filtered.reduce((s, r) => s + (r.eur_equivalent ?? 0), 0), [filtered]);
    const byCurrency = useMemo(() => {
        const m = new Map<string, number>();
        for (const r of filtered) m.set(r.currency, (m.get(r.currency) ?? 0) + r.amount);
        return [...m.entries()].sort((a, b) => b[1] - a[1]);
    }, [filtered]);

    const currencies = refs?.currencies ?? [];
    const categories = refs?.categories ?? [];

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-semibold tracking-tight">Расходы</h1>
                <p className="text-muted-foreground mt-1">Read-only. Редактирование — пока через Mini App в Telegram.</p>
            </div>

            <div className="card p-4 grid grid-cols-1 lg:grid-cols-[1fr_auto_auto_auto] gap-3">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                        type="search"
                        placeholder="Поиск по описанию, категории, сумме…"
                        value={globalFilter}
                        onChange={e => setGlobalFilter(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                </div>
                <Select value={periodFilter} onChange={v => setPeriodFilter(v as any)}
                    options={[
                        { v: "all", l: "За всё время" },
                        { v: "month", l: "Этот месяц" },
                        { v: "30d", l: "Последние 30 дней" },
                        { v: "90d", l: "Последние 90 дней" },
                        { v: "ytd", l: "С начала года" },
                    ]} />
                <Select value={categoryFilter} onChange={setCategoryFilter} placeholder="Все категории"
                    options={[{ v: "", l: "Все категории" }, ...categories.map(c => ({ v: c.id, l: `${c.emoji ?? ""} ${c.name}` }))]} />
                <Select value={currencyFilter} onChange={setCurrencyFilter} placeholder="Все валюты"
                    options={[{ v: "", l: "Все валюты" }, ...currencies.map(c => ({ v: c.code, l: c.code }))]} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                <Stat label="Записей" value={filtered.length.toLocaleString("ru-RU")} />
                <Stat label="Сумма (EUR-эквив)" value={formatAmount(totalEur, "EUR", { withSymbol: true })} />
                <Stat
                    label="В исходных валютах"
                    value={
                        <div className="flex flex-wrap gap-x-3 gap-y-1">
                            {byCurrency.slice(0, 3).map(([ccy, sum]) => (
                                <span key={ccy} className="text-sm num">
                                    {formatAmount(sum, ccy)} <span className="text-muted-foreground">{ccy}</span>
                                </span>
                            ))}
                        </div>
                    }
                />
                <Stat label="Дата курсов" value={refs?.rates?.date ?? "—"} />
            </div>

            <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-secondary/50 border-b">
                            {table.getHeaderGroups().map(hg => (
                                <tr key={hg.id}>
                                    {hg.headers.map(h => {
                                        const sortable = h.column.getCanSort();
                                        const dir = h.column.getIsSorted();
                                        return (
                                            <th key={h.id}
                                                style={{ width: h.getSize() }}
                                                className={cn(
                                                    "px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap",
                                                    sortable && "cursor-pointer select-none hover:text-foreground",
                                                )}
                                                onClick={sortable ? h.column.getToggleSortingHandler() : undefined}
                                            >
                                                <span className="inline-flex items-center gap-1">
                                                    {flexRender(h.column.columnDef.header, h.getContext())}
                                                    {dir === "asc" && <ArrowUp className="h-3 w-3" />}
                                                    {dir === "desc" && <ArrowDown className="h-3 w-3" />}
                                                </span>
                                            </th>
                                        );
                                    })}
                                </tr>
                            ))}
                        </thead>
                        <tbody>
                            {isLoading && (
                                <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">Загрузка…</td></tr>
                            )}
                            {!isLoading && table.getRowModel().rows.length === 0 && (
                                <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">Нет записей под текущие фильтры.</td></tr>
                            )}
                            {table.getRowModel().rows.map(r => (
                                <tr key={r.id} className="border-b last:border-b-0 hover:bg-secondary/30 transition-colors">
                                    {r.getVisibleCells().map(c => (
                                        <td key={c.id} className="px-4 py-2.5 align-middle">
                                            {flexRender(c.column.columnDef.cell, c.getContext())}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

function filterByPeriod<T extends { date: string }>(rows: T[], period: "30d" | "90d" | "ytd" | "month"): T[] {
    const now = new Date();
    const dayMs = 86_400_000;
    let from: Date;
    if (period === "30d") from = new Date(now.getTime() - 30 * dayMs);
    else if (period === "90d") from = new Date(now.getTime() - 90 * dayMs);
    else if (period === "ytd") from = new Date(now.getFullYear(), 0, 1);
    else from = new Date(now.getFullYear(), now.getMonth(), 1);
    const fromISO = from.toISOString().slice(0, 10);
    return rows.filter(r => r.date >= fromISO);
}

interface SelectOption { v: string; l: string }
interface SelectProps {
    value: string;
    onChange: (v: string) => void;
    options: SelectOption[];
    placeholder?: string;
}

function Select({ value, onChange, options }: SelectProps) {
    return (
        <select
            value={value}
            onChange={e => onChange(e.target.value)}
            className="px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring min-w-[10rem]"
        >
            {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
    );
}

interface StatProps { label: string; value: React.ReactNode }
function Stat({ label, value }: StatProps) {
    return (
        <div className="card p-4">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="mt-1 text-lg font-medium num">{value}</div>
        </div>
    );
}
