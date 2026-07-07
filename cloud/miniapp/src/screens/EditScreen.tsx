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
    // SPEC-032: счёт резолвим из полного (не-external) списка, включая неактивные — чтобы правка
    // легаси-записи на деактивированном счёте показывала amber/override, а не упиралась в 400.
    const accounts = (data?.accounts ?? []).filter(a => a.form !== "external");
    const account = accounts.find(a => a.id === s.accountId) ?? null;
    const busy = upd.isPending || del.isPending;
    const mismatch = !!account && s.currency !== account.currency;   // SPEC-032

    // MA-04 (SPEC-048): возвращаемся туда, откуда пришли (main/История/drill Статистики),
    // а не всегда на главный — цикл «просматриваю период → правлю» не теряет контекст.
    const back = () => { d({ t: "resetDraft" }); d({ t: "screen", v: s.returnScreen }); };

    // SPEC-032: валюта привязана к счёту — пикер только через осознанное подтверждение.
    // При уже-рассогласованной (легаси) записи или «без счёта» — открываем сразу.
    const openCurrency = async () => {
        haptic("light");
        if (account && !mismatch) {
            const ok = await confirmDialog(`Валюта привязана к счёту «${account.name}» (${account.currency}). Записать в другой валюте? Так бывает редко.`);
            if (!ok) return;
        }
        d({ t: "modal", v: "currency" });
    };

    const save = () => {
        const amt = amountValue(s);
        if (amt <= 0) { haptic("error"); toast("Введите сумму", "err"); return; }
        if (!s.editingId) return;
        upd.mutate(
            // SPEC-032: allow_currency_mismatch=true только при реальном рассогласовании (осознанно/легаси).
            { id: s.editingId, patch: { amount: amt, currency: s.currency, date: s.date, note: s.note || null, category_id: s.categoryId, account_id: s.accountId, allow_currency_mismatch: mismatch } },
            // Текст сервера важен: 400-guard'ы (валюта↔счёт, инвест-ведро, FIN-01) объясняют, что исправить.
            { onSuccess: () => { haptic("success"); toast("Сохранено"); back(); }, onError: (e) => { haptic("error"); toast(e instanceof Error ? e.message : "Ошибка", "err"); } },
        );
    };
    const remove = async () => {
        if (!s.editingId || !(await confirmDialog("Удалить запись?"))) return;
        del.mutate(s.editingId, { onSuccess: () => { haptic("success"); toast("Удалено"); back(); }, onError: () => { haptic("error"); toast("Ошибка", "err"); } });
    };

    return (
        <div className="min-h-screen flex flex-col">
            <header className="flex items-center justify-between px-4 py-3">
                {/* MA-11 (SPEC-048): 44×44 pt touch target */}
                <button aria-label="Назад" onClick={() => { haptic("light"); back(); }}
                    className="h-11 w-11 grid place-items-center rounded-full active:bg-secondary-bg">
                    <ArrowLeft className="h-5 w-5" />
                </button>
                <button onClick={openCurrency} className="flex flex-col items-center">
                    {/* MA-07 (SPEC-048): длинное число уменьшаем, а не обрезаем */}
                    <span className={cn("font-semibold num tabular-nums leading-none",
                        s.amount.length > 10 ? "text-xl" : s.amount.length > 7 ? "text-2xl" : "text-3xl",
                        s.amount === "0" && "text-hint")}>{s.amount}</span>
                    <span className={cn("mt-0.5 inline-flex items-center gap-1 text-xs", mismatch ? "text-amber-500 font-medium" : "text-hint")}><CurrencyFlag code={s.currency} /> {s.currency}{mismatch && " ⚠"}</span>
                </button>
                <span className="w-11" />
            </header>

            <Numpad onKey={(k) => d({ t: "key", k })} className="px-4" />

            <div className="grid grid-cols-3 gap-2 px-4 mt-3">
                <Chip icon={<Calendar className="h-4 w-4" />} label={humanDay(s.date)} onClick={() => d({ t: "modal", v: "date" })} />
                <Chip icon={<Wallet className="h-4 w-4" />} label={account ? account.name : "Счёт"} active={!!account} danger={mismatch} onClick={() => d({ t: "modal", v: "account" })} />
                <Chip icon={<MessageSquare className="h-4 w-4" />} label={s.note ? "Описание ✓" : "Описание"} active={!!s.note} onClick={() => d({ t: "screen", v: "note" })} />
            </div>
            {/* SPEC-032: видимый сигнал рассогласования валюта↔счёт (осознанный override / правка легаси). */}
            {mismatch && account && (
                <div className="px-4 mt-2">
                    <div className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-500/10 rounded-lg px-3 py-2">
                        <span aria-hidden>⚠️</span>
                        <span>Счёт в {account.currency}, а валюта траты — {s.currency}</span>
                    </div>
                </div>
            )}

            <div className="px-4 mt-4">
                <span className="text-xs text-hint mb-1.5 block">Категория</span>
                <div className="grid grid-cols-4 gap-2">
                    {cats.map(c => (
                        <button key={c.id} onClick={() => { haptic("light"); d({ t: "category", v: c.id }); }}
                            style={{ background: (c.color ?? "#9ca3af") + "40" }}
                            className={cn("flex flex-col items-center gap-1 py-2.5 rounded-xl transition-all active:animate-pop",
                                c.id === s.categoryId && "ring-2 ring-accent")}>
                            <span className="text-2xl leading-none">{c.emoji ?? "🏷"}</span>
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

function Chip({ icon, label, active, danger, onClick }: { icon: React.ReactNode; label: string; active?: boolean; danger?: boolean; onClick: () => void }) {
    return (
        <button onClick={() => { haptic("light"); onClick(); }}
            className={cn("flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl text-xs font-medium truncate transition-colors active:animate-pop",
                danger ? "bg-amber-500/15 text-amber-600 ring-1 ring-amber-500/40" : active ? "bg-accent/15 text-accent" : "bg-secondary-bg text-hint")}>
            {icon}<span className="truncate">{label}</span>
        </button>
    );
}
