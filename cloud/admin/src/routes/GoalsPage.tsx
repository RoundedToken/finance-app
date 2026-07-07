import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Plus, Target, AlertCircle, Calendar } from "lucide-react";
import { useCreateGoal, useGoals, useReferences, useUpdateGoal } from "@/api/queries";
import { ErrorState } from "@/components/ErrorState";
import { Currency } from "@/components/Currency";
import { Select } from "@/components/Select";
import { Modal } from "@/components/Modal";
import { cn, formatAmount, formatDate, todayLocal, useDraftId } from "@/lib/utils";
import type { Goal, GoalCreatePayload, GoalStatus, GoalUpdatePayload } from "@/api/types";

const STATUS_TABS: { value: GoalStatus; label: string }[] = [
    { value: "active",   label: "Активные" },
    { value: "achieved", label: "Достигнутые" },
    { value: "archived", label: "Архив" },
];

export const COLOR_PALETTE = [
    "#a78bfa", "#34d399", "#fbbf24", "#fb7185",
    "#22d3ee", "#f472b6", "#60a5fa", "#fdba74",
];

export const EMOJI_SUGGESTIONS = ["🎯", "🏠", "✈️", "🛡️", "💍", "🚗", "🎓", "🏖️", "💼", "🩺"];

export function GoalsPage() {
    const [status, setStatus] = useState<GoalStatus>("active");
    const { data, isLoading, isError, refetch } = useGoals(status);
    const goals = data?.goals ?? [];
    const [modalOpen, setModalOpen] = useState(false);

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-semibold tracking-tight">Цели</h1>
                    <p className="text-muted-foreground mt-1">
                        Деньги, отложенные на конкретное намерение. Доходы и ручные пополнения собираются в фонд.
                    </p>
                </div>
                <button onClick={() => setModalOpen(true)} className="btn-primary px-4 py-2 self-start">
                    <Plus className="h-4 w-4" /> Новая цель
                </button>
            </div>

            <div className="grid grid-cols-3 gap-1 p-1 bg-secondary/60 rounded-xl max-w-md">
                {STATUS_TABS.map(tab => {
                    const active = tab.value === status;
                    return (
                        <button
                            key={tab.value}
                            type="button"
                            aria-pressed={active}
                            onClick={() => setStatus(tab.value)}
                            className={cn(
                                "py-1.5 px-2 rounded-lg text-xs font-medium transition-colors",
                                active
                                    ? "bg-primary text-primary-foreground shadow-sm"
                                    : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                            )}
                        >
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            {isError ? (
                <ErrorState onRetry={() => refetch()} label="Не удалось загрузить цели" />
            ) : isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="card p-6 h-48 animate-pulse bg-muted/40"></div>
                    ))}
                </div>
            ) : goals.length === 0 ? (
                <div className="card p-12 text-center">
                    <Target className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                    <p className="text-muted-foreground">
                        {status === "active" && "Целей пока нет. Заведи первую — кнопкой выше."}
                        {status === "achieved" && "Достигнутых целей пока нет."}
                        {status === "archived" && "Архив пуст."}
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {goals.map(g => <GoalCard key={g.id} goal={g} />)}
                </div>
            )}

            <GoalCreateModal open={modalOpen} onClose={() => setModalOpen(false)} />
        </div>
    );
}

