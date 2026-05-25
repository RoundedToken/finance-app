import { useEffect, useState, type ReactNode } from "react";
import { useBootstrap, useUpdateExpense, useDeleteExpense } from "@/api/queries";
import { useApp } from "@/store";
import { Modal } from "./Modal";
import { useToast } from "./Toast";
import { haptic, confirmDialog } from "@/lib/telegram";
import { cn, todayISO } from "@/lib/utils";

export function EditModal() {
    const { s, d } = useApp();
    const { data } = useBootstrap();
    const upd = useUpdateExpense();
    const del = useDeleteExpense();
    const toast = useToast();
    const e = s.editing;

    const [amount, setAmount] = useState("0");
    const [currency, setCurrency] = useState("RSD");
    const [date, setDate] = useState("");
    const [note, setNote] = useState("");
    const [catId, setCatId] = useState<string | null>(null);
    const [accId, setAccId] = useState<string | null>(null);

    useEffect(() => {
        if (e) {
            setAmount(String(e.amount)); setCurrency(e.currency); setDate(e.date);
            setNote(e.note ?? ""); setCatId(e.category_id); setAccId(e.account_id);
        }
    }, [e]);

    if (!e) return null;
    const cats = (data?.categories ?? []).filter(c => c.type === "expense" && c.is_active);
    const accounts = (data?.accounts ?? []).filter(a => a.form !== "external" && a.is_active !== 0);
    const currencies = data?.currencies ?? [];
    const close = () => d({ t: "edit", e: null });

    const save = () => {
        const amt = parseFloat(amount) || 0;
        if (amt <= 0) { haptic("error"); toast("Введите сумму", "err"); return; }
        upd.mutate(
            { id: e.id, patch: { amount: amt, currency, date, note: note || null, category_id: catId, account_id: accId } },
            { onSuccess: () => { haptic("success"); toast("Сохранено"); close(); }, onError: () => { haptic("error"); toast("Ошибка", "err"); } },
        );
    };
    const remove = async () => {
        if (!(await confirmDialog("Удалить запись?"))) return;
        del.mutate(e.id, { onSuccess: () => { haptic("success"); toast("Удалено"); close(); }, onError: () => { haptic("error"); toast("Ошибка", "err"); } });
    };

    const busy = upd.isPending || del.isPending;

    return (
        <Modal open={s.modal === "edit"} onClose={close} title="Редактировать">
            <div className="space-y-3">
                <Field label="Сумма">
                    <input type="number" inputMode="decimal" step="any" value={amount} onChange={ev => setAmount(ev.target.value)}
                        className="w-full bg-secondary-bg rounded-xl p-2.5 text-right num outline-none" />
                </Field>
                <Field label="Валюта">
                    <div className="flex flex-wrap gap-1.5">
                        {currencies.map(c => (
                            <button key={c.code} onClick={() => setCurrency(c.code)}
                                className={cn("px-2.5 py-1.5 rounded-lg text-xs", c.code === currency ? "bg-accent/15 text-accent ring-1 ring-accent/40" : "bg-secondary-bg")}>
                                {c.emoji} {c.code}
                            </button>
                        ))}
                    </div>
                </Field>
                <Field label="Дата">
                    <input type="date" value={date} max={todayISO()} onChange={ev => setDate(ev.target.value)}
                        className="w-full bg-secondary-bg rounded-xl p-2.5 num outline-none" />
                </Field>
                <Field label="Счёт">
                    <div className="flex flex-wrap gap-1.5">
                        <button onClick={() => setAccId(null)}
                            className={cn("px-2.5 py-1.5 rounded-lg text-xs", accId === null ? "bg-accent/15 text-accent ring-1 ring-accent/40" : "bg-secondary-bg")}>Без счёта</button>
                        {accounts.map(a => (
                            <button key={a.id} onClick={() => setAccId(a.id)}
                                className={cn("px-2.5 py-1.5 rounded-lg text-xs", accId === a.id ? "bg-accent/15 text-accent ring-1 ring-accent/40" : "bg-secondary-bg")}>{a.name}</button>
                        ))}
                    </div>
                </Field>
                <Field label="Описание">
                    <textarea value={note} onChange={ev => setNote(ev.target.value)} rows={2}
                        className="w-full bg-secondary-bg rounded-xl p-2.5 text-sm outline-none resize-none" />
                </Field>
                <Field label="Категория">
                    <div className="grid grid-cols-5 gap-1.5">
                        {cats.map(c => (
                            <button key={c.id} onClick={() => setCatId(c.id)}
                                className={cn("flex flex-col items-center gap-0.5 py-2 rounded-lg", c.id === catId ? "bg-accent/15 ring-1 ring-accent/40" : "bg-secondary-bg")}>
                                <span className="text-lg leading-none">{c.emoji ?? "🏷"}</span>
                                <span className="text-[9px] leading-tight text-center">{c.name}</span>
                            </button>
                        ))}
                    </div>
                </Field>
                <div className="flex gap-2 pt-1">
                    <button disabled={busy} onClick={remove} className="flex-1 py-2.5 rounded-xl bg-danger/15 text-danger text-sm font-medium disabled:opacity-50">Удалить</button>
                    <button disabled={busy} onClick={save} className="flex-1 py-2.5 rounded-xl bg-accent text-accent-fg text-sm font-medium disabled:opacity-50">Сохранить</button>
                </div>
            </div>
        </Modal>
    );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="block">
            <span className="text-xs text-hint mb-1 block">{label}</span>
            {children}
        </label>
    );
}
