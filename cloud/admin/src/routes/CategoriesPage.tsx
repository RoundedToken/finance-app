import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, FolderTree, ArrowUp, ArrowDown, Eye, EyeOff } from "lucide-react";
import { useManagedCategories, useCreateCategory, useUpdateCategory } from "@/api/queries";
import { Modal } from "@/components/Modal";
import { cn } from "@/lib/utils";
import { COLOR_PALETTE } from "./GoalsPage";
import type { ManagedCategory, CategoryCreatePayload, CategoryUpdatePayload } from "@/api/types";

type Kind = "expense" | "income";

const KIND_TABS: { value: Kind; label: string }[] = [
    { value: "expense", label: "Расходные" },
    { value: "income", label: "Доходные" },
];

const EMOJI_BY_KIND: Record<Kind, string[]> = {
    expense: ["🛒", "🍔", "☕", "🚕", "🏠", "📺", "💊", "🎁", "✈️", "🎮", "👕", "📚", "🐾", "💡", "❓"],
    income: ["💼", "📈", "🎁", "🎟️", "💻", "🏦", "💸", "✨", "🤝", "❓"],
};

export function CategoriesPage() {
    const [kind, setKind] = useState<Kind>("expense");
    const [modalOpen, setModalOpen] = useState(false);

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-semibold tracking-tight">Категории</h1>
                    <p className="text-muted-foreground mt-1">
                        Название, эмодзи, цвет и порядок. Деактивация прячет категорию из выбора, но старые записи её сохраняют.
                    </p>
                </div>
                <button onClick={() => setModalOpen(true)} className="btn-primary px-4 py-2 self-start">
                    <Plus className="h-4 w-4" /> Новая категория
                </button>
            </div>

            <div className="grid grid-cols-2 gap-1 p-1 bg-secondary/60 rounded-xl max-w-xs">
                {KIND_TABS.map(tab => {
                    const active = tab.value === kind;
                    return (
                        <button
                            key={tab.value}
                            type="button"
                            aria-pressed={active}
                            onClick={() => setKind(tab.value)}
                            className={cn(
                                "py-1.5 px-2 rounded-lg text-sm font-medium transition-colors",
                                active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                            )}
                        >
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            <CategoryList key={kind} kind={kind} />

            <CategoryModal kind={kind} open={modalOpen} onClose={() => setModalOpen(false)} initial={null} />
        </div>
    );
}

function CategoryList({ kind }: { kind: Kind }) {
    const { data, isLoading } = useManagedCategories(kind);
    const update = useUpdateCategory(kind);
    const [editing, setEditing] = useState<ManagedCategory | null>(null);

    const all = data?.categories ?? [];
    const active = useMemo(() => all.filter(c => c.is_active).sort(sortByOrder), [all]);
    const inactive = useMemo(() => all.filter(c => !c.is_active).sort(sortByOrder), [all]);

    // Reorder: swap sort_order с соседом (две записи). Влияет на порядок плиток в Mini App.
    const move = async (idx: number, dir: -1 | 1) => {
        const j = idx + dir;
        if (j < 0 || j >= active.length) return;
        const a = active[idx], b = active[j];
        await Promise.all([
            update.mutateAsync({ id: a.id, patch: { sort_order: b.sort_order } }),
            update.mutateAsync({ id: b.id, patch: { sort_order: a.sort_order } }),
        ]);
    };

    const setActive = (c: ManagedCategory, is_active: boolean) =>
        update.mutate({ id: c.id, patch: { is_active } });

    if (isLoading) {
        return (
            <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => <div key={i} className="card h-14 animate-pulse bg-muted/40" />)}
            </div>
        );
    }

    return (
        <div className="space-y-5">
            <div className="card divide-y overflow-hidden">
                {active.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground text-sm">
                        <FolderTree className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        Активных категорий нет — добавь первую кнопкой выше.
                    </div>
                ) : active.map((c, i) => (
                    <CategoryRow
                        key={c.id} cat={c}
                        onEdit={() => setEditing(c)}
                        onToggle={() => setActive(c, false)}
                        onUp={i > 0 ? () => move(i, -1) : undefined}
                        onDown={i < active.length - 1 ? () => move(i, 1) : undefined}
                    />
                ))}
            </div>

            {inactive.length > 0 && (
                <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Неактивные</div>
                    <div className="card divide-y overflow-hidden opacity-60">
                        {inactive.map(c => (
                            <CategoryRow key={c.id} cat={c} onEdit={() => setEditing(c)} onToggle={() => setActive(c, true)} inactive />
                        ))}
                    </div>
                </div>
            )}

            <CategoryModal kind={kind} open={!!editing} onClose={() => setEditing(null)} initial={editing} />
        </div>
    );
}

interface RowProps {
    cat: ManagedCategory;
    onEdit: () => void;
    onToggle: () => void;
    onUp?: () => void;
    onDown?: () => void;
    inactive?: boolean;
}

