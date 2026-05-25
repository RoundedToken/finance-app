import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Plus, ArrowRightLeft, Repeat, Link2, Trash2, Search } from "lucide-react";
import {
    useAccounts,
    useChainFrom,
    useCreateChain,
    useCreateTransaction,
    useDeleteTransaction,
    useTransactions,
} from "@/api/queries";
import { Currency } from "@/components/Currency";
import { Select } from "@/components/Select";
import { Modal } from "@/components/Modal";
import { GoalSelector } from "@/components/GoalSelector";
import { PeriodPicker, DEFAULT_PERIOD, computeRange, type PeriodValue } from "@/components/PeriodPicker";
import { cn, formatAmount, formatDate, formatExchangeRate } from "@/lib/utils";
import type { Account, ChainStepPayload, Transaction, TransactionCreatePayload, TransactionType } from "@/api/types";

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
    const [chainOpen, setChainOpen] = useState(false);
    const [continueFromTx, setContinueFromTx] = useState<Transaction | null>(null);

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
                    <button onClick={() => setChainOpen(true)} className="btn-ghost px-3 py-2 text-sm border">
                        <Link2 className="h-4 w-4" /> Цепочка
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
                            {filtered.map(tx => <TxRow key={tx.id} tx={tx} accounts={accounts} onContinue={setContinueFromTx} />)}
                        </tbody>
                    </table>
                </div>
            </div>

            <ExchangeModal open={exchangeOpen} onClose={() => setExchangeOpen(false)} accounts={accounts} />
            <TransferModal open={transferOpen} onClose={() => setTransferOpen(false)} accounts={accounts} />
            <ChainModal open={chainOpen} onClose={() => setChainOpen(false)} accounts={accounts} />
            <ChainContinueModal open={!!continueFromTx} onClose={() => setContinueFromTx(null)} source={continueFromTx} accounts={accounts} />
        </div>
    );
}

function TxRow({ tx, accounts, onContinue }: { tx: Transaction; accounts: Account[]; onContinue: (tx: Transaction) => void }) {
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
                    {tx.chain_id && (
                        <Link to="/chains/$chainId" params={{ chainId: tx.chain_id }} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                            <Link2 className="h-3 w-3" /> {tx.chain_id.slice(0, 8)} · {tx.chain_sequence}
                        </Link>
                    )}
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
                <button onClick={() => onContinue(tx)} className="btn-icon" aria-label="Продолжить цепочку" title="Продолжить цепочку">
                    <Link2 className="h-4 w-4" />
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
    const [goalId, setGoalId] = useState("");
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!open) return;
        setDate(todayISO()); setFromId(accounts[0]?.id ?? ""); setToId(accounts[1]?.id ?? "");
        setFromAmt(""); setToAmt(""); setNote(""); setGoalId(""); setSubmitting(false);
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
                goal_id: goalId || null,
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

                <Field label="Цель (опц.)">
                    <GoalSelector value={goalId} onChange={setGoalId} />
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
    const [goalId, setGoalId] = useState("");
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!open) return;
        setDate(todayISO()); setFromId(""); setToId(""); setAmount(""); setNote(""); setGoalId(""); setSubmitting(false);
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
                goal_id: goalId || null,
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

                <Field label="Цель (опц.)">
                    <GoalSelector value={goalId} onChange={setGoalId} />
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

// ── Chain builder modal ────────────────────────────────────────────────────

interface ChainStepState extends ChainStepPayload {
    fromAmtStr: string;
    toAmtStr: string;
}

