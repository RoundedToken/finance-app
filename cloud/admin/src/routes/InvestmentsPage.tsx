import { useEffect, useMemo, useState } from "react";
import { Coins, TrendingUp, Wallet, PiggyBank, ShoppingCart, RefreshCw, Sprout, Info } from "lucide-react";
import {
    useInvestments,
    useAccounts,
    useCreateTransaction,
    useCreateSnapshot,
    useUpdateInvestmentSettings,
} from "@/api/queries";
import { ErrorState } from "@/components/ErrorState";
import { Modal } from "@/components/Modal";
import { Select } from "@/components/Select";
import { Sparkline } from "@/components/Sparkline";
import { Currency, AccountOption } from "@/components/Currency";
import { cn, formatAmount, formatDate, formatExchangeRate, formatRelativeTime, hoursSince, todayLocal } from "@/lib/utils";
import { type Preset, PeriodPresets, PRESETS_WITH_AUTO, presetRange, startOfMonthMinus, todayIso } from "@/components/PeriodPresets";
import type { Account, InvestmentPosition, TransactionCreatePayload } from "@/api/types";

const eur = (v: number | null | undefined) => v == null ? "—" : `${formatAmount(v, "EUR")} €`;
const usdt = (v: number | null | undefined) => v == null ? "—" : `${formatAmount(v, "USDT")} USDT`;
const FORECAST_MONTHS = 3;

export function InvestmentsPage() {
    // SPEC-029/030: период графика. Дефолт «Авто» — окно от первой операции (без пустоты).
    const [preset, setPreset] = useState<Preset>("auto");
    const [cf, setCf] = useState<string>(startOfMonthMinus(11));
    const [ct, setCt] = useState<string>(todayIso());
    const { data, isLoading, isError, refetch } = useInvestments(presetRange(preset, cf, ct));
    const { data: accData } = useAccounts();
    const accounts = accData?.accounts ?? [];

    const [buyFor, setBuyFor] = useState<InvestmentPosition | null>(null);
    const [snapFor, setSnapFor] = useState<InvestmentPosition | null>(null);
    const [stakeFor, setStakeFor] = useState<InvestmentPosition | null>(null);

    const s = data?.summary;
    // SPEC-028: свежесть по времени последнего фетча (тика), а не по календарной дате.
    const fetchedAt = data?.rate_fetched_at ?? null;
    const staleRates = fetchedAt ? hoursSince(fetchedAt) >= 12 : false;

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-3xl font-semibold tracking-tight">Инвестиции</h1>
                    <p className="text-muted-foreground mt-1">
                        Крипто-портфель (ETH + стейкинг). Входит в net worth, но <b>не</b> в свободные деньги.
                        {fetchedAt
                            ? <span className="ml-1">Курс ETH обновлён {formatRelativeTime(fetchedAt)}.</span>
                            : data?.rates_date && <span className="ml-1">Курс ETH: {data.rates_date}.</span>}
                    </p>
                </div>
                <div className="flex items-start gap-2">
                    <PeriodPresets preset={preset} setPreset={setPreset} cf={cf} ct={ct} setCf={setCf} setCt={setCt} presets={PRESETS_WITH_AUTO} />
                    <button onClick={() => refetch()} className="btn-ghost self-start" title="Обновить" aria-label="Обновить">
                        <RefreshCw className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {staleRates && (
                <div className="card p-3 border-amber-500/50 bg-amber-500/10 text-sm text-amber-700 dark:text-amber-300 flex items-center gap-2">
                    <Info className="h-4 w-4 shrink-0" />
                    Курс ETH обновлялся {formatRelativeTime(fetchedAt!)} — мог устареть (провайдеры не отвечают?). Цифры по последнему известному курсу.
                </div>
            )}

            {isError ? (
                <ErrorState onRetry={() => refetch()} label="Не удалось загрузить инвестиции" />
            ) : isLoading || !data ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                    {Array.from({ length: 4 }).map((_, i) => <div key={i} className="card p-6 h-28 animate-pulse bg-muted/40" />)}
                </div>
            ) : data.positions.length === 0 ? (
                <div className="card p-12 text-center text-muted-foreground space-y-2">
                    <Coins className="h-8 w-8 mx-auto opacity-60" />
                    <div className="font-medium text-foreground">Пока нет позиций</div>
                    <div>Сделай первый обмен USDT → ETH (в разделе «Обмены» или кнопкой на карточке), чтобы начать трекинг.</div>
                </div>
            ) : (
                <>
                    {/* KPI */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                        <KpiCard icon={Wallet} label="Стоимость портфеля" value={eur(s!.value_eur)} sub={`≈ ${usdt(s!.value_usdt)}`} />
                        <KpiCard icon={PiggyBank} label="Вложено (cost basis)"
                            value={s!.cost_basis_known ? eur(s!.cost_basis_eur) : "—"}
                            sub={s!.cost_basis_known ? undefined : "часть позиций без затратной цены"} />
                        <KpiCard icon={TrendingUp} label="P&L (нереализованный)"
                            value={s!.cost_basis_known ? eur(s!.unrealized_pl_eur) : "—"}
                            tone={s!.cost_basis_known ? (s!.unrealized_pl_eur >= 0 ? "pos" : "neg") : undefined}
                            sub={s!.cost_basis_known && s!.unrealized_pl_pct != null ? `${s!.unrealized_pl_pct >= 0 ? "+" : ""}${s!.unrealized_pl_pct}%` : undefined} />
                        <KpiCard icon={Sprout} label="Доход стейкинга" value={eur(s!.staking_income_eur)}
                            tone={s!.staking_income_eur > 0 ? "pos" : undefined}
                            sub={s!.staking_forecast_eur > 0 ? `прогноз +${eur(s!.staking_forecast_eur)} · ≈${eur(s!.staking_expected_annual_eur)}/год` : undefined} />
                    </div>

                    {/* Позиции */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {data.positions.map(p => (
                            <PositionCard key={p.account_id} p={p}
                                onBuy={() => setBuyFor(p)} onSnapshot={() => setSnapFor(p)} onStake={() => setStakeFor(p)} />
                        ))}
                    </div>
                </>
            )}

            <BuyModal position={buyFor} accounts={accounts} onClose={() => setBuyFor(null)} />
            <BalanceSnapshotModal position={snapFor} onClose={() => setSnapFor(null)} />
            <StakingModal position={stakeFor} onClose={() => setStakeFor(null)} />
        </div>
    );
}

