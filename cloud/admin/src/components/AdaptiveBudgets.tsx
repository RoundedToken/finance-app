/**
 * Адаптивные бюджеты RBAR (SPEC-023) — UI поверх /budgets.
 * Advisory-first: рекомендации показываются как ПРЕДЛОЖЕНИЯ (применить/скрыть),
 * система сама лимиты не двигает. Lumpy → накопительный конверт (read-only линза).
 */
import { useState } from "react";
import { Check, X, TrendingDown, TrendingUp, PiggyBank, ChevronDown, Info } from "lucide-react";
import {
    useBudgetRecommendations,
    useBudgetArchetypes,
    useApplyRecommendation,
    useDismissRecommendation,
    useUpdateBudgetSettings,
} from "@/api/queries";
import { Select } from "@/components/Select";
import { useToast } from "@/components/Toast";
import { formatAmount, cn } from "@/lib/utils";
import type { Archetype, BudgetRecommendation, BudgetArchetypeRow } from "@/api/types";

const eur = (x: number) => `${formatAmount(x, "EUR")} €`;

// ── Бейдж архетипа ───────────────────────────────────────────────────────────
const ARCHETYPE_LABEL: Record<Archetype, string> = {
    recurring: "регулярная",
    seasonal: "сезонная",
    lumpy: "редкие крупные",
    fixed: "фиксированная",
    intermittent: "мелкие",
    "cold-start": "сбор данных",
};
const ARCHETYPE_CLASS: Record<Archetype, string> = {
    recurring: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
    seasonal: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-300",
    lumpy: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
    fixed: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
    intermittent: "bg-zinc-500/15 text-zinc-500 dark:text-zinc-400",
    "cold-start": "bg-amber-500/15 text-amber-600 dark:text-amber-300",
};

export function ArchetypeBadge({ a, override }: { a: Archetype; override?: boolean }) {
    return (
        <span
            className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap", ARCHETYPE_CLASS[a])}
            title={override ? "Архетип задан вручную" : "Определён автоматически из истории"}
        >
            {ARCHETYPE_LABEL[a]}{override ? " ·✎" : ""}
        </span>
    );
}

// ── Секция рекомендаций (recurring/seasonal) ─────────────────────────────────
export function RecommendationsSection() {
    const { data, isLoading } = useBudgetRecommendations();
    const apply = useApplyRecommendation();
    const dismiss = useDismissRecommendation();
    const toast = useToast();

    if (isLoading || !data) return null;
    const period = data.period;
    // Показываем только осмысленные предложения: есть рекомендация, не скрыта,
    // и она отличается от текущего лимита (или лимита ещё нет).
    const recs = data.recommendations.filter(r =>
        (r.archetype === "recurring" || r.archetype === "seasonal") &&
        r.recommended_limit_eur != null && !r.dismissed &&
        (r.current_limit_eur == null || Math.abs(r.delta_pct ?? 0) >= 1),
    );
    if (recs.length === 0) return null;

    const onApply = async (rec: BudgetRecommendation) => {
        await apply.mutateAsync({ rec, period });
        toast("Лимит обновлён", "ok");
    };
    const onDismiss = async (rec: BudgetRecommendation) => {
        await dismiss.mutateAsync({ rec, period });
        toast("Рекомендация скрыта", "ok");
    };

    return (
        <div className="space-y-2">
            <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                Рекомендации
                <span className="font-normal lowercase tracking-normal opacity-70">· предложения, лимит меняете вы</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
                {recs.map(r => <RecommendationCard key={r.category_id} r={r} onApply={() => onApply(r)} onDismiss={() => onDismiss(r)} busy={apply.isPending || dismiss.isPending} />)}
            </div>
        </div>
    );
}

