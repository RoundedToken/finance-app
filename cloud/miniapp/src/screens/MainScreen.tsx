import { useEffect, useRef, useState } from "react";
import { Menu, History as HistoryIcon, Calendar, MessageSquare, Wallet } from "lucide-react";
import { useBootstrap, useCreateExpense, useDeleteExpense } from "@/api/queries";
import { useApp, amountValue } from "@/store";
import { useToast } from "@/components/Toast";
import { CurrencyFlag } from "@/components/Currency";
import { Amount } from "@/components/Amount";
import { SwipeRow } from "@/components/SwipeRow";
import { Numpad } from "@/components/Numpad";
import { DayTotal } from "@/components/DayTotal";
import { haptic, confirmDialog } from "@/lib/telegram";
import { cn, fmt, humanDay } from "@/lib/utils";
import type { Category, Account, Expense, BudgetCategoryProgress, BudgetEnvelope } from "@/api/types";

export function MainScreen() {
    const { s, d } = useApp();
    const { data } = useBootstrap();
    const create = useCreateExpense();
    const toast = useToast();

    const cats = (data?.categories ?? []).filter(c => c.type === "expense" && c.is_active);
    // SPEC-020: read-only подсказка «осталось X €» на плитке категории с бюджетом.
    const budgetByCat = new Map((data?.budgets?.categories ?? []).map(b => [b.category_id, b] as const));
    // SPEC-023: read-only lens конверта для lumpy-категорий (вместо месячного остатка).
    const envelopeByCat = new Map((data?.budget_envelopes ?? []).map(e => [e.category_id, e] as const));
    // SPEC-032: привязанный счёт резолвим из ПОЛНОГО (не-external) списка, включая неактивные —
    // иначе легаси-трата на деактивированном счёте даёт UI-тупик (amber/override недоступны, а
    // сервер всё равно вернёт 400, т.к. валидирует по deleted_at, без is_active). Пикер при этом
    // предлагает только активные (отдельный фильтр в AccountPicker).
    const accounts = (data?.accounts ?? []).filter(a => a.form !== "external");
    const account = accounts.find(a => a.id === s.accountId) ?? null;

    // SPEC-032: пока драфт не тронут, держим валюту согласованной с липким счётом. Чинит
    // легаси-localStorage (счёт без сохранённой валюты) — первый драфт после деплоя не наследует
    // старый рассинхрон. amount==="0" страхует от перетирания осознанного override в процессе ввода.
    useEffect(() => {
        if (account && s.amount === "0" && !s.editingId && s.currency !== account.currency) {
            d({ t: "account", v: account.id, ccy: account.currency });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [account?.id, account?.currency]);

    const save = (categoryId: string) => {
        const amount = amountValue(s);
        if (amount <= 0) { haptic("error"); toast("Введите сумму", "err"); return; }
        const catName = cats.find(c => c.id === categoryId)?.name ?? "";
        create.mutate(
            // created_at не шлём: сервер ставит datetime('now') (SPEC-024 G3); s.date — локальный день.
            // SPEC-032: allow_currency_mismatch=true только при реальном осознанном рассогласовании (через override-гейт).
            // MA-01 (SPEC-042): id живёт в драфте — ретрай/двойной тап шлют тот же UUID (идемпотентность).
            { id: s.draftId, date: s.date, amount, currency: s.currency, category_id: categoryId, account_id: s.accountId, note: s.note || null,
              allow_currency_mismatch: !!account && s.currency !== account.currency },
            {
                onSuccess: () => { haptic("success"); toast(`✓ ${fmt(amount, s.currency)} ${s.currency} → ${catName}`); d({ t: "resetDraft" }); },
                onError: (e) => { haptic("error"); toast(e instanceof Error ? e.message : "Ошибка сохранения", "err"); },
            },
        );
    };

    return (
        <div className="min-h-screen flex flex-col">
            <header className="flex items-center justify-between px-4 py-3">
                <IconBtn label="Меню" onClick={() => d({ t: "modal", v: "menu" })}><Menu className="h-5 w-5" /></IconBtn>
                <Display account={account} />
                <IconBtn label="История" onClick={() => d({ t: "screen", v: "history" })}><HistoryIcon className="h-5 w-5" /></IconBtn>
            </header>

            <Numpad onKey={(k) => d({ t: "key", k })} className="px-4 mt-2" />

            <SideActions account={account} hasNote={!!s.note} />

            <Categories cats={cats} budgetByCat={budgetByCat} envelopeByCat={envelopeByCat} onPick={save} busy={create.isPending} canSave={amountValue(s) > 0} />

            <RecentDays />
        </div>
    );
}

function Display({ account }: { account: Account | null }) {
    const { s, d } = useApp();
    const mismatch = !!account && s.currency !== account.currency;
    // SPEC-032: валюта привязана к счёту. Открыть пикер можно только через осознанное
    // подтверждение (когда валюта пока совпадает со счётом). При уже-рассогласованной
    // (легаси-правка) или «без счёта» — пикер открывается сразу.
    const openCurrency = async () => {
        haptic("light");
        if (account && !mismatch) {
            const ok = await confirmDialog(`Валюта привязана к счёту «${account.name}» (${account.currency}). Записать в другой валюте? Так бывает редко.`);
            if (!ok) return;
        }
        d({ t: "modal", v: "currency" });
    };
    return (
        <button onClick={openCurrency} className="flex flex-col items-center min-w-0">
            <span className={cn("text-4xl font-semibold num tabular-nums leading-none truncate max-w-[60vw]", s.amount === "0" && "text-hint")}>{s.amount}</span>
            <span className={cn("mt-1 inline-flex items-center gap-1 text-sm", mismatch ? "text-amber-500 font-medium" : "text-hint")}>
                <CurrencyFlag code={s.currency} /> {s.currency}{mismatch && " ⚠"}
            </span>
        </button>
    );
}

function SideActions({ account, hasNote }: { account: Account | null; hasNote: boolean }) {
    const { s, d } = useApp();
    const mismatch = !!account && s.currency !== account.currency;
    return (
        <>
            <div className="grid grid-cols-3 gap-2 px-4 mt-3">
                <ActionChip icon={<Calendar className="h-4 w-4" />} label={humanDay(s.date)} onClick={() => d({ t: "modal", v: "date" })} />
                <ActionChip
                    icon={<Wallet className="h-4 w-4" />}
                    label={account ? <span className="inline-flex items-center gap-1"><CurrencyFlag code={account.currency} />{account.name}</span> : "Счёт"}
                    active={!!account}
                    danger={mismatch}
                    onClick={() => d({ t: "modal", v: "account" })}
                />
                <ActionChip icon={<MessageSquare className="h-4 w-4" />} label={hasNote ? "Описание ✓" : "Описание"} active={hasNote} onClick={() => d({ t: "screen", v: "note" })} />
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
        </>
    );
}

function ActionChip({ icon, label, active, danger, onClick }: { icon: React.ReactNode; label: React.ReactNode; active?: boolean; danger?: boolean; onClick: () => void }) {
    return (
        <button onClick={() => { haptic("light"); onClick(); }}
            className={cn("flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl text-xs font-medium truncate transition-colors active:animate-pop",
                danger ? "bg-amber-500/15 text-amber-600 ring-1 ring-amber-500/40" : active ? "bg-accent/15 text-accent" : "bg-secondary-bg text-hint")}>
            {icon}<span className="truncate">{label}</span>
        </button>
    );
}

function Categories({ cats, budgetByCat, envelopeByCat, onPick, busy, canSave }: { cats: Category[]; budgetByCat: Map<string, BudgetCategoryProgress>; envelopeByCat: Map<string, BudgetEnvelope>; onPick: (id: string) => void; busy: boolean; canSave: boolean }) {
    const PER = 8;
    const pages: Category[][] = [];
    for (let i = 0; i < cats.length; i += PER) pages.push(cats.slice(i, i + PER));
    const [page, setPage] = useState(0);
    const ref = useRef<HTMLDivElement>(null);
    const onScroll = () => { const el = ref.current; if (el) setPage(Math.round(el.scrollLeft / el.clientWidth)); };
    const disabled = busy || !canSave;

    return (
        <div className="mt-4">
            <div ref={ref} onScroll={onScroll} className="flex overflow-x-auto snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {pages.map((pg, i) => (
                    <div key={i} className="shrink-0 w-full snap-center grid grid-cols-4 gap-2 px-4">
                        {pg.map(c => (
                            <button key={c.id} disabled={disabled} onClick={() => onPick(c.id)}
                                style={{ background: (c.color ?? "#9ca3af") + "40" }}
                                className={cn("flex flex-col items-center gap-1 py-3 rounded-xl transition-all",
                                    disabled ? "opacity-40 pointer-events-none" : "active:animate-pop")}>
                                <span className="text-2xl leading-none">{c.emoji ?? "🏷"}</span>
                                <span className="text-[11px] text-center leading-tight">{c.name}</span>
                                {envelopeByCat.has(c.id)
                                    ? <EnvelopeHint e={envelopeByCat.get(c.id)} />
                                    : <BudgetHint b={budgetByCat.get(c.id)} />}
                            </button>
                        ))}
                    </div>
                ))}
            </div>
            {pages.length > 1 && (
                <div className="flex justify-center gap-1.5 py-2">
                    {pages.map((_, i) => <span key={i} className={cn("h-1.5 rounded-full transition-all", i === page ? "w-4 bg-accent" : "w-1.5 bg-hint/40")} />)}
                </div>
            )}
        </div>
    );
}