function CategoryRow({ cat, onEdit, onToggle, onUp, onDown, inactive }: RowProps) {
    const color = cat.color ?? "#94a3b8";
    return (
        <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-secondary/30 transition-colors">
            <div className="h-9 w-9 rounded-lg grid place-items-center text-lg shrink-0" style={{ background: color + "22", color }}>
                {cat.emoji ?? "📁"}
            </div>
            <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{cat.name}</div>
            </div>
            {!inactive && (
                <div className="flex items-center gap-0.5 text-muted-foreground">
                    <button onClick={onUp} disabled={!onUp} aria-label="Выше"
                        className="p-1.5 rounded-md hover:bg-accent disabled:opacity-30 disabled:hover:bg-transparent"><ArrowUp className="h-4 w-4" /></button>
                    <button onClick={onDown} disabled={!onDown} aria-label="Ниже"
                        className="p-1.5 rounded-md hover:bg-accent disabled:opacity-30 disabled:hover:bg-transparent"><ArrowDown className="h-4 w-4" /></button>
                </div>
            )}
            <button onClick={onEdit} aria-label="Редактировать" className="p-1.5 rounded-md hover:bg-accent text-muted-foreground">
                <Pencil className="h-4 w-4" />
            </button>
            <button onClick={onToggle} aria-label={inactive ? "Вернуть" : "Деактивировать"}
                className={cn("p-1.5 rounded-md hover:bg-accent", inactive ? "text-positive" : "text-muted-foreground")}>
                {inactive ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            </button>
        </div>
    );
}

function CategoryModal({ kind, open, onClose, initial }: { kind: Kind; open: boolean; onClose: () => void; initial: ManagedCategory | null }) {
    const create = useCreateCategory(kind);
    const update = useUpdateCategory(kind);

    const [name, setName] = useState("");
    const [emoji, setEmoji] = useState("");
    const [color, setColor] = useState(COLOR_PALETTE[0]);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!open) return;
        setName(initial?.name ?? "");
        setEmoji(initial?.emoji ?? "");
        setColor(initial?.color ?? COLOR_PALETTE[0]);
        setSubmitting(false);
    }, [open, initial?.id]);

    const valid = name.trim().length > 0;

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!valid) return;
        setSubmitting(true);
        try {
            if (initial) {
                const patch: CategoryUpdatePayload = { name: name.trim(), emoji: emoji.trim() || null, color };
                await update.mutateAsync({ id: initial.id, patch });
            } else {
                const payload: CategoryCreatePayload = { name: name.trim(), emoji: emoji.trim() || null, color };
                await create.mutateAsync(payload);
            }
            onClose();
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal open={open} onClose={onClose} title={initial ? "Редактировать категорию" : "Новая категория"} size="sm">
            <form onSubmit={submit} className="space-y-5">
                <div className="flex items-center gap-3 rounded-xl border bg-background/40 p-3" style={{ borderColor: color + "55" }}>
                    <div className="h-12 w-12 rounded-xl grid place-items-center text-2xl shrink-0" style={{ background: color + "22", color }}>
                        {emoji || "📁"}
                    </div>
                    <div className="min-w-0">
                        <div className="font-medium truncate">{name.trim() || "Без названия"}</div>
                        <div className="text-xs text-muted-foreground">{kind === "expense" ? "расходная" : "доходная"} категория</div>
                    </div>
                </div>

                <label className="block">
                    <span className="text-sm text-muted-foreground block mb-1.5">Название</span>
                    <input
                        type="text" value={name} onChange={e => setName(e.target.value)} maxLength={60} autoFocus
                        placeholder="напр. Продукты"
                        className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                </label>

                <label className="block">
                    <span className="text-sm text-muted-foreground block mb-1.5">Эмодзи и цвет</span>
                    <div className="flex items-center gap-2">
                        <input
                            type="text" value={emoji} onChange={e => setEmoji(e.target.value)} maxLength={4} aria-label="Эмодзи"
                            className="w-14 h-10 px-2 rounded-lg border bg-background text-center text-xl focus:outline-none focus:ring-2 focus:ring-ring shrink-0"
                        />
                        <div className="flex flex-wrap gap-1 flex-1">
                            {EMOJI_BY_KIND[kind].map(em => (
                                <button key={em} type="button" onClick={() => setEmoji(em)} aria-label={`Выбрать ${em}`}
                                    className={cn("h-8 w-8 rounded-md text-lg transition-colors", emoji === em ? "bg-primary/20" : "hover:bg-accent")}>
                                    {em}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 pt-2">
                        {COLOR_PALETTE.map(c => (
                            <button key={c} type="button" aria-label={`Цвет ${c}`} onClick={() => setColor(c)}
                                className={cn("h-7 w-7 rounded-md transition-all", color === c ? "ring-2 ring-offset-2 ring-offset-card ring-foreground/70 scale-105" : "hover:scale-105")}
                                style={{ background: c }} />
                        ))}
                    </div>
                </label>

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

function sortByOrder(a: ManagedCategory, b: ManagedCategory): number {
    return a.sort_order - b.sort_order || a.name.localeCompare(b.name);
}
