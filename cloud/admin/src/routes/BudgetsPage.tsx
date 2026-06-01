import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Gauge, Trash2 } from "lucide-react";
import {
    useBudgets,
    useReferences,
    useCreateBudget,
    useUpdateBudget,
    useDeleteBudget,
} from "@/api/queries";
import { Modal } from "@/components/Modal";
import { Select } from "@/components/Select";
import { ErrorState } from "@/components/ErrorState";
import { useToast } from "@/components/Toast";
import { BudgetBar, BUDGET_STATUS_TEXT } from "@/components/BudgetBar";
import { RecommendationsSection, EnvelopesSection, ClassificationSection } from "@/components/AdaptiveBudgets";
import { formatAmount, cn } from "@/lib/utils";
import type {
    BudgetCategoryProgress,
    BudgetTotalProgress,
    Category,
} from "@/api/types";

const MONTHS_NOM = [
    "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
    "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
function monthLabel(ym: string): string {
    const [y, m] = ym.split("-").map(Number);
    return `${MONTHS_NOM[m - 1] ?? ""} ${y}`;
}

const eur = (x: number) => `${formatAmount(x, "EUR")} €`;

type ModalState =
    | { mode: "create-category"; categoryId?: string }   // categoryId — пред-выбор из «Без лимита»
    | { mode: "create-total" }
    | { mode: "edit"; budgetId: string; label: string; emoji: string | null; color: string | null; limit: number; isTotal: boolean }
    | null;

export function BudgetsPage() {
    const { data, isLoading, isError, refetch } = useBudgets();
    const refs = useReferences();
    const [modal, setModal] = useState<ModalState>(null);

    const total = data?.total ?? null;
    const cats = data?.categories ?? [];

    const unbudgeted = useMemo(() => {
        const budgeted = new Set(cats.map(c => c.category_id));
        return (refs.data?.categories ?? [])
            .filter(c => c.type === "expense" && c.is_active && !budgeted.has(c.id))
            .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    }, [refs.data?.categories, cats]);

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-semibold tracking-tight">Бюджеты</h1>
                    <p className="text-muted-foreground mt-1">
                        Месячные лимиты трат по категориям в EUR{data?.month ? ` · ${monthLabel(data.month)}` : ""}. Сколько ещё можно потратить в этом месяце.
                    </p>
                </div>
                <button
                    onClick={() => setModal({ mode: "create-category" })}
                    disabled={unbudgeted.length === 0}
                    className="btn-primary px-4 py-2 self-start disabled:opacity-50"
                    title={unbudgeted.length === 0 ? "У всех активных категорий уже есть лимит" : undefined}
                >
                    <Plus className="h-4 w-4" /> Бюджет
                </button>
            </div>

            {isLoading && (
                <div className="space-y-2">
                    {Array.from({ length: 5 }).map((_, i) => <div key={i} className="card h-16 animate-pulse bg-muted/40" />)}
                </div>
            )}

            {isError && <ErrorState onRetry={() => refetch()} label="Не удалось загрузить бюджеты" />}

            {!isLoading && !isError && (
                <>
                    {/* SPEC-023: рекомендации адаптивного лимита (advisory) */}
                    <RecommendationsSection />

                    {/* Общий месячный потолок */}
                    {total ? (
                        <TotalCard total={total} onEdit={() => setModal({
                            mode: "edit", budgetId: total.budget_id, label: "Общий потолок",
                            emoji: "🧮", color: null, limit: total.limit_eur, isTotal: true,
                        })} />
                    ) : (
                        <button
                            onClick={() => setModal({ mode: "create-total" })}
                            className="card w-full p-4 flex items-center gap-3 text-left hover:bg-secondary/30 transition-colors border-dashed"
                        >
                            <div className="h-9 w-9 rounded-lg grid place-items-center bg-secondary/60 text-muted-foreground shrink-0"><Gauge className="h-5 w-5" /></div>
                            <div>
                                <div className="font-medium">Задать общий потолок</div>
                                <div className="text-sm text-muted-foreground">Один лимит на все траты за месяц</div>
                            </div>
                        </button>
                    )}

                    {/* Категорийные бюджеты */}
                    {cats.length === 0 ? (
                        <div className="card p-8 text-center text-muted-foreground text-sm">
                            <Gauge className="h-8 w-8 mx-auto mb-2 opacity-50" />
                            Бюджеты по категориям не заданы — установите лимит кнопкой «Бюджет».
                        </div>
                    ) : (
                        <div className="card divide-y overflow-hidden">
                            {cats.map(c => (
                                <CategoryRow
                                    key={c.budget_id} b={c}
                                    onEdit={() => setModal({
                                        mode: "edit", budgetId: c.budget_id, label: c.name,
                                        emoji: c.emoji, color: c.color, limit: c.limit_eur, isTotal: false,
                                    })}
                                />
                            ))}
                        </div>
                    )}

                    {/* SPEC-023: накопительные конверты для lumpy-категорий */}
                    <EnvelopesSection />

                    {/* Категории без лимита */}
                    {unbudgeted.length > 0 && (
                        <div>
                            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Без лимита</div>
                            <div className="flex flex-wrap gap-2">
                                {unbudgeted.map(c => (
                                    <button
                                        key={c.id}
                                        onClick={() => setModal({ mode: "create-category", categoryId: c.id })}
                                        className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm hover:bg-secondary/40 transition-colors"
                                        style={{ borderColor: (c.color ?? "#94a3b8") + "55" }}
                                    >
                                        <span>{c.emoji ?? "📁"}</span>
                                        <span className="text-muted-foreground">{c.name}</span>
                                        <Plus className="h-3.5 w-3.5 opacity-60" />
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* SPEC-023: классификация архетипов + override */}
                    <ClassificationSection />
                </>
            )}

            <BudgetModal state={modal} onClose={() => setModal(null)} unbudgeted={unbudgeted} />
        </div>
    );
}

// ── Total cap card ───────────────────────────────────────────────────────────
function TotalCard({ total, onEdit }: { total: BudgetTotalProgress; onEdit: () => void }) {
    const overBy = total.remaining_eur < 0 ? -total.remaining_eur : 0;
    return (
        <div className="card p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                    <div className="h-9 w-9 rounded-lg grid place-items-center bg-secondary/60 text-foreground shrink-0"><Gauge className="h-5 w-5" /></div>
                    <div className="min-w-0">
                        <div className="font-medium">Общий потолок</div>
                        <div className="text-sm text-muted-foreground">
                            {eur(total.spent_eur)} из {eur(total.limit_eur)}
                            {total.missing_rates > 0 && <span className="text-amber-500"> · {total.missing_rates} без курса</span>}
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                        <div className={cn("font-semibold tabular-nums", BUDGET_STATUS_TEXT[total.status])}>
                            {overBy > 0 ? `−${eur(overBy)}` : eur(total.remaining_eur)}
                        </div>
                        <div className="text-xs text-muted-foreground">{overBy > 0 ? "сверх лимита" : "осталось"} · {total.pct}%</div>
                    </div>
                    <button onClick={onEdit} aria-label="Редактировать" className="p-1.5 rounded-md hover:bg-accent text-muted-foreground"><Pencil className="h-4 w-4" /></button>
                </div>
            </div>
            <BudgetBar pct={total.pct} status={total.status} height="h-3" />
        </div>
    );
}

// ── Category budget row ──────────────────────────────────────────────────────
function CategoryRow({ b, onEdit }: { b: BudgetCategoryProgress; onEdit: () => void }) {
    const color = b.color ?? "#94a3b8";
    const overBy = b.remaining_eur < 0 ? -b.remaining_eur : 0;
    return (
        <button onClick={onEdit} aria-label={`Редактировать бюджет: ${b.name}`} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-secondary/30 transition-colors">
            <div className="h-9 w-9 rounded-lg grid place-items-center text-lg shrink-0" style={{ background: color + "22", color }}>
                {b.emoji ?? "📁"}
            </div>
            <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                    <div className="font-medium truncate">{b.name}</div>
                    <div className="text-sm text-muted-foreground tabular-nums shrink-0">
                        {eur(b.spent_eur)} <span className="opacity-60">/ {eur(b.limit_eur)}</span>
                    </div>
                </div>
                <BudgetBar pct={b.pct} status={b.status} />
                <div className="flex items-center justify-between gap-3 text-xs">
                    <span className={cn("tabular-nums", BUDGET_STATUS_TEXT[b.status])}>
                        {overBy > 0 ? `−${eur(overBy)} сверх` : `осталось ${eur(b.remaining_eur)}`}
                        {b.missing_rates > 0 && <span className="text-amber-500"> · {b.missing_rates} без курса</span>}
                    </span>
                    <span className="text-muted-foreground tabular-nums">{b.pct}%</span>
                </div>
            </div>
            <Pencil className="h-4 w-4 text-muted-foreground shrink-0" />
        </button>
    );
}

// ── Create / edit modal ──────────────────────────────────────────────────────
function BudgetModal({ state, onClose, unbudgeted }: { state: ModalState; onClose: () => void; unbudgeted: Category[] }) {
    const create = useCreateBudget();
    const update = useUpdateBudget();
    const del = useDeleteBudget();
    const toast = useToast();

    const open = state !== null;
    const isEdit = state?.mode === "edit";
    const isTotal = state?.mode === "create-total" || (state?.mode === "edit" && state.isTotal);

    const [categoryId, setCategoryId] = useState("");
    const [limit, setLimit] = useState("");
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!state) return;
        setCategoryId(state.mode === "create-category" ? (state.categoryId ?? unbudgeted[0]?.id ?? "") : "");
        setLimit(state.mode === "edit" ? String(state.limit) : "");
        setSubmitting(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state?.mode, state?.mode === "edit" ? state.budgetId : state?.mode === "create-category" ? state.categoryId : null]);

    const limitNum = parseFloat(limit.replace(",", "."));
    const limitValid = isFinite(limitNum) && limitNum > 0;
    const valid = limitValid && (isEdit || isTotal || categoryId !== "");

    const title = isEdit
        ? (isTotal ? "Общий потолок" : `Бюджет · ${state.label}`)
        : (isTotal ? "Общий месячный потолок" : "Новый бюджет");

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!valid || !state) return;
        setSubmitting(true);
        try {
            if (state.mode === "edit") {
                await update.mutateAsync({ id: state.budgetId, patch: { limit_eur: limitNum } });
            } else if (state.mode === "create-total") {
                await create.mutateAsync({ scope: "total", limit_eur: limitNum });
            } else {
                await create.mutateAsync({ scope: "category", category_id: categoryId, limit_eur: limitNum });
            }
            toast("Сохранено", "ok");
            onClose();
        } finally {
            setSubmitting(false);
        }
    };

    const remove = async () => {
        if (!state || state.mode !== "edit") return;
        setSubmitting(true);
        try {
            await del.mutateAsync(state.budgetId);
            toast("Лимит удалён", "ok");
            onClose();
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal open={open} onClose={onClose} title={title} size="sm">
            <form onSubmit={submit} className="space-y-5">
                {state?.mode === "create-category" && (
                    <label className="block">
                        <span className="text-sm text-muted-foreground block mb-1.5">Категория</span>
                        <Select fullWidth value={categoryId} onChange={e => setCategoryId(e.target.value)}>
                            {unbudgeted.length === 0 && <option value="">Нет категорий без лимита</option>}
                            {unbudgeted.map(c => (
                                <option key={c.id} value={c.id}>{c.emoji ? `${c.emoji} ` : ""}{c.name}</option>
                            ))}
                        </Select>
                    </label>
                )}

                <label className="block">
                    <span className="text-sm text-muted-foreground block mb-1.5">
                        Месячный лимит, EUR
                    </span>
                    <div className="relative">
                        <input
                            type="text" inputMode="decimal" value={limit} onChange={e => setLimit(e.target.value)} autoFocus
                            placeholder="напр. 300"
                            className="w-full px-3 py-2 pr-9 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring tabular-nums"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">€</span>
                    </div>
                    {isTotal && (
                        <span className="text-xs text-muted-foreground mt-1.5 block">Лимит на сумму всех трат за календарный месяц.</span>
                    )}
                </label>

                <div className="flex justify-between gap-2 pt-2">
                    {isEdit ? (
                        <button type="button" onClick={remove} disabled={submitting}
                            className="btn-ghost px-3 py-2 text-destructive hover:bg-destructive/10">
                            <Trash2 className="h-4 w-4" /> Удалить
                        </button>
                    ) : <span />}
                    <div className="flex gap-2">
                        <button type="button" onClick={onClose} className="btn-ghost px-4 py-2">Отмена</button>
                        <button type="submit" disabled={!valid || submitting} className="btn-primary px-4 py-2 min-w-[7rem]">
                            {submitting ? "…" : (isEdit ? "Сохранить" : "Создать")}
                        </button>
                    </div>
                </div>
            </form>
        </Modal>
    );
}
