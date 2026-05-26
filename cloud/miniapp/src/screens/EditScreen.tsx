import { ArrowLeft, Calendar, Wallet, MessageSquare } from "lucide-react";
import { useBootstrap, useUpdateExpense, useDeleteExpense } from "@/api/queries";
import { useApp, amountValue } from "@/store";
import { useToast } from "@/components/Toast";
import { Numpad } from "@/components/Numpad";
import { CurrencyFlag } from "@/components/Currency";
import { haptic, confirmDialog } from "@/lib/telegram";
import { cn, humanDay } from "@/lib/utils";

/**
 * Экран редактирования траты — input-less: сумма вводится своим numpad (нет
 * системной клавиатуры), валюта/дата/счёт — picker'ы, описание — отдельный
 * экран, категория — грид. Никаких прыжков, т.к. системной клавиатуры нет.
 */
export function EditScreen() {
    const { s, d } = useApp();
    const { data } = useBootstrap();
    const upd = useUpdateExpense();
    const del = useDeleteExpense();
    const toast = useToast();

    const cats = (data?.categories ?? []).filter(c => c.type === "expense" && c.is_active);
    const accounts = (data?.accounts ?? []).filter(a => a.form !== "external" && a.is_active !== 0);
    const account = accounts.find(a => a.id === s.accountId) ?? null;
    const busy = upd.isPending || del.isPending;

    const back = () => { d({ t: "resetDraft" }); d({ t: "screen", v: "main" }); };

    const save = () => {
        const amt = amountValue(s);
        if (amt <= 0) { haptic("error"); toast("Введите сумму", "err"); return; }
        if (!s.editingId) return;
        upd.mutate(
            { id: s.editingId, patch: { amount: amt, currency: s.currency, date: s.date, note: s.note || null, category_id: s.categoryId, account_id: s.accountId } },
            { onSuccess: () => { haptic("success"); toast("Сохранено"); back(); }, onError: () => { haptic("error"); toast("Ошибка", "err"); } },
        );
    };
    const remove = async () => {
        if (!s.editingId || !(await confirmDialog("Удалить запись?"))) return;
        del.mutate(s.editingId, { onSuccess: () => { haptic("success"); toast("Удалено"); back(); }, onError: () => { haptic("error"); toast("Ошибка", "err"); } });
    };

    return (
        <div className="min-h-screen flex flex-col">
            <header className="flex items-center justify-between px-4 py-3">
                <button aria-label="Назад" onClick={() => { haptic("light"); back(); }}
                    className="h-9 w-9 grid place-items-center rounded-full active:bg-secondary-bg">
                    <ArrowLeft className="h-5 w-5" />
                </button>
                <button onClick={() => { haptic("light"); d({ t: "modal", v: "currency" }); }} className="flex flex-col items-center">
                    <span className={cn("text-3xl font-semibold num tabular-nums leading-none", s.amount === "0" && "text-hint")}>{s.amount}</span>
                    <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-hint"><CurrencyFlag code={s.currency} /> {s.currency}</span>
                </button>
                <span className="w-9" />
            </header>

            <Numpad onKey={(k) => d({ t: "key", k })} className="px-4" />

            <div className="grid grid-cols-3 gap-2 px-4 mt-3">
                <Chip icon={<Calendar className="h-4 w-4" />} label={humanDay(s.date)} onClick={() => d({ t: "modal", v: "date" })} />
                <Chip icon={<Wallet className="h-4 w-4" />} label={account ? account.name : "Счёт"} active={!!account} onClick={() => d({ t: "modal", v: "account" })} />
                <Chip icon={<MessageSquare className="h-4 w-4" />} label={s.note ? "Описание ✓" : "Описание"} active={!!s.note} onClick={() => d({ t: "screen", v: "note" })} />
            </div>

            <div className="px-4 mt-4">
                <span className="text-xs text-hint mb-1.5 block">Категория</span>
                <div className="grid grid-cols-4 gap-2">
                    {cats.map(c => (
                        <button key={c.id} onClick={() => { haptic("light"); d({ t: "category", v: c.id }); }}
                            className={cn("flex flex-col items-center gap-1 py-2.5 rounded-xl transition-all active:animate-pop",
                                c.id === s.categoryId ? "bg-accent/15 ring-1 ring-accent/40" : "bg-secondary-bg")}>
                            <span className="h-8 w-8 rounded-full grid place-items-center text-lg" style={{ background: (c.color ?? "#9ca3af") + "33" }}>{c.emoji ?? "🏷"}</span>
                            <span className="text-[10px] leading-tight text-center">{c.name}</span>
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex gap-2 px-4 mt-5 mb-6">
                <button disabled={busy} onClick={remove} className="flex-1 py-3 rounded-xl bg-danger/15 text-danger font-medium disabled:opacity-50">Удалить</button>
                <button disabled={busy} onClick={save} className="flex-1 py-3 rounded-xl bg-accent text-accent-fg font-medium disabled:opacity-50">Сохранить</button>
            </div>
        </div>
    );
}

function Chip({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active?: boolean; onClick: () => void }) {
    return (
        <button onClick={() => { haptic("light"); onClick(); }}
            className={cn("flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl text-xs font-medium truncate transition-colors active:animate-pop",
                active ? "bg-accent/15 text-accent" : "bg-secondary-bg text-hint")}>
            {icon}<span className="truncate">{label}</span>
        </button>
    );
}
