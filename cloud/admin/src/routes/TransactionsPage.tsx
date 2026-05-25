import { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, Repeat, Trash2, Search, Pencil } from "lucide-react";
import {
    useAccounts,
    useCreateTransaction,
    useDeleteTransaction,
    useTransactions,
    useUpdateTransaction,
} from "@/api/queries";
import { Currency } from "@/components/Currency";
import { Select } from "@/components/Select";
import { Modal } from "@/components/Modal";
import { PeriodPicker, DEFAULT_PERIOD, computeRange, type PeriodValue } from "@/components/PeriodPicker";
import { cn, formatAmount, formatDate, formatExchangeRate } from "@/lib/utils";
import type { Account, Transaction, TransactionCreatePayload, TransactionType, TransactionUpdatePayload } from "@/api/types";

const todayISO = () => new Date().toISOString().slice(0, 10);

export function TransactionsPage() {
    const { data, isLoading } = useTransactions();
    const { data: accData } = useAccounts();

    const accounts = accData?.accounts ?? [];
    const accById = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts]);

    const txs = data?.transactions ?? [];

    const [period, setPeriod] = useState<PeriodValue>(DEFAULT_PERIOD);
    const range = useMemo(() => computeRange(period), [period]);
    const [search, setSearch] = useState("");
    const [typeFilter, setTypeFilter] = useState<"" | TransactionType>("");
    const [accountFilter, setAccountFilter] = useState<string>("");

    const filtered = useMemo(() => {
        let rows = txs;
        if (range.from) rows = rows.filter(r => r.date >= range.from);
        if (range.to)   rows = rows.filter(r => r.date <= range.to);
        if (typeFilter) rows = rows.filter(r => r.type === typeFilter);
        if (accountFilter) rows = rows.filter(r => r.from_account_id === accountFilter || r.to_account_id === accountFilter);
        if (search.trim()) {
            const q = search.toLowerCase();
            rows = rows.filter(r =>
                (r.note?.toLowerCase().includes(q) ?? false) ||
                (accById.get(r.from_account_id)?.name.toLowerCase().includes(q) ?? false) ||
                (accById.get(r.to_account_id)?.name.toLowerCase().includes(q) ?? false) ||
                String(r.from_amount).includes(q) ||
                String(r.to_amount).includes(q),
            );
        }
        return rows;
    }, [txs, range.from, range.to, typeFilter, accountFilter, search, accById]);

    const [exchangeOpen, setExchangeOpen] = useState(false);
    const [transferOpen, setTransferOpen] = useState(false);
    const [editTx, setEditTx] = useState<Transaction | null>(null);

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-3xl font-semibold tracking-tight">Обмены</h1>
                    <p className="text-muted-foreground mt-1">
                        Перетасовки денег между вёдрами. Курс фиксируется в момент операции.
                    </p>
                </div>
                <div className="flex gap-2">
                    <button onClick={() => setExchangeOpen(true)} className="btn-primary px-3 py-2 text-sm">
                        <ArrowRightLeft className="h-4 w-4" /> Обмен
                    </button>
                    <button onClick={() => setTransferOpen(true)} className="btn-ghost px-3 py-2 text-sm border">
                        <Repeat className="h-4 w-4" /> Перевод
                    </button>
                </div>
            </div>

            <div className="card p-4">
                <PeriodPicker value={period} onChange={setPeriod} />
            </div>

            <div className="card p-4 grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-3">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                        type="search"
                        placeholder="Поиск по заметке, ведру, сумме…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                </div>
                <Select value={typeFilter} onChange={e => setTypeFilter(e.target.value as any)} aria-label="Тип">
                    <option value="">Все типы</option>
                    <option value="exchange">💱 Обмены</option>
                    <option value="transfer">↔ Переводы</option>
                </Select>
                <Select value={accountFilter} onChange={e => setAccountFilter(e.target.value)} aria-label="Ведро">
                    <option value="">Все вёдра</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </Select>
            </div>

            <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-secondary/50 border-b">
                            <tr>
                                <th className="text-left px-4 py-3 font-medium text-muted-foreground w-32">Дата</th>
                                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Тип</th>
                                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Откуда → Куда</th>
                                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Сумма</th>
                                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Курс</th>
                                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Заметка</th>
                                <th className="px-4 py-3 w-12"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {isLoading && (
                                <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">Загрузка…</td></tr>
                            )}
                            {!isLoading && filtered.length === 0 && txs.length === 0 && (
                                <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                                    Обменов пока нет. Создай первый — кнопками выше.
                                </td></tr>
                            )}
                            {!isLoading && filtered.length === 0 && txs.length > 0 && (
                                <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                                    Ничего не найдено по текущим фильтрам.
                                </td></tr>
                            )}
                            {filtered.map(tx => <TxRow key={tx.id} tx={tx} accounts={accounts} onEdit={setEditTx} />)}
                        </tbody>
                    </table>
                </div>
            </div>

            <ExchangeModal open={exchangeOpen} onClose={() => setExchangeOpen(false)} accounts={accounts} />
            <TransferModal open={transferOpen} onClose={() => setTransferOpen(false)} accounts={accounts} />
            <EditTxModal open={!!editTx} onClose={() => setEditTx(null)} tx={editTx} accounts={accounts} />
        </div>
    );
}

