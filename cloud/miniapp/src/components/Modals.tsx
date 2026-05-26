import { useState } from "react";
import { History as HistoryIcon, BarChart3, X } from "lucide-react";
import { useBootstrap } from "@/api/queries";
import { useApp } from "@/store";
import { Modal } from "./Modal";
import { EditModal } from "./EditModal";
import { dateShiftISO } from "@/lib/utils";
import { haptic } from "@/lib/telegram";
import { cn } from "@/lib/utils";

export function Modals() {
    const { s } = useApp();
    return (
        <>
            <CurrencyPicker open={s.modal === "currency"} />
            <AccountPicker open={s.modal === "account"} />
            <DatePicker open={s.modal === "date"} />
            <NotePicker open={s.modal === "note"} />
            <MenuModal open={s.modal === "menu"} />
            <EditModal />
        </>
    );
}

function CurrencyPicker({ open }: { open: boolean }) {
    const { s, d } = useApp();
    const { data } = useBootstrap();
    const currencies = data?.currencies ?? [];
    return (
        <Modal open={open} onClose={() => d({ t: "modal", v: null })} title="Валюта">
            <div className="grid grid-cols-3 gap-2">
                {currencies.map(c => (
                    <button key={c.code} onClick={() => { haptic("light"); d({ t: "currency", v: c.code }); }}
                        className={cn("flex flex-col items-center gap-1 py-3 rounded-xl active:animate-pop transition-colors",
                            c.code === s.currency ? "bg-accent/15 text-accent ring-1 ring-accent/40" : "bg-secondary-bg")}>
                        <span className="text-2xl">{c.emoji ?? "💱"}</span>
                        <span className="text-xs">{c.code}</span>
                    </button>
                ))}
            </div>
        </Modal>
    );
}

function AccountPicker({ open }: { open: boolean }) {
    const { s, d } = useApp();
    const { data } = useBootstrap();
    const accounts = (data?.accounts ?? []).filter(a => a.form !== "external" && a.is_active !== 0);
    return (
        <Modal open={open} onClose={() => d({ t: "modal", v: null })} title="Счёт">
            <div className="space-y-1.5">
                <button onClick={() => { haptic("light"); d({ t: "account", v: null }); }}
                    className={cn("w-full flex items-center gap-3 py-3 px-3 rounded-xl active:animate-pop transition-colors text-left",
                        s.accountId === null ? "bg-accent/15 text-accent ring-1 ring-accent/40" : "bg-secondary-bg")}>
                    <X className="h-4 w-4" /> <span className="text-sm">Без счёта</span>
                </button>
                {accounts.map(a => (
                    <button key={a.id} onClick={() => { haptic("light"); d({ t: "account", v: a.id }); }}
                        className={cn("w-full flex items-center justify-between py-3 px-3 rounded-xl active:animate-pop transition-colors text-left",
                            s.accountId === a.id ? "bg-accent/15 text-accent ring-1 ring-accent/40" : "bg-secondary-bg")}>
                        <span className="text-sm">{a.name}</span>
                        <span className="text-xs text-hint">{a.currency}</span>
                    </button>
                ))}
            </div>
        </Modal>
    );
}

function DatePicker({ open }: { open: boolean }) {
    const { s, d } = useApp();
    const presets: { label: string; v: string }[] = [
        { label: "Сегодня", v: dateShiftISO(0) },
        { label: "Вчера", v: dateShiftISO(-1) },
        { label: "Позавчера", v: dateShiftISO(-2) },
    ];
    return (
        <Modal open={open} onClose={() => d({ t: "modal", v: null })} title="Дата">
            <div className="space-y-1.5">
                {presets.map(p => (
                    <button key={p.v} onClick={() => { haptic("light"); d({ t: "date", v: p.v }); }}
                        className={cn("w-full py-3 px-3 rounded-xl text-left text-sm active:animate-pop transition-colors",
                            s.date === p.v ? "bg-accent/15 text-accent ring-1 ring-accent/40" : "bg-secondary-bg")}>
                        {p.label}
                    </button>
                ))}
                <label className="flex items-center justify-between py-3 px-3 rounded-xl bg-secondary-bg text-sm">
                    <span>Другая</span>
                    <input type="date" value={s.date} max={dateShiftISO(0)} onChange={e => d({ t: "date", v: e.target.value })}
                        className="bg-transparent text-right tabular-nums outline-none" />
                </label>
            </div>
        </Modal>
    );
}

function NotePicker({ open }: { open: boolean }) {
    const { s, d } = useApp();
    const [text, setText] = useState(s.note);
    return (
        <Modal open={open} onClose={() => d({ t: "modal", v: null })} title="Описание покупки">
            <textarea
                key={open ? "open" : "closed"}
                defaultValue={s.note}
                onChange={e => setText(e.target.value)}
                rows={3}
                placeholder="Введите описание"
                className="w-full rounded-xl bg-secondary-bg p-3 text-sm outline-none resize-none border border-border"
            />
            <div className="flex gap-2 mt-3">
                <button onClick={() => { setText(""); d({ t: "note", v: "" }); d({ t: "modal", v: null }); }}
                    className="flex-1 py-2.5 rounded-xl bg-secondary-bg text-sm text-hint">Очистить</button>
                <button onClick={() => { haptic("light"); d({ t: "note", v: text }); d({ t: "modal", v: null }); }}
                    className="flex-1 py-2.5 rounded-xl bg-accent text-accent-fg text-sm font-medium">OK</button>
            </div>
        </Modal>
    );
}

function MenuModal({ open }: { open: boolean }) {
    const { d } = useApp();
    return (
        <Modal open={open} onClose={() => d({ t: "modal", v: null })} title="Меню">
            <div className="space-y-1.5">
                <button onClick={() => { haptic("light"); d({ t: "screen", v: "history" }); }}
                    className="w-full flex items-center gap-3 py-3 px-3 rounded-xl bg-secondary-bg text-sm active:animate-pop">
                    <HistoryIcon className="h-4 w-4" /> История
                </button>
                <button disabled
                    className="w-full flex items-center gap-3 py-3 px-3 rounded-xl bg-secondary-bg/50 text-sm text-hint/60 cursor-not-allowed">
                    <BarChart3 className="h-4 w-4" /> Статистика <span className="ml-auto text-xs">скоро</span>
                </button>
            </div>
        </Modal>
    );
}