// ── KPI card ──────────────────────────────────────────────────────────────────

function KpiCard({ icon: Icon, label, value, sub, tone }: {
    icon: typeof Wallet; label: string; value: React.ReactNode; sub?: string; tone?: "pos" | "neg";
}) {
    return (
        <div className="card p-5">
            <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{label}</span>
                <Icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className={cn("mt-2 text-2xl font-semibold tracking-tight num",
                tone === "pos" && "text-positive", tone === "neg" && "text-destructive")}>{value}</div>
            {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
        </div>
    );
}

// ── Position card ──────────────────────────────────────────────────────────────

function PositionCard({ p, onBuy, onSnapshot, onStake }: {
    p: InvestmentPosition; onBuy: () => void; onSnapshot: () => void; onStake: () => void;
}) {
    const color = p.color ?? "#627eea";
    const plPos = (p.unrealized_pl_eur ?? 0) >= 0;
    const effApr = p.staking_apr_pct ?? 0;
    const aprSource = p.staking_apr_override != null ? "вручную" : "Lido";

    // Спарклайн: факт (value_series) + прогноз по APR пунктиром — растёт ТОЛЬКО
    // застейканная доля (свободный ETH не приносит стейкинг-доход, SPEC-027 G4).
    const factValues = p.value_series.map(pt => pt.value_eur);
    const lastVal = factValues[factValues.length - 1] ?? 0;
    const stakedFrac = p.qty > 0 ? Math.max(0, Math.min(1, p.staked_qty / p.qty)) : 0;
    const stakedValue = lastVal * stakedFrac;
    const showForecast = p.is_staked && effApr > 0 && factValues.length >= 2 && stakedValue > 0;
    const forecast = showForecast
        ? Array.from({ length: FORECAST_MONTHS }, (_, i) => lastVal + stakedValue * (Math.pow(1 + effApr / 100, (i + 1) / 12) - 1))
        : [];
    const sparkValues = [...factValues, ...forecast];

    return (
        <div className="card p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                    <span className="h-9 w-9 rounded-xl grid place-items-center text-lg shrink-0"
                        style={{ background: color + "22", color }}>⟠</span>
                    <div className="min-w-0">
                        <div className="font-medium truncate">{p.name}</div>
                        <div className="text-xs text-muted-foreground tabular-nums">
                            {formatAmount(p.qty, p.currency)} <Currency code={p.currency} size="xs" />
                            {p.price_eur != null && <> · курс {eur(p.price_eur)}{p.price_usdt != null ? ` · ${usdt(p.price_usdt)}` : ""}</>}
                        </div>
                    </div>
                </div>
                {p.is_staked && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/15 text-primary font-medium whitespace-nowrap">
                        в стейкинге{p.staking_apr_pct != null ? ` · APR ${p.staking_apr_pct}% (${aprSource})` : ""}
                    </span>
                )}
            </div>

            <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <span className="text-2xl font-semibold tracking-tight num">
                    {eur(p.value_eur)}
                    {p.value_usdt != null && <span className="ml-2 text-sm font-normal text-muted-foreground">≈ {usdt(p.value_usdt)}</span>}
                </span>
                {p.cost_basis_known ? (
                    <span className={cn("text-sm font-medium num", plPos ? "text-positive" : "text-destructive")}>
                        P&L {plPos ? "+" : ""}{eur(p.unrealized_pl_eur)}{p.unrealized_pl_pct != null ? ` (${plPos ? "+" : ""}${p.unrealized_pl_pct}%)` : ""}
                    </span>
                ) : (
                    <span className="text-xs text-muted-foreground inline-flex items-center gap-1"
                        title="Затратная цена неизвестна: ETH занесён снимком без обмена. Чтобы считать P&L, заноси покупки через обмен USDT→ETH.">
                        <Info className="h-3 w-3" /> P&L —
                    </span>
                )}
            </div>

            <div className="text-xs text-muted-foreground space-y-1">
                <div className="flex justify-between">
                    <span>Вложено</span>
                    <span className="num tabular-nums">{p.cost_basis_known ? eur(p.cost_basis_eur) : "—"}</span>
                </div>
                {p.qty > 0 && (
                    <div className="flex justify-between">
                        <span>Стейкинг</span>
                        <span className="num tabular-nums">
                            застейкано {formatAmount(p.staked_qty, p.currency)} · свободно {formatAmount(p.liquid_qty, p.currency)} <Currency code={p.currency} size="xs" />
                        </span>
                    </div>
                )}
                {p.is_staked && (
                    <>
                        {p.staking_forecast_eur != null && (
                            <div className="flex justify-between">
                                <span className="inline-flex items-center gap-1.5">
                                    Доход стейкинга <span className="text-primary text-[11px]">прогноз</span>
                                    {p.staked_since && <span className="text-[10px] opacity-60">с {formatDate(p.staked_since)}{p.staking_apr_pct != null ? `, ${p.staking_apr_pct}%` : ""}</span>}
                                </span>
                                <span className="num tabular-nums text-primary">
                                    +{eur(p.staking_forecast_eur)}
                                    {p.staking_expected_annual_eur != null && <span className="opacity-70"> · ≈{eur(p.staking_expected_annual_eur)}/год</span>}
                                </span>
                            </div>
                        )}
                        <div className="flex justify-between">
                            <span className="opacity-80">факт{p.last_snapshot_date ? ` (снапшот ${formatDate(p.last_snapshot_date)})` : ""}</span>
                            <span className={cn("num tabular-nums", (p.staking_income_eur ?? 0) > 0 && "text-positive")}>
                                {p.staking_income_eur != null ? `+${eur(p.staking_income_eur)}` : "—"}
                                {p.staking_income_qty != null && p.staking_income_qty > 0 ? ` (+${formatAmount(p.staking_income_qty, p.currency)})` : ""}
                            </span>
                        </div>
                    </>
                )}
            </div>

            {sparkValues.length >= 2 && (
                <div>
                    <Sparkline values={sparkValues} color={color} inProgressTail={forecast.length} />
                    <div className="text-[10px] text-muted-foreground mt-1 flex items-center gap-3">
                        <span className="inline-flex items-center gap-1"><span className="inline-block w-3 border-t-2" style={{ borderColor: color }} /> факт</span>
                        {showForecast && <span className="inline-flex items-center gap-1"><span className="inline-block w-3 border-t-2 border-dashed" style={{ borderColor: color }} /> прогноз APR (не реальные деньги)</span>}
                    </div>
                </div>
            )}

            {p.is_staked && !p.last_snapshot_date && (
                <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-lg p-2.5">
                    Обнови баланс с биржи, чтобы зафиксировать доход стейкинга (пока показан только прогноз).
                </div>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
                <button onClick={onBuy} className="btn-primary px-3 py-1.5 text-sm"><ShoppingCart className="h-4 w-4" /> Купить ETH</button>
                <button onClick={onSnapshot} className="btn-ghost border px-3 py-1.5 text-sm"><RefreshCw className="h-4 w-4" /> Обновить баланс</button>
                <button onClick={onStake} className="btn-ghost border px-3 py-1.5 text-sm"><Sprout className="h-4 w-4" /> Стейкинг</button>
            </div>
        </div>
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

// ── Buy modal (exchange USDT→ETH, переиспользует transactions) ─────────────────

function BuyModal({ position, accounts, onClose }: { position: InvestmentPosition | null; accounts: Account[]; onClose: () => void }) {
    const create = useCreateTransaction();
    const open = !!position;
    // Источники — обычные (не инвест) вёдра; дефолт — USDT-ведро.
    const sources = useMemo(() => accounts.filter(a => !a.is_investment), [accounts]);
    const [fromId, setFromId] = useState("");
    const [fromAmt, setFromAmt] = useState("");
    const [toAmt, setToAmt] = useState("");
    const [fee, setFee] = useState("");
    const [date, setDate] = useState(todayLocal());
    const [note, setNote] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        const usdt = sources.find(a => a.currency === "USDT") ?? sources[0];
        setFromId(usdt?.id ?? ""); setFromAmt(""); setToAmt(""); setFee(""); setDate(todayLocal()); setNote(""); setSubmitting(false); setError(null);
    }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps

    if (!position) return null;
    const from = sources.find(a => a.id === fromId);
    const numFrom = parseFloat(fromAmt), numTo = parseFloat(toAmt), numFee = parseFloat(fee);
    const sameCcy = from?.currency === position.currency;
    const valid = !!date && !!fromId && !sameCcy && Number.isFinite(numFrom) && numFrom > 0 && Number.isFinite(numTo) && numTo > 0;
    const rateText = from ? formatExchangeRate(numFrom, from.currency, numTo, position.currency) : null;

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!valid) return;
        setSubmitting(true); setError(null);
        try {
            const payload: TransactionCreatePayload = {
                type: "exchange", date,
                from_account_id: fromId, to_account_id: position.account_id,
                from_amount: numFrom, to_amount: numTo,
                fee_amount: Number.isFinite(numFee) && numFee > 0 ? numFee : null,
                fee_currency: Number.isFinite(numFee) && numFee > 0 ? (from?.currency ?? null) : null,
                note: note.trim() || null,
            };
            await create.mutateAsync(payload);
            onClose();
        } catch (err: any) {
            setError(err?.message ?? "Не удалось создать обмен");
        } finally { setSubmitting(false); }
    };

    return (
        <Modal open={open} onClose={onClose} title={`Купить ${position.currency}`} size="md">
            <form onSubmit={submit} className="space-y-4">
                <Field label="Дата">
                    <input type="date" value={date} onChange={e => setDate(e.target.value)}
                        className="px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                </Field>
                <Field label="Откуда (списываем)">
                    <Select fullWidth value={fromId} onChange={e => setFromId(e.target.value)}>
                        <option value="">— выбери ведро —</option>
                        {sources.map(a => <AccountOption key={a.id} account={a} />)}
                    </Select>
                    <input type="number" inputMode="decimal" step="any" min="0" value={fromAmt} onChange={e => setFromAmt(e.target.value)}
                        placeholder={from ? `сумма в ${from.currency}` : "сумма"}
                        className="mt-2 w-full px-3 py-2 rounded-lg border bg-background text-base tabular-nums focus:outline-none focus:ring-2 focus:ring-ring [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                </Field>
                <Field label={`Получаем (${position.currency})`}>
                    <input type="number" inputMode="decimal" step="any" min="0" value={toAmt} onChange={e => setToAmt(e.target.value)}
                        placeholder={`сколько ${position.currency}`}
                        className="w-full px-3 py-2 rounded-lg border bg-background text-base tabular-nums focus:outline-none focus:ring-2 focus:ring-ring [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                </Field>
                <Field label={`Комиссия биржи (опц., в ${from?.currency ?? "валюте источника"})`}>
                    <input type="number" inputMode="decimal" step="any" min="0" value={fee} onChange={e => setFee(e.target.value)} placeholder="0"
                        className="w-full px-3 py-2 rounded-lg border bg-background text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                </Field>
                {sameCcy && fromId && (
                    <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-lg p-3">
                        Источник в той же валюте, что и актив — для покупки нужна другая валюта (напр. USDT).
                    </div>
                )}
                {rateText && !sameCcy && (
                    <div className="text-sm text-muted-foreground bg-secondary/40 rounded-lg p-3 tabular-nums">💱 Курс: <span className="text-foreground font-medium">{rateText}</span></div>
                )}
                {error && <div className="text-sm rounded-lg p-3 border border-destructive/40 bg-destructive/10 text-destructive">{error}</div>}
                <div className="flex justify-end gap-2 pt-2">
                    <button type="button" onClick={onClose} className="btn-ghost px-4 py-2">Отмена</button>
                    <button type="submit" disabled={!valid || submitting} className="btn-primary px-4 py-2 min-w-[7rem]">{submitting ? "…" : "Купить"}</button>
                </div>
            </form>
        </Modal>
    );
}

// ── Balance snapshot modal (ребейзинг = ground truth) ──────────────────────────

function BalanceSnapshotModal({ position, onClose }: { position: InvestmentPosition | null; onClose: () => void }) {
    const create = useCreateSnapshot();
    const open = !!position;
    const [amount, setAmount] = useState("");
    const [date, setDate] = useState(todayLocal());
    const [note, setNote] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open || !position) return;
        setAmount(String(position.qty)); setDate(todayLocal()); setNote(""); setSubmitting(false); setError(null);
    }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps

    if (!position) return null;
    const num = parseFloat(amount);
    const valid = !!date && Number.isFinite(num) && num >= 0;
    const delta = Number.isFinite(num) ? num - position.qty : 0;

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!valid) return;
        setSubmitting(true); setError(null);
        try {
            await create.mutateAsync({ date, account_id: position.account_id, amount: num, note: note.trim() || null });
            onClose();
        } catch (err: any) {
            setError(err?.message ?? "Не удалось сохранить баланс");
        } finally { setSubmitting(false); }
    };

    return (
        <Modal open={open} onClose={onClose} title={`Обновить баланс ${position.currency}`} size="md">
            <form onSubmit={submit} className="space-y-4">
                <p className="text-sm text-muted-foreground">
                    Внеси фактический баланс {position.currency} с биржи (Bybit) на дату. Прирост над покупками = доход стейкинга.
                </p>
                <div className="grid grid-cols-[1fr_auto] gap-3">
                    <Field label={`Баланс (${position.currency})`}>
                        <input type="number" inputMode="decimal" step="any" min="0" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0"
                            className="w-full px-3 py-2 rounded-lg border bg-background text-base tabular-nums focus:outline-none focus:ring-2 focus:ring-ring [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                    </Field>
                    <Field label="Дата">
                        <input type="date" value={date} onChange={e => setDate(e.target.value)}
                            className="px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                    </Field>
                </div>
                {Number.isFinite(num) && Math.abs(delta) > 1e-9 && (
                    <div className="text-xs text-muted-foreground bg-secondary/40 rounded-lg p-3 -mt-1">
                        Текущая позиция: <span className="num tabular-nums">{formatAmount(position.qty, position.currency)}</span> ·{" "}
                        <span className={cn("font-medium", delta > 0 ? "text-positive" : "text-negative")}>
                            {delta > 0 ? "+" : ""}{formatAmount(delta, position.currency)}
                        </span>
                    </div>
                )}
                <Field label="Описание (опц.)">
                    <input type="text" value={note} onChange={e => setNote(e.target.value)} maxLength={500} placeholder="напр. ребейзинг stETH за месяц"
                        className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                </Field>
                {error && <div className="text-sm rounded-lg p-3 border border-destructive/40 bg-destructive/10 text-destructive">{error}</div>}
                <div className="flex justify-end gap-2 pt-2">
                    <button type="button" onClick={onClose} className="btn-ghost px-4 py-2">Отмена</button>
                    <button type="submit" disabled={!valid || submitting} className="btn-primary px-4 py-2 min-w-[7rem]">{submitting ? "…" : "Сохранить"}</button>
                </div>
            </form>
        </Modal>
    );
}