function GoalCard({ goal }: { goal: Goal }) {
    const ccy = goal.target_currency;
    const needsCurrency = !ccy;
    const color = goal.color ?? "#94a3b8";
    const hasTarget = goal.target_amount != null && goal.target_amount > 0 && !!ccy;
    const percent = hasTarget ? Math.min(100, (goal.balance / goal.target_amount!) * 100) : null;
    const overdue = goal.deadline && goal.deadline < todayLocal() && goal.status === "active";

    return (
        <Link
            to="/goals/$goalId"
            params={{ goalId: goal.id }}
            className="card p-5 block transition-all hover:bg-card/80 hover:border-primary/40"
        >
            <div className="flex items-start gap-3">
                <div
                    className="h-11 w-11 rounded-xl grid place-items-center text-xl"
                    style={{ background: color + "22", color }}
                >
                    {goal.emoji ?? <Target className="h-5 w-5" />}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="font-medium leading-tight truncate" title={goal.name}>{goal.name}</div>
                    {goal.note && <div className="text-xs text-muted-foreground mt-0.5 truncate" title={goal.note}>{goal.note}</div>}
                </div>
            </div>

            {needsCurrency ? (
                <div className="mt-4 flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
                    <span>Не задана валюта цели — открой редактирование и выбери валюту.</span>
                </div>
            ) : hasTarget ? (
                <div className="mt-4 space-y-1.5">
                    <div className="flex items-baseline justify-between text-sm tabular-nums">
                        <span className="num font-medium">
                            {formatAmount(goal.balance, ccy!)} <span className="text-muted-foreground">/ {formatAmount(goal.target_amount!, ccy!)}</span>
                            {" "}<Currency code={ccy!} size="xs" />
                        </span>
                        <span className="text-xs text-muted-foreground">{percent!.toFixed(1)}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-secondary/60 overflow-hidden">
                        <div
                            className="h-full rounded-full transition-[width] duration-500"
                            style={{ width: `${Math.max(2, percent!)}%`, background: color }}
                        />
                    </div>
                </div>
            ) : (
                <div className="mt-4 text-xl font-semibold num tabular-nums">
                    {formatAmount(goal.balance, ccy!)} <Currency code={ccy!} size="sm" />
                </div>
            )}

            <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                {goal.deadline ? (
                    <span className={cn("inline-flex items-center gap-1", overdue && "text-destructive")}>
                        {overdue && <AlertCircle className="h-3 w-3" />}
                        {!overdue && <Calendar className="h-3 w-3" />}
                        до {formatDate(goal.deadline)}
                    </span>
                ) : (
                    <span>без срока</span>
                )}
                <span>·</span>
                <span>{goal.contribution_count} {pluralizeContrib(goal.contribution_count)}</span>
                {goal.balance_missing_rates > 0 && (
                    <>
                        <span>·</span>
                        <span className="text-amber-600 dark:text-amber-400">{goal.balance_missing_rates} без курса</span>
                    </>
                )}
            </div>
        </Link>
    );
}

function pluralizeContrib(n: number): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return "пополнение";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "пополнения";
    return "пополнений";
}

function GoalCreateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const create = useCreateGoal();
    return (
        <GoalFormModal
            open={open}
            onClose={onClose}
            title="Новая цель"
            initial={null}
            onSubmit={async (payload) => { await create.mutateAsync(payload as GoalCreatePayload); }}
        />
    );
}

export function GoalEditModal({ open, onClose, goal }: { open: boolean; onClose: () => void; goal: Goal | null }) {
    const update = useUpdateGoal();
    if (!goal) return null;
    return (
        <GoalFormModal
            open={open}
            onClose={onClose}
            title="Редактировать цель"
            initial={goal}
            onSubmit={async (payload) => { await update.mutateAsync({ id: goal.id, patch: payload as GoalUpdatePayload }); }}
        />
    );
}

interface GoalFormProps {
    open: boolean;
    onClose: () => void;
    title: string;
    initial: Goal | null;
    onSubmit: (payload: GoalCreatePayload | GoalUpdatePayload) => Promise<void>;
}

