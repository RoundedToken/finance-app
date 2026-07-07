import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Search, Copy, TrendingUp } from "lucide-react";
import {
    useAccounts,
    useCreateIncome,
    useDeleteIncome,
    useManagedCategories,
    useIncomes,
    useUpdateIncome,
} from "@/api/queries";
import { ErrorState } from "@/components/ErrorState";
import { GoalSelector } from "@/components/GoalSelector";
import { Modal } from "@/components/Modal";
import { Currency, AccountOption } from "@/components/Currency";
import { Select } from "@/components/Select";
import { PeriodPicker, DEFAULT_PERIOD, computeRange, type PeriodValue } from "@/components/PeriodPicker";
import { cn, formatAmount, formatDate, isoLocal, todayLocal, useDraftId } from "@/lib/utils";
import type { Account, Income, IncomeCategory } from "@/api/types";

const todayISO = todayLocal;   // SPEC-024: дефолт даты дохода — локальный день, не UTC

function firstOfMonth(): string {
    const d = new Date();
    d.setDate(1);
    return isoLocal(d);
}

function minusDays(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return isoLocal(d);
}

export function IncomesPage() {
    const { data: incData, isLoading, isError, refetch } = useIncomes();
    // managed = все категории (вкл. неактивные) — чтобы подпись в истории/breakdown
    // сохранялась после деактивации (SPEC-017 AC4). Выбор фильтрует is_active.
    const { data: catData } = useManagedCategories("income");
    const { data: accData } = useAccounts();

    const create = useCreateIncome();
    const update = useUpdateIncome();
    const remove = useDeleteIncome();

    const accounts = accData?.accounts ?? [];
    const categories = catData?.categories ?? [];
    const incomes = incData?.incomes ?? [];

    const accById = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts]);
    const catById = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories]);

    // KPI windows
    const startOfMonth = firstOfMonth();
    const start365 = minusDays(365);

    const sums = useMemo(() => {
        const acc = { month: 0, year: 0, all: 0, monthCnt: 0, yearCnt: 0, allCnt: 0, missingRates: 0 };
        for (const inc of incomes) {
            const eur = (inc.amount_eur ?? 0);
            const hasRate = inc.amount_eur != null;
            if (!hasRate) acc.missingRates += 1;
            acc.all += eur; acc.allCnt += 1;
            if (inc.date >= start365) { acc.year += eur; acc.yearCnt += 1; }
            if (inc.date >= startOfMonth) { acc.month += eur; acc.monthCnt += 1; }
        }
        return acc;
    }, [incomes, startOfMonth, start365]);

    // Период (PeriodPicker) управляет фильтрами таблицы и breakdown.
    // KPI остаются independent (этот месяц / 12 мес / всё) — они задают
    // постоянный контекст. Default = месяц (текущий).
    const [period, setPeriod] = useState<PeriodValue>(DEFAULT_PERIOD);
    const range = useMemo(() => computeRange(period), [period]);

    const inRange = (date: string) => (!range.from || date >= range.from) && (!range.to || date <= range.to);

    // Breakdown by category для выбранного периода
    const breakdown = useMemo(() => {
        const totals = new Map<string, number>();
        for (const inc of incomes) {
            if (!inRange(inc.date)) continue;
            const eur = (inc.amount_eur ?? 0);
            totals.set(inc.category_id, (totals.get(inc.category_id) ?? 0) + eur);
        }
        const total = Array.from(totals.values()).reduce((s, v) => s + v, 0);
        return categories
            .map(c => ({ cat: c, eur: totals.get(c.id) ?? 0 }))
            .filter(x => x.eur > 0)
            .sort((a, b) => b.eur - a.eur)
            .map(x => ({ ...x, pct: total > 0 ? (x.eur / total) * 100 : 0 }));
    }, [incomes, categories, range.from, range.to]);

    // Поиск + фильтр категории
    const [search, setSearch] = useState("");
    const [filterCategory, setFilterCategory] = useState<string>("");

    const filtered = useMemo(() => {
        let rows: Income[] = incomes.filter(i => inRange(i.date));
        if (filterCategory) rows = rows.filter(i => i.category_id === filterCategory);
        if (search.trim()) {
            const q = search.toLowerCase();
            rows = rows.filter(i =>
                (i.source?.toLowerCase().includes(q) ?? false) ||
                (i.note?.toLowerCase().includes(q) ?? false) ||
                String(i.amount).includes(q) ||
                (catById.get(i.category_id)?.name.toLowerCase().includes(q) ?? false) ||
                (accById.get(i.account_id)?.name.toLowerCase().includes(q) ?? false),
            );
        }
        return rows;
    }, [incomes, search, filterCategory, range.from, range.to, accById, catById]);

    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<Income | null>(null);

    const openCreate = () => { setEditing(null); setModalOpen(true); };
    const openEdit = (i: Income) => { setEditing(i); setModalOpen(true); };

    const handleDelete = async (i: Income) => {
        const cat = catById.get(i.category_id);
        const acc = accById.get(i.account_id);
        if (!confirm(`Удалить доход?\n${cat?.name ?? i.category_id} · ${formatAmount(i.amount, i.currency_code)} ${i.currency_code} · ${formatDate(i.date)} · ${acc?.name ?? i.account_id}`)) return;
        await remove.mutateAsync(i.id);
    };

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-semibold tracking-tight">Доходы</h1>
                    <p className="text-muted-foreground mt-1">
                        Зарплаты, проценты, подарки и всё, что увеличивает счета.
                    </p>
                </div>
                <button onClick={openCreate} className="btn-primary px-4 py-2 self-start">
                    <Plus className="h-4 w-4" /> Новый доход
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <KpiCard label="Этот месяц"          value={<><span>{formatAmount(sums.month, "EUR")}</span> <Currency code="EUR" /></>} sub={`${sums.monthCnt} ${pluralize(sums.monthCnt)}`} />
                <KpiCard label="Последние 12 месяцев" value={<><span>{formatAmount(sums.year, "EUR")}</span> <Currency code="EUR" /></>}  sub={`${sums.yearCnt} ${pluralize(sums.yearCnt)}`} />
                <KpiCard label="Всего"                value={<><span>{formatAmount(sums.all, "EUR")}</span> <Currency code="EUR" /></>}   sub={`${sums.allCnt} ${pluralize(sums.allCnt)}${sums.missingRates ? ` · ${sums.missingRates} без курса` : ""}`} />
            </div>

            <div className="card p-4 space-y-4">
                <PeriodPicker value={period} onChange={setPeriod} />
            </div>

            {breakdown.length > 0 && (
                <div className="card p-5 space-y-3">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <TrendingUp className="h-4 w-4" />
                        Разбивка по категориям · {range.label}
                    </div>
                    <div className="space-y-2">
                        {breakdown.map(({ cat, eur, pct }) => (
                            <CategoryBar key={cat.id} cat={cat} eur={eur} pct={pct} />
                        ))}
                    </div>
                </div>
            )}

            <div className="card p-4 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                        type="search"
                        placeholder="Поиск по источнику, заметке, категории…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                </div>
                <Select
                    value={filterCategory}
                    onChange={e => setFilterCategory(e.target.value)}
                    wrapperClassName="min-w-[12rem]"
                    aria-label="Фильтр по категории"
                >
                    <option value="">Все категории</option>
                    {categories.filter(c => c.is_active).map(c => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
                </Select>
            </div>

            <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-secondary/50 border-b">
                            <tr>
                                <th className="text-left px-4 py-3 font-medium text-muted-foreground w-32">Дата</th>
                                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Категория</th>
                                <th className="text-right px-4 py-3 font-medium text-muted-foreground w-44">Сумма</th>
                                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Источник</th>
                                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Заметка</th>
                                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Ведро</th>
                                <th className="px-4 py-3 w-20"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {isLoading && (
                                <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">Загрузка…</td></tr>
                            )}
                            {isError && (
                                <tr><td colSpan={7} className="px-4 py-8"><ErrorState onRetry={() => refetch()} label="Не удалось загрузить доходы" /></td></tr>
                            )}
                            {!isLoading && !isError && filtered.length === 0 && incomes.length === 0 && (
                                <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                                    Доходов пока нет. Заведи первый — кнопкой выше.
                                </td></tr>
                            )}
                            {!isLoading && filtered.length === 0 && incomes.length > 0 && (
                                <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                                    Ничего не найдено по текущим фильтрам.
                                </td></tr>
                            )}
                            {filtered.map(inc => {
                                const cat = catById.get(inc.category_id);
                                const acc = accById.get(inc.account_id);
                                const eur = (inc.amount_eur ?? 0);
                                return (
                                    <tr key={inc.id} className="border-b last:border-b-0 hover:bg-secondary/30 transition-colors">
                                        <td className="px-4 py-2.5 num text-muted-foreground whitespace-nowrap">{formatDate(inc.date)}</td>
                                        <td className="px-4 py-2.5">
                                            <span className="inline-flex items-center gap-2">
                                                <span
                                                    className="h-6 w-6 rounded grid place-items-center text-xs"
                                                    style={{ background: (cat?.color ?? "#9ca3af") + "22", color: cat?.color ?? "currentColor" }}
                                                >{cat?.emoji ?? "·"}</span>
                                                <span>{cat?.name ?? inc.category_id}</span>
                                            </span>
                                        </td>
                                        <td className="px-4 py-2.5 text-right num font-medium tabular-nums whitespace-nowrap">
                                            <div>{formatAmount(inc.amount, inc.currency_code)} <Currency code={inc.currency_code} /></div>
                                            {inc.currency_code !== "EUR" && (
                                                <div className="text-xs text-muted-foreground">≈ {formatAmount(eur, "EUR")} <Currency code="EUR" size="xs" /></div>
                                            )}
                                        </td>
                                        <td className="px-4 py-2.5">
                                            {inc.source
                                                ? <span>{inc.source}</span>
                                                : <span className="text-muted-foreground italic">—</span>}
                                        </td>
                                        <td className="px-4 py-2.5">
                                            {inc.note
                                                ? <span>{inc.note}</span>
                                                : <span className="text-muted-foreground italic">—</span>}
                                        </td>
                                        <td className="px-4 py-2.5">{acc?.name ?? inc.account_id}</td>
                                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                                            <button onClick={() => openEdit(inc)} className="btn-icon" aria-label="Редактировать">
                                                <Pencil className="h-4 w-4" />
                                            </button>
                                            <button onClick={() => handleDelete(inc)} className="btn-icon text-destructive" aria-label="Удалить">
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            <IncomeModal
                open={modalOpen}
                editing={editing}
                accounts={accounts}
                categories={categories}
                categoriesById={catById}
                incomes={incomes}
                onClose={() => setModalOpen(false)}
                onSubmit={async (payload, id) => {
                    if (id) await update.mutateAsync({ id, patch: payload });
                    else await create.mutateAsync(payload);
                    setModalOpen(false);
                }}
            />
        </div>
    );
}

// GoalSelector вынесен в `@/components/GoalSelector` (shared между Income
// и Transaction-модалями) после SPEC-009. См. этот файл.

function pluralize(n: number): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return "доход";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "дохода";
    return "доходов";
}

interface KpiCardProps { label: string; value: React.ReactNode; sub?: string }
function KpiCard({ label, value, sub }: KpiCardProps) {
    return (
        <div className="card p-5">
            <div className="text-sm text-muted-foreground">{label}</div>
            <div className="mt-2 text-xl font-semibold num tabular-nums">{value}</div>
            {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
        </div>
    );
}

interface CategoryBarProps { cat: IncomeCategory; eur: number; pct: number }
function CategoryBar({ cat, eur, pct }: CategoryBarProps) {
    const color = cat.color ?? "#9ca3af";
    return (
        <div className="flex items-center gap-3">
            <div className="w-44 flex items-center gap-2 text-sm">
                <span
                    className="h-5 w-5 rounded grid place-items-center text-xs"
                    style={{ background: color + "22", color }}
                >{cat.emoji ?? "·"}</span>
                <span>{cat.name}</span>
            </div>
            <div className="flex-1 h-3 rounded-full bg-secondary/60 overflow-hidden">
                <div
                    className="h-full rounded-full transition-[width] duration-500"
                    style={{ width: `${Math.max(2, Math.round(pct))}%`, background: color }}
                />
            </div>
            <div className="w-28 text-right text-sm tabular-nums">{pct.toFixed(1)}%</div>
            <div className="w-32 text-right text-sm tabular-nums text-muted-foreground whitespace-nowrap">
                {formatAmount(eur, "EUR")} <Currency code="EUR" />
            </div>
        </div>
    );
}

interface IncomeModalProps {
    open: boolean;
    editing: Income | null;
    accounts: Account[];
    categories: IncomeCategory[];
    categoriesById: Map<string, IncomeCategory>;
    incomes: Income[];
    onClose: () => void;
    onSubmit: (
        payload: { id?: string; date: string; account_id: string; amount: number; category_id: string; source: string | null; note: string | null; goal_id: string | null },
        id?: string,
    ) => Promise<void>;
}

function IncomeModal({ open, editing, accounts, categories, categoriesById, incomes, onClose, onSubmit }: IncomeModalProps) {
    const draftId = useDraftId(open && !editing);   // ADM-02 (SPEC-044): id create-записи на одно открытие формы
    const [date, setDate] = useState(editing?.date ?? todayISO());
    const [accountId, setAccountId] = useState(editing?.account_id ?? accounts[0]?.id ?? "");
    const [categoryId, setCategoryId] = useState(editing?.category_id ?? categories[0]?.id ?? "");
    const [amount, setAmount] = useState<string>(editing ? String(editing.amount) : "");
    const [source, setSource] = useState(editing?.source ?? "");
    const [note, setNote] = useState(editing?.note ?? "");
    const [goalId, setGoalId] = useState(editing?.goal_id ?? "");
    const [submitting, setSubmitting] = useState(false);

    // Pre-fill при открытии (useEffect — не side-effects через useMemo).
    useEffect(() => {
        if (!open) return;
        setDate(editing?.date ?? todayISO());
        setAccountId(editing?.account_id ?? accounts[0]?.id ?? "");
        setCategoryId(editing?.category_id ?? categories[0]?.id ?? "");
        setAmount(editing ? String(editing.amount) : "");
        setSource(editing?.source ?? "");
        setNote(editing?.note ?? "");
        setGoalId(editing?.goal_id ?? "");
        setSubmitting(false);
    }, [open, editing?.id]);

    const selectedAcc = accounts.find(a => a.id === accountId);

    // FIN-01-хвост (SPEC-044): смена счёта в edit пере-деривит валюту записи на сервере.
    // Полный payload несёт старый amount и обходит серверный guard (он срабатывает
    // только при amount == null) — чистим сумму, пользователь вводит заново.
    const currencyChanged = !!editing && !!selectedAcc && selectedAcc.currency !== editing.currency_code;
    useEffect(() => {
        if (currencyChanged) setAmount("");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedAcc?.currency]);

    // «Из последней» — самая свежая запись выбранной категории
    const latestInCat = useMemo(() => {
        if (!categoryId || editing) return null;
        return incomes
            .filter(i => i.category_id === categoryId)
            .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.created_at < b.created_at ? 1 : -1))[0] ?? null;
    }, [incomes, categoryId, editing]);

    const applyCopy = () => {
        if (!latestInCat) return;
        setAccountId(latestInCat.account_id);
        setAmount(String(latestInCat.amount));
        setSource(latestInCat.source ?? "");
        setNote(latestInCat.note ?? "");
        setGoalId(latestInCat.goal_id ?? "");
        // Дата всё ещё = сегодня (мы не клонируем прошлую дату).
    };

    const numAmount = parseFloat(amount);
    const valid = !!date && !!accountId && !!categoryId && Number.isFinite(numAmount) && numAmount > 0;

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!valid) return;
        setSubmitting(true);
        try {
            await onSubmit(
                {
                    ...(editing ? {} : { id: draftId }),   // ADM-02: только create, не PUT
                    date,
                    account_id: accountId,
                    category_id: categoryId,
                    amount: numAmount,
                    source: source.trim() || null,
                    note: note.trim() || null,
                    goal_id: goalId || null,
                },
                editing?.id,
            );
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal open={open} onClose={onClose} title={editing ? "Редактировать доход" : "Новый доход"}>
            <form onSubmit={submit} className="space-y-4">
                <div className="grid grid-cols-[auto_1fr] gap-3">
                    <Field label="Дата">
                        <input
                            type="date"
                            value={date}
                            onChange={e => setDate(e.target.value)}
                            className="px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                    </Field>
                    <Field label="Ведро">
                        <Select fullWidth value={accountId} onChange={e => setAccountId(e.target.value)}>
                            {accounts.filter(a => !a.is_investment).map(a => (   /* SPEC-026: инвест-вёдра не для доходов */
                                <AccountOption key={a.id} account={a} />
                            ))}
                        </Select>
                    </Field>
                </div>

                <Field label="Категория">
                    <Select fullWidth value={categoryId} onChange={e => setCategoryId(e.target.value)}>
                        {categories.filter(c => c.is_active || c.id === categoryId).map(c => (
                            <option key={c.id} value={c.id}>{c.emoji} {c.name}{c.is_active ? "" : " (неактивна)"}</option>
                        ))}
                    </Select>
                </Field>

                <Field label="Цель (опц.)">
                    <GoalSelector value={goalId} onChange={setGoalId} />
                </Field>

                {latestInCat && (
                    <button
                        type="button"
                        onClick={applyCopy}
                        className={cn(
                            "w-full flex items-center gap-2 px-3 py-2 rounded-lg",
                            "border border-dashed bg-secondary/40 hover:bg-secondary/60",
                            "text-sm text-left transition-colors",
                        )}
                    >
                        <Copy className="h-4 w-4 text-muted-foreground" />
                        <span className="flex-1">
                            Из последней «{categoriesById.get(latestInCat.category_id)?.name}{latestInCat.source ? ` · ${latestInCat.source}` : ""}»
                            <span className="text-muted-foreground">
                                {" "}({formatAmount(latestInCat.amount, latestInCat.currency_code)} <Currency code={latestInCat.currency_code} /> · {formatDate(latestInCat.date)})
                            </span>
                        </span>
                    </button>
                )}

                <Field label={<span className="inline-flex items-center gap-2">Сумма {selectedAcc && <Currency code={selectedAcc.currency} />}</span>}>
                    <input
                        type="number"
                        inputMode="decimal"
                        step="any"
                        min="0.01"
                        value={amount}
                        onChange={e => setAmount(e.target.value)}
                        placeholder="0"
                        className="w-full px-3 py-2 rounded-lg border bg-background text-base tabular-nums focus:outline-none focus:ring-2 focus:ring-ring [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    {currencyChanged && (
                        <span className="block mt-1.5 text-xs text-amber-600 dark:text-amber-400">
                            валюта сменилась на {selectedAcc!.currency} — введи сумму заново
                        </span>
                    )}
                </Field>

                <Field label="Источник (необязательно)">
                    <input
                        type="text"
                        value={source}
                        onChange={e => setSource(e.target.value)}
                        maxLength={200}
                        placeholder="напр. Anthropic, Родители, Tinkoff Save"
                        className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                </Field>

                <Field label="Заметка (необязательно)">
                    <input
                        type="text"
                        value={note}
                        onChange={e => setNote(e.target.value)}
                        maxLength={500}
                        placeholder="напр. за первую половину мая, ежемесячные проценты"
                        className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                </Field>

                <div className="flex justify-end gap-2 pt-2">
                    <button type="button" onClick={onClose} className="btn-ghost px-4 py-2">Отмена</button>
                    <button type="submit" disabled={!valid || submitting} className="btn-primary px-4 py-2 min-w-[7rem]">
                        {submitting ? "…" : (editing ? "Сохранить" : "Создать")}
                    </button>
                </div>
            </form>
        </Modal>
    );
}

interface FieldProps { label: React.ReactNode; children: React.ReactNode }
function Field({ label, children }: FieldProps) {
    return (
        <label className="block">
            <span className="text-sm text-muted-foreground block mb-1.5">{label}</span>
            {children}
        </label>
    );
}