function RecommendationCard({ r, onApply, onDismiss, busy }: {
    r: BudgetRecommendation; onApply: () => void; onDismiss: () => void; busy: boolean;
}) {
    const color = r.color ?? "#94a3b8";
    const reco = r.recommended_limit_eur ?? 0;
    const down = r.current_limit_eur != null && reco < r.current_limit_eur;
    const up = r.current_limit_eur != null && reco > r.current_limit_eur;
    return (
        <div className="card p-3 space-y-2 border-amber-500/30">
            <div className="flex items-center gap-2 min-w-0">
                <div className="h-7 w-7 rounded-lg grid place-items-center text-base shrink-0" style={{ background: color + "22", color }}>{r.emoji ?? "📁"}</div>
                <div className="font-medium truncate flex-1">{r.name}</div>
                <ArchetypeBadge a={r.archetype} override={r.archetype_override != null} />
            </div>
            <div className="flex items-baseline gap-2 tabular-nums">
                {r.current_limit_eur != null
                    ? <><span className="text-muted-foreground line-through text-sm">{eur(r.current_limit_eur)}</span><span className="opacity-50">→</span></>
                    : <span className="text-xs text-muted-foreground">лимита нет →</span>}
                <span className={cn("text-lg font-semibold", down ? "text-positive" : up ? "text-amber-500" : "")}>{eur(reco)}</span>
                {down && <TrendingDown className="h-4 w-4 text-positive" />}
                {up && <TrendingUp className="h-4 w-4 text-amber-500" />}
                {r.delta_pct != null && <span className={cn("text-xs", down ? "text-positive" : "text-amber-500")}>{r.delta_pct > 0 ? "+" : ""}{r.delta_pct}%</span>}
            </div>
            <div className="text-xs text-muted-foreground flex items-start gap-1">
                <Info className="h-3 w-3 mt-0.5 shrink-0 opacity-60" />
                <span>
                    {r.reason_text}
                    {r.floor_eur != null && <span className="opacity-70"> · пол {eur(r.floor_eur)}</span>}
                    {r.confidence === "low" && <span className="text-amber-500"> · неполные курсы</span>}
                </span>
            </div>
            <div className="flex gap-2 pt-0.5">
                <button onClick={onApply} disabled={busy} className="btn-primary px-3 py-1.5 text-sm flex-1 disabled:opacity-50">
                    <Check className="h-3.5 w-3.5" /> Применить
                </button>
                <button onClick={onDismiss} disabled={busy} className="btn-ghost px-3 py-1.5 text-sm" aria-label="Скрыть">
                    <X className="h-3.5 w-3.5" /> Скрыть
                </button>
            </div>
        </div>
    );
}

// ── Секция накопительных конвертов (lumpy) ───────────────────────────────────
export function EnvelopesSection() {
    const { data, isLoading } = useBudgetRecommendations();
    if (isLoading || !data) return null;
    const lumpy = data.recommendations.filter(r => r.archetype === "lumpy" && r.envelope);
    if (lumpy.length === 0) return null;

    return (
        <div className="space-y-2">
            <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <PiggyBank className="h-3.5 w-3.5" /> Накопительные конверты
                <span className="font-normal lowercase tracking-normal opacity-70">· для редких крупных покупок</span>
            </div>
            <div className="card divide-y overflow-hidden">
                {lumpy.map(r => <EnvelopeRow key={r.category_id} r={r} />)}
            </div>
        </div>
    );
}

function EnvelopeRow({ r }: { r: BudgetRecommendation }) {
    const e = r.envelope!;
    const color = r.color ?? "#94a3b8";
    const pct = e.annual_eur > 0 ? Math.min(100, Math.max(2, (e.accrued_eur / e.annual_eur) * 100)) : 0;
    return (
        <div className="flex items-center gap-3 px-4 py-3">
            <div className="h-9 w-9 rounded-lg grid place-items-center text-lg shrink-0" style={{ background: color + "22", color }}>{r.emoji ?? "📁"}</div>
            <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                    <div className="font-medium truncate flex items-center gap-2">{r.name} <ArchetypeBadge a="lumpy" override={r.archetype_override != null} /></div>
                    <div className="text-sm tabular-nums shrink-0">
                        <span className="font-semibold text-violet-600 dark:text-violet-300">{eur(e.accrued_eur)}</span>
                        <span className="text-muted-foreground"> накоплено</span>
                    </div>
                </div>
                <div className="h-2 rounded-full bg-secondary/60 overflow-hidden">
                    <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: "#8b5cf6" }} />
                </div>
                <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground tabular-nums">
                    <span>годовой ≈ {eur(e.annual_eur)} · отчисление {eur(e.accrual_monthly_eur)}/мес</span>
                    {e.alert && <span className="text-destructive">перерасход годового</span>}
                </div>
            </div>
        </div>
    );
}

