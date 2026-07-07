import { History as HistoryIcon, BarChart3, X } from "lucide-react";
import { useBootstrap } from "@/api/queries";
import { useApp } from "@/store";
import { Modal } from "./Modal";
import { Currency } from "./Currency";
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
            <MenuModal open={s.modal === "menu"} />
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
                        className={cn("flex flex-col items-center gap-0.5 py-3 rounded-xl active:animate-pop transition-colors",
                            c.code === s.currency ? "bg-accent/15 text-accent ring-1 ring-accent/40" : "bg-secondary-bg")}>
                        <span className="text-2xl leading-none">{c.emoji ?? "💱"}</span>
                        <span className="text-xs font-medium">{c.code}</span>
                        <span className="text-[10px] text-hint leading-tight">{c.name}</span>
                    </button>
                ))}
            </div>
        </Modal>
    );
}

function AccountPicker({ open }: { open: boolean }) {
    const { s, d } = useApp();
    const { data } = useBootstrap();
    // SPEC-026 AC18 / SPEC-042 (SPC-01): инвест-ведро — актив, трат с него не бывает
    // (иначе реплей qty в /investments расходится с балансом). Сервер дублирует guard'ом.
    const accounts = (data?.accounts ?? []).filter(a => a.form !== "external" && a.is_active !== 0 && !a.is_investment);
    return (
        <Modal open={open} onClose={() => d({ t: "modal", v: null })} title="Счёт">
            <div className="space-y-1.5">
                <button onClick={() => { haptic("light"); d({ t: "account", v: null }); }}
                    className={cn("w-full flex items-center gap-3 py-3 px-3 rounded-xl active:animate-pop transition-colors text-left",
                        s.accountId === null ? "bg-accent/15 text-accent ring-1 ring-accent/40" : "bg-secondary-bg")}>
                    <X className="h-4 w-4" /> <span className="text-sm">Без счёта</span>
                </button>
                {accounts.map(a => (
                    <button key={a.id} onClick={() => { haptic("light"); d({ t: "account", v: a.id, ccy: a.currency }); }}
                        className={cn("w-full flex items-center justify-between py-3 px-3 rounded-xl active:animate-pop transition-colors text-left",
                            s.accountId === a.id ? "bg-accent/15 text-accent ring-1 ring-accent/40" : "bg-secondary-bg")}>
                        <span className="text-sm inline-flex items-center gap-2"><Currency code={a.currency} flagOnly className="text-lg" />{a.name}</span>
                        <Currency code={a.currency} size="xs" />
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
                    {/* MA-12 (SPEC-048): очистка значения (десктоп/часть Android) даёт "" —
                        пустую дату в драфт не пишем, остаёмся на прежней. */}
                    <input type="date" value={s.date} max={dateShiftISO(0)} onChange={e => { if (e.target.value) d({ t: "date", v: e.target.value }); }}
                        className="bg-transparent text-right tabular-nums outline-none" />
                </label>
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
                <button onClick={() => { haptic("light"); d({ t: "screen", v: "stats" }); }}
                    className="w-full flex items-center gap-3 py-3 px-3 rounded-xl bg-secondary-bg text-sm active:animate-pop">
                    <BarChart3 className="h-4 w-4" /> Статистика
                </button>
            </div>
        </Modal>
    );
}