function TxRow({ tx, accounts, onEdit }: { tx: Transaction; accounts: Account[]; onEdit: (tx: Transaction) => void }) {
    const remove = useDeleteTransaction();
    const accFrom = accounts.find(a => a.id === tx.from_account_id);
    const accTo = accounts.find(a => a.id === tx.to_account_id);

    const handleDelete = async () => {
        if (!confirm(`Удалить ${tx.type === "exchange" ? "обмен" : "перевод"}?\n${formatAmount(tx.from_amount, tx.from_currency)} ${tx.from_currency} → ${formatAmount(tx.to_amount, tx.to_currency)} ${tx.to_currency} · ${formatDate(tx.date)}\nСвязанные snapshots тоже удалятся.`)) return;
        await remove.mutateAsync(tx.id);
    };

    const rateText = tx.type === "exchange"
        ? formatExchangeRate(tx.from_amount, tx.from_currency, tx.to_amount, tx.to_currency) ?? "—"
        : "—";

    return (
        <tr className="border-b last:border-b-0 hover:bg-secondary/30 transition-colors">
            <td className="px-4 py-2.5 num text-muted-foreground whitespace-nowrap">{formatDate(tx.date)}</td>
            <td className="px-4 py-2.5">
                <div className="flex flex-col gap-0.5">
                    <span className="inline-flex items-center gap-1.5">
                        {tx.type === "exchange"
                            ? <><ArrowRightLeft className="h-3.5 w-3.5 text-primary" /> обмен</>
                            : <><Repeat className="h-3.5 w-3.5 text-muted-foreground" /> перевод</>}
                    </span>
                </div>
            </td>
            <td className="px-4 py-2.5">
                <div className="text-xs">
                    <div>{accFrom?.name ?? tx.from_account_id}</div>
                    <div className="text-muted-foreground">→ {accTo?.name ?? tx.to_account_id}</div>
                </div>
            </td>
            <td className="px-4 py-2.5 text-right num font-medium tabular-nums whitespace-nowrap">
                <div className="text-destructive/90">−{formatAmount(tx.from_amount, tx.from_currency)} <Currency code={tx.from_currency} size="xs" /></div>
                <div className="text-positive">+{formatAmount(tx.to_amount, tx.to_currency)} <Currency code={tx.to_currency} size="xs" /></div>
            </td>
            <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap tabular-nums">{rateText}</td>
            <td className="px-4 py-2.5">
                {tx.note ? <span>{tx.note}</span> : <span className="text-muted-foreground italic">—</span>}
            </td>
            <td className="px-4 py-2.5 text-right whitespace-nowrap">
                <button onClick={() => onEdit(tx)} className="btn-icon" aria-label="Редактировать" title="Редактировать">
                    <Pencil className="h-4 w-4" />
                </button>
                <button onClick={handleDelete} className="btn-icon text-destructive" aria-label="Удалить">
                    <Trash2 className="h-4 w-4" />
                </button>
            </td>
        </tr>
    );
}

