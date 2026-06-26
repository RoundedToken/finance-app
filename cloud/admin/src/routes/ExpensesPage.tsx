import { useMemo, useRef, useState } from "react";
import {
    createColumnHelper,
    flexRender,
    getCoreRowModel,
    getFilteredRowModel,
    getSortedRowModel,
    useReactTable,
    type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, Search } from "lucide-react";
import { useExpenses, useReferences } from "@/api/queries";
import { ErrorState } from "@/components/ErrorState";
import { Currency } from "@/components/Currency";
import { Select } from "@/components/Select";
import { PeriodPicker, DEFAULT_PERIOD, computeRange, type PeriodValue } from "@/components/PeriodPicker";
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
    const { data: expensesData, isLoading, isError, refetch } = useExpenses();
    const { data: refs } = useReferences();

    const [sorting, setSorting] = useState<SortingState>([{ id: "date", desc: true }]);
    const [globalFilter, setGlobalFilter] = useState("");
    const [currencyFilter, setCurrencyFilter] = useState<string>("");
    const [categoryFilter, setCategoryFilter] = useState<string>("");
    const [period, setPeriod] = useState<PeriodValue>(DEFAULT_PERIOD);
    const range = useMemo(() => computeRange(period), [period]);

    const enriched = useMemo<Row[]>(() => {
        if (!expensesData?.expenses || !refs) return [];
        const catById = new Map(refs.categories.map(c => [c.id, c]));
        const accById = new Map(refs.accounts.map(a => [a.id, a]));
        return expensesData.expenses.map(e => {
            const cat = e.category_id ? catById.get(e.category_id) : undefined;
            const acc = e.account_id ? accById.get(e.account_id) : undefined;
            // SPEC-016: EUR-эквивалент date-aware (по курсу даты траты) — с worker.
            return {
                ...e,
                category_name: cat?.name,
                category_emoji: cat?.emoji ?? null,
                account_name: acc?.name,
                eur_equivalent: e.amount_eur ?? 0,
            };
        });
    }, [expensesData, refs]);

    const filtered = useMemo(() => {
        let rows = enriched;
        if (range.from) rows = rows.filter(r => r.date >= range.from);
        if (range.to)   rows = rows.filter(r => r.date <= range.to);
        if (currencyFilter) rows = rows.filter(r => r.currency === currencyFilter);
        if (categoryFilter) rows = rows.filter(r => r.category_id === categoryFilter);
        return rows;
    }, [enriched, currencyFilter, categoryFilter, range.from, range.to]);

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
                    <span className="num font-medium tabular-nums whitespace-nowrap inline-flex items-center gap-1">
                        {formatAmount(r.amount, r.currency)} <Currency code={r.currency} />
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
                return <span className="num text-muted-foreground tabular-nums whitespace-nowrap inline-flex items-center gap-1">{formatAmount(v, "EUR")} <Currency code="EUR" size="xs" /></span>;
            },
            size: 150,
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
        onSortingChange: u => { setSorting(u); scrollRef.current?.scrollTo({ top: 0 }); },
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

    // SPEC-034: windowing — в DOM только видимые строки + overscan-буфер.
    // Фильтры/сортировка/KPI выше считаются по полному набору (см. filtered/totalEur), окно влияет только на рендер.
    const tableRows = table.getRowModel().rows;
    const scrollRef = useRef<HTMLDivElement>(null);
    const rowVirtualizer = useVirtualizer({
        count: tableRows.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => 44, // ~ высота строки (px-4 py-2.5); измеряется точно через measureElement
        overscan: 12,
    });
    const virtualRows = rowVirtualizer.getVirtualItems();
    const showRows = !isLoading && !isError && tableRows.length > 0;
    const paddingTop = showRows && virtualRows.length ? virtualRows[0].start : 0;
    const paddingBottom = showRows && virtualRows.length
        ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
        : 0;

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-semibold tracking-tight">Расходы</h1>
                <p className="text-muted-foreground mt-1">Read-only. Редактирование — пока через Mini App в Telegram.</p>
            </div>

            <div className="card p-4">
                <PeriodPicker value={period} onChange={setPeriod} />
            </div>

            <div className="card p-4 grid grid-cols-1 lg:grid-cols-[1fr_auto_auto] gap-3">
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
                <Select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} aria-label="Категория">
                    <option value="">Все категории</option>
                    {categories.filter(c => c.is_active).map(c => <option key={c.id} value={c.id}>{c.emoji ?? ""} {c.name}</option>)}
                </Select>
                <Select value={currencyFilter} onChange={e => setCurrencyFilter(e.target.value)} aria-label="Валюта">
                    <option value="">Все валюты</option>
                    {currencies.map(c => <option key={c.code} value={c.code}>{c.emoji ?? ""} {c.code}</option>)}
                </Select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                <Stat label="Записей" value={filtered.length.toLocaleString("ru-RU")} />
                <Stat label="Сумма (EUR-эквив)" value={<><span>{formatAmount(totalEur, "EUR")}</span> <Currency code="EUR" /></>} />
                <Stat
                    label="В исходных валютах"
                    value={
                        <div className="flex flex-wrap gap-x-3 gap-y-1">
                            {byCurrency.slice(0, 3).map(([ccy, sum]) => (
                                <span key={ccy} className="text-sm num inline-flex items-center gap-1">
                                    {formatAmount(sum, ccy)} <Currency code={ccy} />
                                </span>
                            ))}
                        </div>
                    }
                />
                <Stat label="Дата курсов" value={refs?.rates?.date ?? "—"} />
            </div>

            <div className="card overflow-hidden">
                <div ref={scrollRef} className="overflow-auto max-h-[calc(100vh-360px)] min-h-[320px]">
                    <table className="w-full text-sm table-fixed">
                        <thead>
                            {table.getHeaderGroups().map(hg => (
                                <tr key={hg.id}>
                                    {hg.headers.map(h => {
                                        const sortable = h.column.getCanSort();
                                        const dir = h.column.getIsSorted();
                                        return (
                                            <th key={h.id}
                                                style={{ width: h.getSize() }}
                                                className={cn(
                                                    "sticky top-0 z-10 bg-secondary border-b px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap",
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
                                <tr><td colSpan={columns.length} className="px-4 py-12 text-center text-muted-foreground">Загрузка…</td></tr>
                            )}
                            {isError && (
                                <tr><td colSpan={columns.length} className="px-4 py-8"><ErrorState onRetry={() => refetch()} label="Не удалось загрузить расходы" /></td></tr>
                            )}
                            {!isLoading && !isError && tableRows.length === 0 && (
                                <tr><td colSpan={columns.length} className="px-4 py-12 text-center text-muted-foreground">Нет записей под текущие фильтры.</td></tr>
                            )}
                            {showRows && paddingTop > 0 && (
                                <tr aria-hidden><td colSpan={columns.length} style={{ height: paddingTop, padding: 0, border: 0 }} /></tr>
                            )}
                            {showRows && virtualRows.map(vr => {
                                const r = tableRows[vr.index];
                                return (
                                    <tr key={r.id}
                                        data-index={vr.index}
                                        ref={rowVirtualizer.measureElement}
                                        className="border-b last:border-b-0 hover:bg-secondary/30 transition-colors">
                                        {r.getVisibleCells().map(c => (
                                            <td key={c.id} className="px-4 py-2.5 align-middle">
                                                {flexRender(c.column.columnDef.cell, c.getContext())}
                                            </td>
                                        ))}
                                    </tr>
                                );
                            })}
                            {showRows && paddingBottom > 0 && (
                                <tr aria-hidden><td colSpan={columns.length} style={{ height: paddingBottom, padding: 0, border: 0 }} /></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
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