function GoalFormModal({ open, onClose, title, initial, onSubmit }: GoalFormProps) {
    const { data: refs } = useReferences();
    const draftId = useDraftId(open && !initial);   // ADM-02 (SPEC-044): id create-записи на одно открытие формы

    const [name, setName] = useState("");
    const [emoji, setEmoji] = useState("🎯");
    const [color, setColor] = useState(COLOR_PALETTE[0]);
    const [targetAmount, setTargetAmount] = useState("");
    const [targetCurrency, setTargetCurrency] = useState("EUR");
    const [deadline, setDeadline] = useState("");
    const [note, setNote] = useState("");
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!open) return;
        setName(initial?.name ?? "");
        setEmoji(initial?.emoji ?? "🎯");
        setColor(initial?.color ?? COLOR_PALETTE[0]);
        setTargetAmount(initial?.target_amount != null ? String(initial.target_amount) : "");
        setTargetCurrency(initial?.target_currency ?? "EUR");
        setDeadline(initial?.deadline ?? "");
        setNote(initial?.note ?? "");
        setSubmitting(false);
    }, [open, initial?.id]);

    const currencies = refs?.currencies ?? [];
    const hasTarget = targetAmount.trim() !== "";
    const numTarget = parseFloat(targetAmount);
    const valid = name.trim().length > 0
        && !!targetCurrency
        && (!hasTarget || (Number.isFinite(numTarget) && numTarget > 0));

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!valid) return;
        setSubmitting(true);
        try {
            const payload = {
                ...(initial ? {} : { id: draftId }),   // ADM-02: только create, не PUT
                name: name.trim(),
                emoji: emoji.trim() || null,
                color,
                target_amount: hasTarget ? numTarget : null,
                target_currency: targetCurrency,    // обязательно даже без target_amount
                deadline: deadline || null,
                note: note.trim() || null,
            };
            await onSubmit(payload);
            onClose();
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal open={open} onClose={onClose} title={title} size="md">
            <form onSubmit={submit} className="space-y-5">
                {/* Live preview карточки — пользователь сразу видит как будет выглядеть */}
                <div
                    className="flex items-center gap-3 rounded-xl border bg-background/40 p-3"
                    style={{ borderColor: color + "55" }}
                >
                    <div
                        className="h-12 w-12 rounded-xl grid place-items-center text-2xl shrink-0"
                        style={{ background: color + "22", color }}
                    >
                        {emoji || "🎯"}
                    </div>
                    <div className="min-w-0">
                        <div className="font-medium truncate">{name.trim() || "Без названия"}</div>
                        <div className="text-xs text-muted-foreground truncate">
                            {note.trim() || "превью карточки"}
                        </div>
                    </div>
                </div>

                <Field label="Название">
                    <input
                        type="text"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        maxLength={120}
                        autoFocus
                        placeholder="напр. Стартовый депозит"
                        className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                </Field>

                <Field label="Эмодзи и цвет">
                    <div className="flex items-center gap-2">
                        <input
                            type="text"
                            value={emoji}
                            onChange={e => setEmoji(e.target.value)}
                            maxLength={4}
                            aria-label="Эмодзи"
                            className="w-14 h-10 px-2 rounded-lg border bg-background text-center text-xl focus:outline-none focus:ring-2 focus:ring-ring shrink-0"
                        />
                        <div className="flex flex-wrap gap-1 flex-1">
                            {EMOJI_SUGGESTIONS.map(em => (
                                <button
                                    key={em}
                                    type="button"
                                    onClick={() => setEmoji(em)}
                                    aria-label={`Выбрать ${em}`}
                                    className={cn(
                                        "h-8 w-8 rounded-md text-lg transition-colors",
                                        emoji === em ? "bg-primary/20" : "hover:bg-accent",
                                    )}
                                >
                                    {em}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 pt-2">
                        {COLOR_PALETTE.map(c => (
                            <button
                                key={c}
                                type="button"
                                aria-label={`Цвет ${c}`}
                                onClick={() => setColor(c)}
                                className={cn(
                                    "h-7 w-7 rounded-md transition-all",
                                    color === c
                                        ? "ring-2 ring-offset-2 ring-offset-card ring-foreground/70 scale-105"
                                        : "hover:scale-105",
                                )}
                                style={{ background: c }}
                            />
                        ))}
                    </div>
                </Field>

                <Field label="Валюта цели">
                    <Select
                        fullWidth
                        value={targetCurrency}
                        onChange={e => setTargetCurrency(e.target.value)}
                        aria-label="Валюта цели"
                    >
                        {currencies.map(c => <option key={c.code} value={c.code}>{c.emoji ?? ""} {c.code} — {c.name}</option>)}
                    </Select>
                </Field>

                <div className="grid grid-cols-2 gap-3">
                    <Field label="Целевая сумма (опц.)">
                        <input
                            type="number"
                            inputMode="decimal"
                            step="any"
                            min="0"
                            value={targetAmount}
                            onChange={e => setTargetAmount(e.target.value)}
                            placeholder="не задано"
                            className="w-full min-w-0 px-3 py-2 rounded-lg border bg-background text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        />
                    </Field>
                    <Field label="Дедлайн (опц.)">
                        <input
                            type="date"
                            value={deadline}
                            onChange={e => setDeadline(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                    </Field>
                </div>

                <Field label="Заметка (опц.)">
                    <textarea
                        value={note}
                        onChange={e => setNote(e.target.value)}
                        maxLength={500}
                        rows={2}
                        placeholder="напр. однушка в Белграде до конца 2027"
                        className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                    />
                </Field>

                <div className="flex justify-end gap-2 pt-2">
                    <button type="button" onClick={onClose} className="btn-ghost px-4 py-2">Отмена</button>
                    <button type="submit" disabled={!valid || submitting} className="btn-primary px-4 py-2 min-w-[7rem]">
                        {submitting ? "…" : (initial ? "Сохранить" : "Создать")}
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