/** SPEC-020: read-only остаток бюджета на плитке категории. Только отображение. */
function BudgetHint({ b }: { b?: BudgetCategoryProgress }) {
    if (!b) return null;
    const over = b.remaining_eur < 0;
    const val = Math.round(Math.abs(b.remaining_eur));
    return (
        <span className={cn(
            "text-[9px] leading-none font-medium tabular-nums mt-0.5",
            b.status === "over" ? "text-red-600" : b.status === "warn" ? "text-amber-600" : "text-hint",
        )}>
            {over ? `−${val} €` : `≈${val} €`}
        </span>
    );
}

/** SPEC-023: read-only накопленное в годовом конверте (lumpy). Только отображение. */
function EnvelopeHint({ e }: { e?: BudgetEnvelope }) {
    if (!e) return null;
    return (
        <span className="text-[9px] leading-none font-medium tabular-nums mt-0.5 text-violet-500">
            🐷 {Math.round(e.accrued_eur)} €
        </span>
    );
}

function RecentDays() {
    const { s } = useApp();
    const { data } = useBootstrap();
    const expenses = data?.expenses ?? [];
    // последние 2 дня с тратами
    const byDay = new Map<string, typeof expenses>();
    for (const e of expenses) {
        const arr = byDay.get(e.date) ?? [];
        arr.push(e);
        byDay.set(e.date, arr);
    }
    const days = [...byDay.keys()].sort((a, b) => (a < b ? 1 : -1)).slice(0, 2);

    if (!days.length) return <div className="px-4 py-6 text-center text-hint text-sm">Пока нет трат</div>;

    return (
        <div className="px-4 mt-5 mb-2 space-y-4">
            {days.map(day => {
                const rows = byDay.get(day)!;
                return (
                    <div key={day}>
                        <div className="flex items-center justify-between px-1 mb-1.5 text-xs text-hint gap-2">
                            <span className="font-medium uppercase tracking-wide shrink-0">{humanDay(day)}</span>
                            <DayTotal rows={rows} base={s.baseCurrency} />
                        </div>
                        <div className="rounded-2xl overflow-hidden divide-y divide-border/40">
                            {/* SPEC-033: показываем ВСЕ траты дня — иначе итог DayTotal (по всем) не
                                сходится с обрезанным списком. История остаётся для кросс-дневного просмотра. */}
                            {rows.map(e => <RecentRow key={e.id} e={e} />)}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function RecentRow({ e }: { e: Expense }) {
    const { d } = useApp();
    const { data } = useBootstrap();
    const del = useDeleteExpense();
    const toast = useToast();
    const cat = data?.categories?.find(c => c.id === e.category_id);
    const acc = data?.accounts?.find(a => a.id === e.account_id);
    const remove = async () => {
        if (!(await confirmDialog("Удалить запись?"))) return;
        del.mutate(e.id, { onSuccess: () => { haptic("success"); toast("Удалено"); }, onError: () => { haptic("error"); toast("Ошибка", "err"); } });
    };
    return (
        <SwipeRow onTap={() => d({ t: "loadEdit", e })} onDelete={remove}>
            <div className="w-full flex items-center gap-3 py-2.5 px-3" style={{ background: (cat?.color ?? "#9ca3af") + "26" }}>
                <span className="h-9 w-9 rounded-full grid place-items-center text-lg shrink-0" style={{ background: (cat?.color ?? "#9ca3af") + "59" }}>{cat?.emoji ?? "🏷"}</span>
                <span className="flex-1 min-w-0">
                    <span className="block truncate text-sm">{cat?.name || "—"}</span>
                    {e.note && <span className="block truncate text-xs text-hint">{e.note}</span>}
                </span>
                <span className="text-right shrink-0 leading-tight">
                    <Amount amount={e.amount} currency={e.currency} className="text-sm" />
                    {acc && <span className="block text-[10px] text-hint mt-0.5">{acc.name}</span>}
                </span>
            </div>
        </SwipeRow>
    );
}

function IconBtn({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
    return (
        <button aria-label={label} onClick={() => { haptic("light"); onClick(); }}
            className="h-10 w-10 grid place-items-center rounded-full text-hint active:bg-secondary-bg transition-colors">
            {children}
        </button>
    );
}