// ── Staking settings modal ─────────────────────────────────────────────────────

function StakingModal({ position, onClose }: { position: InvestmentPosition | null; onClose: () => void }) {
    const update = useUpdateInvestmentSettings();
    const open = !!position;
    const [stakedAmt, setStakedAmt] = useState("");
    const [apr, setApr] = useState("");
    const [note, setNote] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open || !position) return;
        setStakedAmt(position.staked_qty > 0 ? String(position.staked_qty) : "");
        // в поле override — только ручное значение; авто Lido показываем плейсхолдером
        setApr(position.staking_apr_override != null ? String(position.staking_apr_override) : "");
        setNote(position.note ?? "");
        setSubmitting(false); setError(null);
    }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps

    if (!position) return null;
    const numStaked = stakedAmt === "" ? 0 : parseFloat(stakedAmt);
    const stakedValid = Number.isFinite(numStaked) && numStaked >= 0 && numStaked <= position.qty + 1e-9;
    const numApr = apr === "" ? null : parseFloat(apr);
    const aprValid = numApr == null || (Number.isFinite(numApr) && numApr >= 0 && numApr <= 100);
    const valid = stakedValid && aprValid;
    const liquidPreview = Number.isFinite(numStaked) ? Math.max(0, position.qty - numStaked) : position.qty;
    const aprPlaceholder = position.staking_apr_auto != null ? `авто Lido ${position.staking_apr_auto}%` : "напр. 3.6";

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!valid) return;
        setSubmitting(true); setError(null);
        try {
            await update.mutateAsync({ accountId: position.account_id, patch: { staked_qty: numStaked, staking_apr_pct: numApr, note: note.trim() || null } });
            onClose();
        } catch (err: any) {
            setError(err?.message ?? "Не удалось сохранить настройки");
        } finally { setSubmitting(false); }
    };

    return (
        <Modal open={open} onClose={onClose} title="Стейкинг" size="md">
            <form onSubmit={submit} className="space-y-4">
                <Field label={`Сколько ${position.currency} в стейкинге (макс ${formatAmount(position.qty, position.currency)}; 0 = убрать)`}>
                    <input type="number" inputMode="decimal" step="any" min="0" max={position.qty} value={stakedAmt} onChange={e => setStakedAmt(e.target.value)} placeholder="0"
                        className="w-full px-3 py-2 rounded-lg border bg-background text-base tabular-nums focus:outline-none focus:ring-2 focus:ring-ring [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                </Field>
                {!stakedValid && <div className="text-xs text-destructive">Должно быть от 0 до {formatAmount(position.qty, position.currency)} {position.currency}.</div>}
                {stakedValid && (
                    <div className="text-xs text-muted-foreground bg-secondary/40 rounded-lg p-3 -mt-1">
                        застейкано <span className="num tabular-nums">{formatAmount(numStaked, position.currency)}</span> · свободно <span className="num tabular-nums">{formatAmount(liquidPreview, position.currency)}</span> {position.currency}
                    </div>
                )}
                <Field label="APR override, % (опц. — пусто = авто из Lido)">
                    <input type="number" inputMode="decimal" step="any" min="0" max="100" value={apr} onChange={e => setApr(e.target.value)} placeholder={aprPlaceholder}
                        className="w-full px-3 py-2 rounded-lg border bg-background text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                </Field>
                {!aprValid && <div className="text-xs text-destructive">APR должен быть в диапазоне 0–100.</div>}
                <Field label="Заметка (опц.)">
                    <input type="text" value={note} onChange={e => setNote(e.target.value)} maxLength={500} placeholder="напр. Bybit Earn"
                        className="w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                </Field>
                <p className="text-xs text-muted-foreground">
                    APR тянется автоматически с Lido (базовый stETH); перебей вручную, если Bybit даёт другой. Прогноз-пунктир — визуальная подсказка, не реальные деньги; факт дохода — из снапшотов баланса.
                </p>
                {error && <div className="text-sm rounded-lg p-3 border border-destructive/40 bg-destructive/10 text-destructive">{error}</div>}
                <div className="flex justify-end gap-2 pt-2">
                    <button type="button" onClick={onClose} className="btn-ghost px-4 py-2">Отмена</button>
                    <button type="submit" disabled={!valid || submitting} className="btn-primary px-4 py-2 min-w-[7rem]">{submitting ? "…" : "Сохранить"}</button>
                </div>
            </form>
        </Modal>
    );
}
