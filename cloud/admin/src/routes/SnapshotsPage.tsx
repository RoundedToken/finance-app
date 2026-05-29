import { useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Banknote, Coins, Search } from "lucide-react";
import { useAccounts, useCreateSnapshot, useDeleteSnapshot, useSnapshots, useUpdateSnapshot } from "@/api/queries";
import { ErrorState } from "@/components/ErrorState";
import { Modal } from "@/components/Modal";
import { Currency, AccountOption } from "@/components/Currency";
import { Select } from "@/components/Select";
import { cn, formatAmount, formatDate } from "@/lib/utils";
import type { Account, Snapshot } from "@/api/types";

const todayISO = () => new Date().toISOString().slice(0, 10);

export function SnapshotsPage() {
    const { data: snapData, isLoading, isError, refetch } = useSnapshots();
    const { data: accData } = useAccounts();
    const create = useCreateSnapshot();
    const update = useUpdateSnapshot();
    const remove = useDeleteSnapshot();

    const accounts = accData?.accounts ?? [];
    const accById = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts]);
    const snapshots = snapData?.snapshots ?? [];

    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<Snapshot | null>(null);
    const [filterAccount, setFilterAccount] = useState<string>("");
    const [search, setSearch] = useState("");

    const filtered = useMemo(() => {
        let rows = snapshots;
        if (filterAccount) rows = rows.filter(s => s.account_id === filterAccount);
        if (search.trim()) {
            const q = search.toLowerCase();
            rows = rows.filter(s =>
                (s.note?.toLowerCase().includes(q) ?? false) ||
                String(s.amount).includes(q) ||
                (accById.get(s.account_id)?.name.toLowerCase().includes(q) ?? false),
            );
        }
        return rows;
    }, [snapshots, filterAccount, search, accById]);

    const openCreate = () => { setEditing(null); setModalOpen(true); };
    const openEdit = (s: Snapshot) => { setEditing(s); setModalOpen(true); };

    const handleDelete = async (s: Snapshot) => {
        const acc = accById.get(s.account_id);
        if (!confirm(`Удалить снапшот?\n${acc?.name ?? s.account_id} · ${formatAmount(s.amount, acc?.currency ?? "")} · ${formatDate(s.date)}`)) return;
        await remove.mutateAsync(s.id);
    };

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-semibold tracking-tight">Снапшоты</h1>
                    <p className="text-muted-foreground mt-1">
                        Каждый снапшот — это фиксация баланса одного ведра на конкретную дату. Заводи при зарплате, обмене, любом значимом изменении.
                    </p>
                </div>
                <button onClick={openCreate} className="btn-primary px-4 py-2 self-start">
                    <Plus className="h-4 w-4" /> Новый снапшот
                </button>
            </div>

            <div className="card p-4 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                        type="search"
                        placeholder="Поиск по описанию, ведру, сумме…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                </div>
                <Select
                    value={filterAccount}
                    onChange={e => setFilterAccount(e.target.value)}
                    wrapperClassName="min-w-[12rem]"
                    aria-label="Фильтр по ведру"
                >
                    <option value="">Все вёдра</option>
                    {accounts.map(a => <AccountOption key={a.id} account={a} />)}
                </Select>
            </div>

            <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-secondary/50 border-b">
                            <tr>
                                <th className="text-left px-4 py-3 font-medium text-muted-foreground w-32">Дата</th>
                                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Ведро</th>
                                <th className="text-right px-4 py-3 font-medium text-muted-foreground w-44">Сумма</th>
                                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Описание</th>
                                <th className="px-4 py-3 w-20"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {isLoading && (
                                <tr><td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">Загрузка…</td></tr>
                            )}
                            {isError && (
                                <tr><td colSpan={5} className="px-4 py-8"><ErrorState onRetry={() => refetch()} label="Не удалось загрузить снапшоты" /></td></tr>
                            )}
                            {!isLoading && !isError && filtered.length === 0 && (
                                <tr><td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">
                                    Снапшотов пока нет. Заведи первый — кнопкой выше.
                                </td></tr>
                            )}
                            {filtered.map(s => {
                                const acc = accById.get(s.account_id);
                                const isCash = acc?.form === "cash";
                                const Icon = isCash ? Banknote : Coins;
                                const isAuto = s.source === "auto_transaction";
                                return (
                                    <tr key={s.id} className="border-b last:border-b-0 hover:bg-secondary/30 transition-colors">
                                        <td className="px-4 py-2.5 num text-muted-foreground whitespace-nowrap">{formatDate(s.date)}</td>
                                        <td className="px-4 py-2.5">
                                            <span className="inline-flex items-center gap-2">
                                                <span
                                                    className="h-6 w-6 rounded grid place-items-center"
                                                    style={{ background: (acc?.color ?? "#9ca3af") + "22", color: acc?.color ?? "currentColor" }}
                                                >
                                                    <Icon className="h-3.5 w-3.5" />
                                                </span>
                                                <span>{acc?.name ?? s.account_id}</span>
                                                {isAuto && (
                                                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium"
                                                          title="Создан автоматически при обмене/переводе. Редактировать нельзя — изменится через удаление транзакции.">
                                                        auto
                                                    </span>
                                                )}
                                            </span>
                                        </td>
                                        <td className="px-4 py-2.5 text-right num font-medium tabular-nums whitespace-nowrap">
                                            {formatAmount(s.amount, acc?.currency ?? "")} <Currency code={acc?.currency} />
                                        </td>
                                        <td className="px-4 py-2.5">
                                            {s.note
                                                ? <span>{s.note}</span>
                                                : <span className="text-muted-foreground italic">—</span>}
                                        </td>
                                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                                            {!isAuto && (
                                                <>
                                                    <button onClick={() => openEdit(s)} className="btn-icon" aria-label="Редактировать">
                                                        <Pencil className="h-4 w-4" />
                                                    </button>
                                                    <button onClick={() => handleDelete(s)} className="btn-icon text-destructive" aria-label="Удалить">
                                                        <Trash2 className="h-4 w-4" />
                                                    </button>
                                                </>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            <SnapshotModal
                open={modalOpen}
                editing={editing}
                accounts={accounts}
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

interface SnapshotModalProps {
    open: boolean;
    editing: Snapshot | null;
    accounts: Account[];
    onClose: () => void;
    onSubmit: (payload: { date: string; account_id: string; amount: number; note: string | null }, id?: string) => Promise<void>;
}

function SnapshotModal({ open, editing, accounts, onClose, onSubmit }: SnapshotModalProps) {
    const [date, setDate] = useState(editing?.date ?? todayISO());
    const [accountId, setAccountId] = useState(editing?.account_id ?? accounts[0]?.id ?? "");
    const [amount, setAmount] = useState<string>(editing ? String(editing.amount) : "");
    const [note, setNote] = useState(editing?.note ?? "");
    const [submitting, setSubmitting] = useState(false);

    // ре-инициализация при открытии
    const key = `${open}-${editing?.id ?? "new"}`;
    useMemo(() => {
        setDate(editing?.date ?? todayISO());
        setAccountId(editing?.account_id ?? accounts[0]?.id ?? "");
        setAmount(editing ? String(editing.amount) : "");
        setNote(editing?.note ?? "");
    }, [key]);

    const selectedAcc = accounts.find(a => a.id === accountId);
    const lastForAcc = selectedAcc?.manual_snapshot ?? selectedAcc?.latest_snapshot;
    const valid = !!date && !!accountId && parseFloat(amount) >= 0;

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!valid) return;
        setSubmitting(true);
        try {
            await onSubmit(
                { date, account_id: accountId, amount: parseFloat(amount), note: note.trim() || null },
                editing?.id,
            );
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal open={open} onClose={onClose} title={editing ? "Редактировать снапшот" : "Новый снапшот"}>
            <form onSubmit={submit} className="space-y-4">
                <Field label="Ведро">
                    <Select fullWidth value={accountId} onChange={e => setAccountId(e.target.value)}>
                        {accounts.map(a => (
                            <AccountOption key={a.id} account={a} />
                        ))}
                    </Select>
                </Field>

                <div className="grid grid-cols-[1fr_auto] gap-3">
                    <Field label="Сумма">
                        <div className="relative">
                            <input
                                type="number"
                                inputMode="decimal"
                                step="any"
                                min="0"
                                value={amount}
                                onChange={e => setAmount(e.target.value)}
                                placeholder="0"
                                className="w-full px-3 py-2 pr-20 rounded-lg border bg-background text-base tabular-nums focus:outline-none focus:ring-2 focus:ring-ring [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2">
                                <Currency code={selectedAcc?.currency} />
                            </span>
                        </div>
                    </Field>
                    <Field label="Дата">
                        <input
                            type="date"
                            value={date}
                            onChange={e => setDate(e.target.value)}
                            className="px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                    </Field>
                </div>

                {lastForAcc && (
                    <div className="text-xs text-muted-foreground bg-secondary/40 rounded-lg p-3 -mt-1">
                        Прошлый: <span className="num tabular-nums">{formatAmount(lastForAcc.amount, selectedAcc?.currency ?? "")}</span> <Currency code={selectedAcc?.currency} size="xs" /> от {formatDate(lastForAcc.date)}
                        {amount && (
                            <>
                                {" · "}
                                <span className={cn("font-medium", parseFloat(amount) - lastForAcc.amount > 0 ? "text-positive" : parseFloat(amount) - lastForAcc.amount < 0 ? "text-negative" : "")}>
                                    {parseFloat(amount) - lastForAcc.amount > 0 ? "+" : ""}
                                    {formatAmount(parseFloat(amount) - lastForAcc.amount, selectedAcc?.currency ?? "")}
                                </span>
                            </>
                        )}
                    </div>
                )}

                <Field label="Описание (необязательно)">
                    <input
                        type="text"
                        value={note}
                        onChange={e => setNote(e.target.value)}
                        placeholder="напр. зарплата, обмен RUB→EUR, подарок"
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

interface FieldProps { label: string; children: React.ReactNode }
function Field({ label, children }: FieldProps) {
    return (
        <label className="block">
            <span className="text-sm text-muted-foreground block mb-1.5">{label}</span>
            {children}
        </label>
    );
}