// ── Exchange modal ──────────────────────────────────────────────────────────

interface ModalCommonProps { open: boolean; onClose: () => void; accounts: Account[] }

function ExchangeModal({ open, onClose, accounts }: ModalCommonProps) {
    const create = useCreateTransaction();
    const [date, setDate] = useState(todayISO());
    const [fromId, setFromId] = useState("");
    const [toId, setToId] = useState("");
    const [fromAmt, setFromAmt] = useState("");
    const [toAmt, setToAmt] = useState("");
    const [note, setNote] = useState("");
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!open) return;
        setDate(todayISO()); setFromId(accounts[0]?.id ?? ""); setToId(accounts[1]?.id ?? "");
        setFromAmt(""); setToAmt(""); setNote(""); setSubmitting(false);
    }, [open]);

    const from = accounts.find(a => a.id === fromId);
    const to = accounts.find(a => a.id === toId);
    const sameCurrency = from && to && from.currency === to.currency;
    const sameBucket = fromId && toId && fromId === toId;
    const numFrom = parseFloat(fromAmt);
    const numTo = parseFloat(toAmt);
    const valid = !!date && !!fromId && !!toId && !sameBucket && !sameCurrency
        && Number.isFinite(numFrom) && numFrom > 0
        && Number.isFinite(numTo) && numTo > 0;

    const rateText = useMemo(
        () => (from && to) ? formatExchangeRate(numFrom, from.currency, numTo, to.currency) : null,
        [from, to, numFrom, numTo],
    );

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!valid) return;
        setSubmitting(true);
        try {
            const payload: TransactionCreatePayload = {
                type: "exchange",
                date,
                from_account_id: fromId,
                to_account_id: toId,
                from_amount: numFrom,
                to_amount: numTo,
                note: note.trim() || null,
            };
            await create.mutateAsync(payload);
            onClose();
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal open={open} onClose={onClose} title="Новый обмен" size="md">
            <form onSubmit={submit} className="space-y-4">
                <Field label="Дата">
                    <input type="date" value={date} onChange={e => setDate(e.target.value)}
                        className="px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                </Field>

                <Field label="Откуда">
                    <Select fullWidth value={fromId} onChange={e => setFromId(e.target.value)}>
                        <option value="">— выбери ведро —</option>
                        {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </Select>
                    <input
                        type="number" inputMode="decimal" step="any" min="0"
                        value={fromAmt} onChange={e => setFromAmt(e.target.value)}
                        placeholder={from ? `сумма в ${from.currency}` : "сумма"}
                        className="mt-2 w-full px-3 py-2 rounded-lg border bg-background text-base tabular-nums focus:outline-none focus:ring-2 focus:ring-ring [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                </Field>

                <Field label="Куда">
                    <Select fullWidth value={toId} onChange={e => setToId(e.target.value)}>
                        <option value="">— выбери ведро —</option>
                        {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </Select>
                    <input
                        type="number" inputMode="decimal" step="any" min="0"
                        value={toAmt} onChange={e => setToAmt(e.target.value)}
                        placeholder={to ? `сумма в ${to.currency}` : "сумма"}
                        className="mt-2 w-full px-3 py-2 rounded-lg border bg-background text-base tabular-nums focus:outline-none focus:ring-2 focus:ring-ring [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                </Field>

                {sameCurrency && fromId && toId && (
                    <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-lg p-3">
                        Одинаковая валюта — используй «Перевод», обмен требует разных валют.
                    </div>
                )}

                {rateText && !sameCurrency && (
                    <div className="text-sm text-muted-foreground bg-secondary/40 rounded-lg p-3 tabular-nums">
                        💱 Курс: <span className="text-foreground font-medium">{rateText}</span>
                    </div>
                )}

                <Field label="Заметка (опц.)">
                    <input type="text" value={note} onChange={e => setNote(e.target.value)} maxLength={500}
                        placeholder="напр. через Garantex P2P"
                        className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                </Field>

                <div className="flex justify-end gap-2 pt-2">
                    <button type="button" onClick={onClose} className="btn-ghost px-4 py-2">Отмена</button>
                    <button type="submit" disabled={!valid || submitting} className="btn-primary px-4 py-2 min-w-[7rem]">
                        {submitting ? "…" : "Создать"}
                    </button>
                </div>
            </form>
        </Modal>
    );
}

// ── Transfer modal ──────────────────────────────────────────────────────────

function TransferModal({ open, onClose, accounts }: ModalCommonProps) {
    const create = useCreateTransaction();
    const [date, setDate] = useState(todayISO());
    const [fromId, setFromId] = useState("");
    const [toId, setToId] = useState("");
    const [amount, setAmount] = useState("");
    const [note, setNote] = useState("");
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!open) return;
        setDate(todayISO()); setFromId(""); setToId(""); setAmount(""); setNote(""); setSubmitting(false);
    }, [open]);

    const from = accounts.find(a => a.id === fromId);
    const sameCurrencyAccounts = from ? accounts.filter(a => a.currency === from.currency && a.id !== from.id) : [];
    const to = accounts.find(a => a.id === toId);
    const numAmount = parseFloat(amount);
    const valid = !!date && !!fromId && !!toId && fromId !== toId
        && from && to && from.currency === to.currency
        && Number.isFinite(numAmount) && numAmount > 0;

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!valid) return;
        setSubmitting(true);
        try {
            const payload: TransactionCreatePayload = {
                type: "transfer",
                date,
                from_account_id: fromId,
                to_account_id: toId,
                from_amount: numAmount,
                to_amount: numAmount,
                note: note.trim() || null,
            };
            await create.mutateAsync(payload);
            onClose();
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal open={open} onClose={onClose} title="Новый перевод" size="md">
            <form onSubmit={submit} className="space-y-4">
                <Field label="Дата">
                    <input type="date" value={date} onChange={e => setDate(e.target.value)}
                        className="px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                </Field>

                <Field label="Откуда">
                    <Select fullWidth value={fromId} onChange={e => { setFromId(e.target.value); setToId(""); }}>
                        <option value="">— выбери ведро —</option>
                        {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </Select>
                </Field>

                <Field label="Куда (только вёдра той же валюты)">
                    <Select fullWidth value={toId} onChange={e => setToId(e.target.value)} disabled={!from}>
                        <option value="">— выбери ведро —</option>
                        {sameCurrencyAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </Select>
                </Field>

                <Field label={`Сумма${from ? ` (${from.currency})` : ""}`}>
                    <input type="number" inputMode="decimal" step="any" min="0"
                        value={amount} onChange={e => setAmount(e.target.value)} placeholder="0"
                        className="w-full px-3 py-2 rounded-lg border bg-background text-base tabular-nums focus:outline-none focus:ring-2 focus:ring-ring [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                </Field>

                <Field label="Заметка (опц.)">
                    <input type="text" value={note} onChange={e => setNote(e.target.value)} maxLength={500}
                        placeholder="напр. снял с банка наличкой"
                        className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                </Field>

                <div className="flex justify-end gap-2 pt-2">
                    <button type="button" onClick={onClose} className="btn-ghost px-4 py-2">Отмена</button>
                    <button type="submit" disabled={!valid || submitting} className="btn-primary px-4 py-2 min-w-[7rem]">
                        {submitting ? "…" : "Создать"}
                    </button>
                </div>
            </form>
        </Modal>
    );
}

// ── Edit transaction modal (SPEC-010) ──────────────────────────────────────

interface EditTxModalProps { open: boolean; onClose: () => void; tx: Transaction | null; accounts: Account[] }
function EditTxModal({ open, onClose, tx, accounts }: EditTxModalProps) {
    const update = useUpdateTransaction();
    const [date, setDate] = useState("");
    const [fromId, setFromId] = useState("");
    const [toId, setToId] = useState("");
    const [fromAmt, setFromAmt] = useState("");
    const [toAmt, setToAmt] = useState("");
    const [note, setNote] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open || !tx) return;
        setDate(tx.date);
        setFromId(tx.from_account_id);
        setToId(tx.to_account_id);
        setFromAmt(String(tx.from_amount));
        setToAmt(String(tx.to_amount));
        setNote(tx.note ?? "");
        setSubmitting(false);
        setError(null);
    }, [open, tx?.id]);

    // ВСЕ хуки до early-return (React rules of hooks #310).
    const fromAcc = accounts.find(a => a.id === fromId);
    const toAcc = accounts.find(a => a.id === toId);
    const numFrom = parseFloat(fromAmt);
    const numTo = parseFloat(toAmt);
    const rateText = useMemo(
        () => (tx?.type === "exchange" && fromAcc && toAcc) ? formatExchangeRate(numFrom, fromAcc.currency, numTo, toAcc.currency) : null,
        [tx?.type, fromAcc, toAcc, numFrom, numTo],
    );

    if (!tx) return null;

    const inChain = tx.chain_id != null;
    const sameBucket = fromId === toId;
    const valid = !!date && !!fromId && !!toId && !sameBucket
        && Number.isFinite(numFrom) && numFrom > 0
        && Number.isFinite(numTo) && numTo > 0
        && fromAcc && toAcc
        && (tx.type === "transfer" ? fromAcc.currency === toAcc.currency && numFrom === numTo : fromAcc.currency !== toAcc.currency);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!valid) return;
        setSubmitting(true);
        setError(null);
        try {
            const patch: TransactionUpdatePayload = {
                note: note.trim() || null,
            };
            if (!inChain) {
                if (date !== tx.date) patch.date = date;
                if (fromId !== tx.from_account_id) patch.from_account_id = fromId;
                if (toId !== tx.to_account_id) patch.to_account_id = toId;
                if (numFrom !== tx.from_amount) patch.from_amount = numFrom;
                if (numTo !== tx.to_amount) patch.to_amount = numTo;
            }
            await update.mutateAsync({ id: tx.id, patch });
            onClose();
        } catch (err: any) {
            setError(err?.message ?? "Не удалось сохранить — посмотри консоль");
            // Также логируем в консоль для отладки.
            console.error("EditTxModal submit failed:", err);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal open={open} onClose={onClose} title={`Редактировать ${tx.type === "exchange" ? "обмен" : "перевод"}`} size="md">
            <form onSubmit={submit} className="space-y-4">
                {inChain && (
                    <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-lg p-3">
                        Транзакция в цепочке — структурные поля (дата, вёдра, суммы) заблокированы. Чтобы их менять, удали цепочку и создай заново.
                    </div>
                )}

                <Field label="Дата">
                    <input type="date" value={date} onChange={e => setDate(e.target.value)} disabled={inChain}
                        className="px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50" />
                </Field>

                <Field label="Откуда">
                    <Select fullWidth value={fromId} onChange={e => setFromId(e.target.value)} disabled={inChain}>
                        {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </Select>
                    <input type="number" inputMode="decimal" step="any" min="0"
                        value={fromAmt} onChange={e => setFromAmt(e.target.value)} disabled={inChain}
                        className="mt-2 w-full px-3 py-2 rounded-lg border bg-background text-base tabular-nums focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                </Field>

                <Field label="Куда">
                    <Select fullWidth value={toId} onChange={e => setToId(e.target.value)} disabled={inChain}>
                        {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </Select>
                    <input type="number" inputMode="decimal" step="any" min="0"
                        value={toAmt} onChange={e => setToAmt(e.target.value)} disabled={inChain}
                        className="mt-2 w-full px-3 py-2 rounded-lg border bg-background text-base tabular-nums focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                </Field>

                {rateText && (
                    <div className="text-sm text-muted-foreground bg-secondary/40 rounded-lg p-3 tabular-nums">
                        💱 Курс: <span className="text-foreground font-medium">{rateText}</span>
                    </div>
                )}

                <Field label="Заметка">
                    <input type="text" value={note} onChange={e => setNote(e.target.value)} maxLength={500}
                        className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                </Field>

                {error && (
                    <div className="text-sm rounded-lg p-3 border border-destructive/40 bg-destructive/10 text-destructive">
                        {error}
                    </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                    <button type="button" onClick={onClose} className="btn-ghost px-4 py-2">Отмена</button>
                    <button type="submit" disabled={!valid || submitting} className="btn-primary px-4 py-2 min-w-[7rem]">
                        {submitting ? "…" : "Сохранить"}
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
