import { useEffect, useState } from "react";
import { Link, useParams, useRouter } from "@tanstack/react-router";
import { ArrowLeft, Plus, Trash2, MoreVertical, Calendar, AlertCircle, Pencil } from "lucide-react";
import { GoalEditModal } from "./GoalsPage";
import {
    useGoalDetail,
    useReferences,
    useAccounts,
    useDeleteGoal,
    useSetGoalStatus,
    useCreateContribution,
    useDeleteContribution,
} from "@/api/queries";
import { Currency } from "@/components/Currency";
import { Select } from "@/components/Select";
import { Modal } from "@/components/Modal";
import { cn, formatAmount, formatDate } from "@/lib/utils";
import type { ContributionCreatePayload, GoalContribution, GoalStatus } from "@/api/types";

const todayISO = () => new Date().toISOString().slice(0, 10);

export function GoalDetailPage() {
    const { goalId } = useParams({ strict: false }) as { goalId: string };
    const router = useRouter();
    const { data, isLoading } = useGoalDetail(goalId);
    const setStatus = useSetGoalStatus();
    const remove = useDeleteGoal();

    const [contribOpen, setContribOpen] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [editOpen, setEditOpen] = useState(false);

    // Закрытие меню по клику вне / Escape.
    useEffect(() => {
        if (!menuOpen) return;
        const onClick = (e: MouseEvent) => {
            if (!(e.target instanceof Element)) return;
            if (!e.target.closest("[data-goal-menu]")) setMenuOpen(false);
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
        document.addEventListener("click", onClick);
        document.addEventListener("keydown", onKey);
        return () => { document.removeEventListener("click", onClick); document.removeEventListener("keydown", onKey); };
    }, [menuOpen]);

    if (isLoading) {
        return <div className="card p-12 text-center text-muted-foreground">Загрузка…</div>;
    }
    if (!data?.goal) {
        return (
            <div className="card p-12 text-center space-y-3">
                <div className="text-muted-foreground">Цель не найдена</div>
                <Link to="/goals" className="btn-primary px-4 py-2 inline-flex">← К целям</Link>
            </div>
        );
    }

    const { goal, contributions } = data;
    const ccy = goal.target_currency;
    const needsCurrency = !ccy;
    const color = goal.color ?? "#94a3b8";
    const hasTarget = !!ccy && goal.target_amount != null && goal.target_amount > 0;
    const percent = hasTarget ? Math.min(100, (goal.balance / goal.target_amount!) * 100) : null;
    const overdue = goal.deadline && goal.deadline < todayISO() && goal.status === "active";
    const daysToDeadline = goal.deadline ? Math.round((new Date(goal.deadline).getTime() - Date.now()) / 86_400_000) : null;

    const handleStatus = async (newStatus: GoalStatus) => {
        setMenuOpen(false);
        await setStatus.mutateAsync({ id: goal.id, status: newStatus });
    };

    const handleDelete = async () => {
        if (!confirm(`Удалить цель «${goal.name}»?\nВсе доходы будут отвязаны, все ручные пополнения — удалены.`)) return;
        await remove.mutateAsync(goal.id);
        router.navigate({ to: "/goals" });
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-4">
                <Link to="/goals" className="btn-ghost px-3 py-2">
                    <ArrowLeft className="h-4 w-4" /> Цели
                </Link>
                <div className="flex items-center gap-1">
                    <button onClick={() => setEditOpen(true)} className="btn-icon" aria-label="Редактировать цель">
                        <Pencil className="h-4 w-4" />
                    </button>
                    <div className="relative" data-goal-menu>
                        <button onClick={() => setMenuOpen(o => !o)} className="btn-icon" aria-label="Меню" aria-haspopup="menu" aria-expanded={menuOpen}>
                            <MoreVertical className="h-4 w-4" />
                        </button>
                        {menuOpen && (
                            <div role="menu" className="absolute right-0 top-full mt-2 z-10 w-56 card p-1 shadow-lg">
                            {goal.status !== "achieved" && (
                                <button onClick={() => handleStatus("achieved")} className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-accent">
                                    ✓ Отметить достигнутой
                                </button>
                            )}
                            {goal.status !== "archived" && (
                                <button onClick={() => handleStatus("archived")} className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-accent">
                                    📦 В архив
                                </button>
                            )}
                            {goal.status !== "active" && (
                                <button onClick={() => handleStatus("active")} className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-accent">
                                    ↻ Снова активна
                                </button>
                            )}
                            <button onClick={handleDelete} className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-accent text-destructive">
                                <Trash2 className="h-4 w-4 inline mr-1" /> Удалить
                            </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="card p-6 space-y-4">
                <div className="flex items-start gap-4">
                    <div
                        className="h-14 w-14 rounded-2xl grid place-items-center text-3xl"
                        style={{ background: color + "22", color }}
                    >
                        {goal.emoji ?? "🎯"}
                    </div>
                    <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h1 className="text-2xl font-semibold tracking-tight">{goal.name}</h1>
                            {goal.status !== "active" && (
                                <span className={cn(
                                    "text-xs px-2 py-0.5 rounded-full",
                                    goal.status === "achieved" ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground",
                                )}>
                                    {goal.status === "achieved" ? "Достигнута" : "Архив"}
                                </span>
                            )}
                        </div>
                        {goal.note && <p className="text-muted-foreground mt-1">{goal.note}</p>}
                    </div>
                </div>

                {needsCurrency ? (
                    <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
                        <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-px" />
                        <div>
                            <div className="font-medium text-amber-700 dark:text-amber-300">Валюта цели не задана</div>
                            <div className="text-amber-700/80 dark:text-amber-200/80 mt-1">
                                Эта цель создана до того, как валюта стала обязательной. Открой <Pencil className="h-3 w-3 inline mb-0.5" /> редактирование и выбери валюту — пересчитаем баланс корректно.
                            </div>
                        </div>
                    </div>
                ) : hasTarget ? (
                    <div className="space-y-2">
                        <div className="flex items-baseline justify-between flex-wrap gap-2">
                            <div className="text-2xl font-semibold num tabular-nums">
                                {formatAmount(goal.balance, ccy!)} <span className="text-muted-foreground text-base">/ {formatAmount(goal.target_amount!, ccy!)}</span>{" "}
                                <Currency code={ccy!} size="sm" />
                            </div>
                            <div className="text-sm text-muted-foreground tabular-nums">{percent!.toFixed(1)}%</div>
                        </div>
                        <div className="h-3 rounded-full bg-secondary/60 overflow-hidden">
                            <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(2, percent!)}%`, background: color }} />
                        </div>
                    </div>
                ) : (
                    <div className="text-2xl font-semibold num tabular-nums">
                        {formatAmount(goal.balance, ccy!)} <Currency code={ccy!} size="sm" />
                    </div>
                )}

                <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                    {goal.deadline && (
                        <span className={cn("inline-flex items-center gap-1.5", overdue && "text-destructive")}>
                            {overdue ? <AlertCircle className="h-4 w-4" /> : <Calendar className="h-4 w-4" />}
                            до {formatDate(goal.deadline)}
                            {daysToDeadline !== null && (
                                <span>· {overdue ? `просрочено на ${Math.abs(daysToDeadline)} дн.` : `${daysToDeadline} дн. осталось`}</span>
                            )}
                        </span>
                    )}
                    <span>{goal.contribution_count} {pluralizeContrib(goal.contribution_count)}</span>
                    {goal.balance_missing_rates > 0 && (
                        <span className="text-amber-600 dark:text-amber-400">{goal.balance_missing_rates} без курса</span>
                    )}
                </div>
            </div>

            <div className="card overflow-hidden">
                <div className="flex items-center justify-between p-4 border-b">
                    <h2 className="font-medium">История пополнений</h2>
                    <button onClick={() => setContribOpen(true)} className="btn-primary px-3 py-1.5 text-sm">
                        <Plus className="h-4 w-4" /> Пополнить
                    </button>
                </div>

                {contributions.length === 0 ? (
                    <div className="px-4 py-12 text-center text-muted-foreground">
                        Пополнений пока нет. Привяжи доход или добавь вручную.
                    </div>
                ) : (
                    <table className="w-full text-sm">
                        <thead className="bg-secondary/30 border-b">
                            <tr>
                                <th className="text-left px-4 py-3 font-medium text-muted-foreground w-32">Дата</th>
                                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Источник</th>
                                <th className="text-right px-4 py-3 font-medium text-muted-foreground w-44">Сумма</th>
                                <th className="text-right px-4 py-3 font-medium text-muted-foreground w-32">Δ цели</th>
                                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Заметка</th>
                                <th className="px-4 py-3 w-20"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {contributions.map(c => <ContribRow key={`${c.source}-${c.id ?? c.transaction_id}`} contrib={c} targetCcy={ccy} />)}
                        </tbody>
                    </table>
                )}
            </div>

            <ContributionModal open={contribOpen} onClose={() => setContribOpen(false)} goalId={goal.id} defaultCurrency={ccy ?? "EUR"} />
            <GoalEditModal open={editOpen} onClose={() => setEditOpen(false)} goal={goal} />
        </div>
    );
}

function ContribRow({ contrib, targetCcy }: { contrib: GoalContribution; targetCcy: string | null }) {
    const remove = useDeleteContribution();
    const isManual = contrib.source === "manual";
    const isIncome = contrib.source === "income";
    const isTx = contrib.source === "exchange" || contrib.source === "transfer";

    const handleDelete = async () => {
        const label = isManual ? `${formatAmount(contrib.amount ?? 0, contrib.currency_code ?? "")} ${contrib.currency_code ?? ""}` : "";
        if (!confirm(`Удалить пополнение?\n${label} · ${formatDate(contrib.date)}`)) return;
        await remove.mutateAsync(contrib.id);
    };

    let sourceBadge: React.ReactNode;
    if (isIncome) sourceBadge = <Link to="/incomes" className="inline-flex items-center gap-1 hover:underline"><span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">income</span></Link>;
    else if (isManual) sourceBadge = <span className="text-xs px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">ручное</span>;
    else if (contrib.source === "exchange") sourceBadge = <Link to="/transactions" className="inline-flex items-center gap-1 hover:underline"><span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300">💱 обмен</span></Link>;
    else sourceBadge = <Link to="/transactions" className="inline-flex items-center gap-1 hover:underline"><span className="text-xs px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">↔ перевод</span></Link>;

    return (
        <tr className="border-b last:border-b-0 hover:bg-secondary/30 transition-colors">
            <td className="px-4 py-2.5 num text-muted-foreground whitespace-nowrap">{formatDate(contrib.date)}</td>
            <td className="px-4 py-2.5">
                <div className="flex flex-col gap-0.5">
                    {sourceBadge}
                    {contrib.chain_id && (
                        <span className="text-[10px] text-muted-foreground">🔗 {contrib.chain_id.slice(0, 8)} · {contrib.chain_sequence}</span>
                    )}
                </div>
            </td>
            <td className="px-4 py-2.5 text-right num font-medium tabular-nums whitespace-nowrap">
                {isTx ? (
                    <div className="text-xs">
                        <div className="text-destructive/90">−{formatAmount(contrib.from_amount ?? 0, contrib.from_currency ?? "")} <Currency code={contrib.from_currency} size="xs" /></div>
                        <div className="text-positive">+{formatAmount(contrib.to_amount ?? 0, contrib.to_currency ?? "")} <Currency code={contrib.to_currency} size="xs" /></div>
                    </div>
                ) : (
                    <span>{formatAmount(contrib.amount ?? 0, contrib.currency_code ?? "")} <Currency code={contrib.currency_code} /></span>
                )}
            </td>
            <td className="px-4 py-2.5 text-right num tabular-nums whitespace-nowrap">
                {contrib.delta_in_target != null && targetCcy ? (
                    <span className={cn("text-xs", contrib.delta_in_target < 0 ? "text-destructive" : contrib.delta_in_target > 0 ? "text-positive" : "text-muted-foreground")}>
                        {contrib.delta_in_target > 0 ? "+" : ""}{formatAmount(contrib.delta_in_target, targetCcy)} <Currency code={targetCcy} size="xs" />
                    </span>
                ) : (
                    <span className="text-muted-foreground">—</span>
                )}
            </td>
            <td className="px-4 py-2.5">
                {contrib.note ? <span>{contrib.note}</span> : <span className="text-muted-foreground italic">—</span>}
            </td>
            <td className="px-4 py-2.5 text-right whitespace-nowrap">
                {isManual && (
                    <button onClick={handleDelete} className="btn-icon text-destructive" aria-label="Удалить">
                        <Trash2 className="h-4 w-4" />
                    </button>
                )}
            </td>
        </tr>
    );
}

function pluralizeContrib(n: number): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return "пополнение";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "пополнения";
    return "пополнений";
}

interface ContributionModalProps { open: boolean; onClose: () => void; goalId: string; defaultCurrency: string }
function ContributionModal({ open, onClose, goalId, defaultCurrency }: ContributionModalProps) {
    const { data: refs } = useReferences();
    const { data: accountsData } = useAccounts();
    const create = useCreateContribution();

    const [date, setDate] = useState(todayISO());
    const [amount, setAmount] = useState("");
    const [currency, setCurrency] = useState(defaultCurrency);
    const [accountId, setAccountId] = useState("");
    const [note, setNote] = useState("");
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!open) return;
        setDate(todayISO()); setAmount(""); setCurrency(defaultCurrency);
        setAccountId(""); setNote(""); setSubmitting(false);
    }, [open, defaultCurrency]);

    const currencies = refs?.currencies ?? [];
    const accounts = accountsData?.accounts ?? [];
    const numAmount = parseFloat(amount);
    const valid = !!date && Number.isFinite(numAmount) && numAmount > 0 && !!currency;

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!valid) return;
        setSubmitting(true);
        try {
            const payload: ContributionCreatePayload = {
                goal_id: goalId,
                date,
                amount: numAmount,
                currency_code: currency,
                account_id: accountId || null,
                note: note.trim() || null,
            };
            await create.mutateAsync(payload);
            onClose();
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal open={open} onClose={onClose} title="Новое пополнение">
            <form onSubmit={submit} className="space-y-4">
                <Field label="Дата">
                    <input
                        type="date"
                        value={date}
                        onChange={e => setDate(e.target.value)}
                        className="px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                </Field>

                <div className="grid grid-cols-[1fr_auto] gap-3">
                    <Field label="Сумма">
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
                    </Field>
                    <Field label="Валюта">
                        <Select value={currency} onChange={e => setCurrency(e.target.value)}>
                            {currencies.map(c => <option key={c.code} value={c.code}>{c.emoji ?? ""} {c.code}</option>)}
                        </Select>
                    </Field>
                </div>

                <Field label="Из ведра (опц.)">
                    <Select fullWidth value={accountId} onChange={e => setAccountId(e.target.value)}>
                        <option value="">— не указано —</option>
                        {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </Select>
                </Field>

                <Field label="Заметка (опц.)">
                    <input
                        type="text"
                        value={note}
                        onChange={e => setNote(e.target.value)}
                        maxLength={500}
                        placeholder="напр. от родителей на новый год"
                        className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                </Field>

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