function ChainModal({ open, onClose, accounts }: ModalCommonProps) {
    const create = useCreateChain();
    const [date, setDate] = useState(todayISO());
    const [note, setNote] = useState("");
    const [goalId, setGoalId] = useState("");
    const [steps, setSteps] = useState<ChainStepState[]>([]);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!open) return;
        setDate(todayISO()); setNote(""); setGoalId(""); setSubmitting(false);
        setSteps([
            { type: "exchange", from_account_id: "", to_account_id: "", from_amount: 0, to_amount: 0, fromAmtStr: "", toAmtStr: "" },
            { type: "exchange", from_account_id: "", to_account_id: "", from_amount: 0, to_amount: 0, fromAmtStr: "", toAmtStr: "" },
        ]);
    }, [open]);

    const updateStep = (i: number, patch: Partial<ChainStepState>) => {
        setSteps(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s));
    };
    const addStep = () => {
        const last = steps[steps.length - 1];
        setSteps([...steps, {
            type: "exchange",
            from_account_id: last?.to_account_id ?? "",
            to_account_id: "",
            from_amount: 0, to_amount: 0,
            fromAmtStr: "", toAmtStr: "",
        }]);
    };
    const removeStep = (i: number) => {
        if (steps.length <= 2) return;
        setSteps(prev => prev.filter((_, idx) => idx !== i));
    };

    const stepDetails = steps.map(s => {
        const from = accounts.find(a => a.id === s.from_account_id);
        const to = accounts.find(a => a.id === s.to_account_id);
        const fromAmt = parseFloat(s.fromAmtStr);
        const toAmt = parseFloat(s.toAmtStr);
        return { ...s, from, to, fromAmt, toAmt };
    });

    const sequenceOK = stepDetails.every((s, i) => i === 0 || s.from_account_id === stepDetails[i - 1].to_account_id);
    const stepsValid = stepDetails.every(s => s.from && s.to && s.from_account_id !== s.to_account_id
        && Number.isFinite(s.fromAmt) && s.fromAmt > 0
        && Number.isFinite(s.toAmt) && s.toAmt > 0
        && (s.type === "transfer" ? s.from.currency === s.to.currency : s.from.currency !== s.to.currency));
    const valid = steps.length >= 2 && stepsValid && sequenceOK && !!date;

    const first = stepDetails[0];
    const last = stepDetails[stepDetails.length - 1];
    const effectiveText = first?.from && last?.to
        ? formatExchangeRate(first.fromAmt, first.from.currency, last.toAmt, last.to.currency)
        : null;

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!valid) return;
        setSubmitting(true);
        try {
            await create.mutateAsync({
                date,
                note: note.trim() || null,
                goal_id: goalId || null,
                steps: stepDetails.map(s => ({
                    type: s.type,
                    from_account_id: s.from_account_id,
                    to_account_id: s.to_account_id,
                    from_amount: s.fromAmt,
                    to_amount: s.toAmt,
                })),
            });
            onClose();
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal open={open} onClose={onClose} title="Новая цепочка" size="lg">
            <form onSubmit={submit} className="space-y-4">
                <Field label="Дата">
                    <input type="date" value={date} onChange={e => setDate(e.target.value)}
                        className="px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                </Field>

                <div className="space-y-3">
                    {stepDetails.map((s, i) => (
                        <div key={i} className="rounded-xl border p-3 space-y-2 bg-background/40">
                            <div className="flex items-center justify-between text-sm font-medium">
                                <span>Звено {i + 1}</span>
                                {steps.length > 2 && (
                                    <button type="button" onClick={() => removeStep(i)} className="btn-icon text-destructive" aria-label="Удалить звено">
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <Select fullWidth value={s.from_account_id} onChange={e => updateStep(i, { from_account_id: e.target.value })}>
                                    <option value="">— откуда —</option>
                                    {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                                </Select>
                                <Select fullWidth value={s.to_account_id} onChange={e => updateStep(i, { to_account_id: e.target.value })}>
                                    <option value="">— куда —</option>
                                    {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                                </Select>
                                <input type="number" inputMode="decimal" step="any" min="0"
                                    value={s.fromAmtStr} onChange={e => updateStep(i, { fromAmtStr: e.target.value, from_amount: parseFloat(e.target.value) || 0 })}
                                    placeholder={s.from ? s.from.currency : "сумма"}
                                    className="w-full px-3 py-2 rounded-lg border bg-background text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                                <input type="number" inputMode="decimal" step="any" min="0"
                                    value={s.toAmtStr} onChange={e => updateStep(i, { toAmtStr: e.target.value, to_amount: parseFloat(e.target.value) || 0 })}
                                    placeholder={s.to ? s.to.currency : "сумма"}
                                    className="w-full px-3 py-2 rounded-lg border bg-background text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                            </div>
                            {i > 0 && s.from_account_id && s.from_account_id !== stepDetails[i - 1].to_account_id && (
                                <div className="text-xs text-amber-600 dark:text-amber-400">
                                    «Откуда» этого звена должно совпадать с «Куда» предыдущего.
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                <button type="button" onClick={addStep} className="btn-ghost px-3 py-2 border border-dashed w-full text-sm">
                    <Plus className="h-4 w-4" /> Добавить звено
                </button>

                {effectiveText && first?.from && last?.to && (
                    <div className="rounded-xl border p-3 bg-secondary/40 text-sm">
                        <div className="text-muted-foreground mb-1">Итого по цепочке:</div>
                        <div className="num tabular-nums">
                            {formatAmount(first.fromAmt, first.from.currency)} <Currency code={first.from.currency} size="xs" />
                            {" → "}
                            {formatAmount(last.toAmt, last.to.currency)} <Currency code={last.to.currency} size="xs" />
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">Эффективный курс: {effectiveText}</div>
                    </div>
                )}

                <Field label="Заметка (опц.)">
                    <input type="text" value={note} onChange={e => setNote(e.target.value)} maxLength={500}
                        placeholder="напр. конвертация под ипотеку"
                        className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                </Field>

                <Field label="Цель (опц.)">
                    <GoalSelector value={goalId} onChange={setGoalId} />
                </Field>

                <div className="flex justify-end gap-2 pt-2">
                    <button type="button" onClick={onClose} className="btn-ghost px-4 py-2">Отмена</button>
                    <button type="submit" disabled={!valid || submitting} className="btn-primary px-4 py-2 min-w-[8rem]">
                        {submitting ? "…" : "Создать цепочку"}
                    </button>
                </div>
            </form>
        </Modal>
    );
}

// ── Continue-chain modal (SPEC-009 уровень 3) ──────────────────────────────

interface ContinueModalProps { open: boolean; onClose: () => void; source: Transaction | null; accounts: Account[] }
function ChainContinueModal({ open, onClose, source, accounts }: ContinueModalProps) {
    const chainFrom = useChainFrom();
    const [date, setDate] = useState(todayISO());
    const [toId, setToId] = useState("");
    const [toAmt, setToAmt] = useState("");
    const [type, setType] = useState<TransactionType>("exchange");
    const [note, setNote] = useState("");
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!open || !source) return;
        setDate(todayISO()); setToId(""); setToAmt(""); setType("exchange"); setNote(""); setSubmitting(false);
    }, [open, source?.id]);

    if (!source) return null;

    const fromAcc = accounts.find(a => a.id === source.to_account_id);
    const toAcc = accounts.find(a => a.id === toId);
    const numTo = parseFloat(toAmt);
    const sameBucket = toId === source.to_account_id;
    const sameCurrency = fromAcc && toAcc && fromAcc.currency === toAcc.currency;
    const valid = !!date && !!toId && !sameBucket && Number.isFinite(numTo) && numTo > 0
        && fromAcc && toAcc
        && (type === "transfer" ? sameCurrency : !sameCurrency);

    const rateText = useMemo(() => {
        if (!fromAcc || !toAcc || type === "transfer") return null;
        return formatExchangeRate(source.to_amount, fromAcc.currency, numTo, toAcc.currency);
    }, [fromAcc, toAcc, source.to_amount, numTo, type]);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!valid) return;
        setSubmitting(true);
        try {
            await chainFrom.mutateAsync({
                sourceId: source.id,
                payload: {
                    date,
                    note: note.trim() || null,
                    next_step: {
                        type,
                        to_account_id: toId,
                        to_amount: numTo,
                    },
                },
            });
            onClose();
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal open={open} onClose={onClose} title="Продолжить цепочку" size="md">
            <form onSubmit={submit} className="space-y-4">
                <div className="rounded-xl border p-3 bg-secondary/40">
                    <div className="text-xs text-muted-foreground mb-1">Существующее звено · {formatDate(source.date)}</div>
                    <div className="text-sm num tabular-nums">
                        {accounts.find(a => a.id === source.from_account_id)?.name ?? source.from_account_id} →
                        {" "}{fromAcc?.name ?? source.to_account_id}
                    </div>
                    <div className="text-sm num tabular-nums mt-1">
                        {formatAmount(source.from_amount, source.from_currency)} <Currency code={source.from_currency} size="xs" />
                        {" → "}
                        {formatAmount(source.to_amount, source.to_currency)} <Currency code={source.to_currency} size="xs" />
                    </div>
                </div>

                <Field label="Дата">
                    <input type="date" value={date} onChange={e => setDate(e.target.value)}
                        className="px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                </Field>

                <Field label="Тип">
                    <Select fullWidth value={type} onChange={e => setType(e.target.value as TransactionType)}>
                        <option value="exchange">💱 обмен (разные валюты)</option>
                        <option value="transfer">↔ перевод (та же валюта)</option>
                    </Select>
                </Field>

                <Field label={`Куда (из ${fromAcc?.name ?? source.to_account_id}, ${formatAmount(source.to_amount, source.to_currency)} ${source.to_currency})`}>
                    <Select fullWidth value={toId} onChange={e => setToId(e.target.value)}>
                        <option value="">— выбери ведро —</option>
                        {accounts.filter(a => a.id !== source.to_account_id).map(a => (
                            <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                    </Select>
                    <input
                        type="number" inputMode="decimal" step="any" min="0"
                        value={toAmt} onChange={e => setToAmt(e.target.value)}
                        placeholder={toAcc ? `сумма в ${toAcc.currency}` : "сумма"}
                        className="mt-2 w-full px-3 py-2 rounded-lg border bg-background text-base tabular-nums focus:outline-none focus:ring-2 focus:ring-ring [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                </Field>

                {rateText && type === "exchange" && (
                    <div className="text-sm text-muted-foreground bg-secondary/40 rounded-lg p-3 tabular-nums">
                        💱 Курс: <span className="text-foreground font-medium">{rateText}</span>
                    </div>
                )}

                {source.goal_id && (
                    <div className="text-xs text-muted-foreground bg-primary/10 rounded-lg p-3">
                        🎯 Цепочка наследует цель исходного звена.
                    </div>
                )}

                <Field label="Заметка (опц.)">
                    <input type="text" value={note} onChange={e => setNote(e.target.value)} maxLength={500}
                        placeholder="что-нибудь характерное"
                        className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                </Field>

                <div className="flex justify-end gap-2 pt-2">
                    <button type="button" onClick={onClose} className="btn-ghost px-4 py-2">Отмена</button>
                    <button type="submit" disabled={!valid || submitting} className="btn-primary px-4 py-2 min-w-[8rem]">
                        {submitting ? "…" : "Продолжить"}
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