// ── Секция «Как система видит мои категории» (классификация + override) ──────
const OVERRIDE_OPTIONS: Array<{ value: string; label: string }> = [
    { value: "", label: "авто" },
    { value: "recurring", label: "регулярная" },
    { value: "seasonal", label: "сезонная" },
    { value: "lumpy", label: "редкие крупные" },
    { value: "fixed", label: "фиксированная" },
    { value: "intermittent", label: "мелкие" },
];

export function ClassificationSection() {
    const { data, isLoading } = useBudgetArchetypes();
    const [open, setOpen] = useState(false);

    if (isLoading || !data || data.categories.length === 0) return null;

    return (
        <div>
            <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-2 text-xs uppercase tracking-wider text-muted-foreground py-1.5 hover:text-foreground transition-colors">
                <span>Как система видит мои категории</span>
                <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
            </button>
            {open && (
                <div className="card divide-y overflow-hidden mt-1">
                    {data.categories.map(c => <ClassificationRow key={c.category_id} row={c} />)}
                </div>
            )}
        </div>
    );
}

function ClassificationRow({ row }: { row: BudgetArchetypeRow }) {
    const settings = useUpdateBudgetSettings();
    const toast = useToast();
    const m = row.metrics;
    const color = row.color ?? "#94a3b8";

    const onOverride = async (value: string) => {
        await settings.mutateAsync({ categoryId: row.category_id, patch: { archetype_override: value === "" ? null : (value as Archetype) } });
        toast("Сохранено", "ok");
    };
    const onToggle = async () => {
        await settings.mutateAsync({ categoryId: row.category_id, patch: { adaptive_enabled: !row.adaptive_enabled } });
        toast(row.adaptive_enabled ? "Адаптация выключена" : "Адаптация включена", "ok");
    };

    return (
        <div className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <div className="h-7 w-7 rounded-lg grid place-items-center text-base shrink-0" style={{ background: color + "22", color }}>{row.emoji ?? "📁"}</div>
            <div className="min-w-0 flex-1">
                <div className="font-medium truncate flex items-center gap-2">
                    {row.name}
                    <ArchetypeBadge a={row.archetype_override ?? row.detected_archetype} override={row.archetype_override != null} />
                </div>
                <div className="text-[11px] text-muted-foreground tabular-nums">
                    N={m.n_months} · CoV {m.cov_resid.toFixed(2)} · нулей {Math.round(m.zero_frac * 100)}% · тренд {m.trend_pct_mo > 0 ? "+" : ""}{m.trend_pct_mo.toFixed(1)}%/мес
                </div>
            </div>
            <Select value={row.archetype_override ?? ""} onChange={e => onOverride(e.target.value)} wrapperClassName="shrink-0" className="text-xs py-1.5">
                {OVERRIDE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            <button
                onClick={onToggle}
                disabled={settings.isPending}
                aria-pressed={row.adaptive_enabled}
                aria-label={`Адаптация лимита: ${row.name} — ${row.adaptive_enabled ? "включена" : "выключена"}`}
                title={row.adaptive_enabled ? "Адаптация включена" : "Адаптация выключена"}
                className={cn("relative h-5 w-9 rounded-full transition-colors shrink-0", row.adaptive_enabled ? "bg-primary" : "bg-secondary")}
            >
                <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform", row.adaptive_enabled ? "translate-x-4" : "translate-x-0.5")} />
            </button>
        </div>
    );
}
