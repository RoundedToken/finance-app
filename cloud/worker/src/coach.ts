/**
 * SPEC-040 — детерминированный coach (AI-трек, шаг 1). Раз в день правила качества
 * данных + пороги; ОДИН Telegram-нудж при сигнале, молчит когда всё ок. БЕЗ LLM.
 *
 * Ядро (`signalsFor`) — чистая функция (картина → сигналы), тестируемо. Сбор данных
 * и отправка — отдельно. Падение нуджа изолировано в scheduled() (не валит rates-cron).
 */
import type { Env } from "./types";
import { getDashboard } from "./dashboard";
import { effectiveBalancePerAccount, listBuckets } from "./snapshots";
import { getBudgetsWithProgress } from "./budgets";
import { listGoals } from "./goals";
import { loadRatesIndex, type RatesIndex } from "./rates";
import { sendMessage, escapeHtml } from "./bot";

export interface CoachConfig {
    GAP_DAYS: number;            // нет трат дольше → сигнал
    SNAPSHOT_STALE_DAYS: number; // снапшоты старше → сигнал
    RUNWAY_FLOOR: number;        // runway ниже (мес) → сигнал
    SPIKE_FACTOR: number;        // категория ≥ factor × трейлинг-среднего → аномалия
    SPIKE_FLOOR_EUR: number;     // и не меньше этого абсолюта (отсекаем мелочь)
    COOLDOWN_DAYS: number;       // один сигнал не повторяется чаще
    MAX_SIGNALS: number;         // максимум строк в одном сообщении
}
export const COACH_CONFIG: CoachConfig = {
    GAP_DAYS: 3, SNAPSHOT_STALE_DAYS: 14, RUNWAY_FLOOR: 3,
    SPIKE_FACTOR: 2, SPIKE_FLOOR_EUR: 50, COOLDOWN_DAYS: 4, MAX_SIGNALS: 4,
};

export interface CoachSnapshot {
    today: string;                  // YYYY-MM-DD (UTC)
    lastExpenseDate: string | null;
    lastSnapshotDate: string | null;
    bucketsNoBaseline: string[];    // не-инвест вёдра с событиями, но без manual baseline
    missingRates: number;
    freeEur: number;
    runwayMonths: number | null;
    budgetsOver: { name: string; pct: number }[];
    goalsOverdue: string[];
    categorySpikes: { name: string; eur: number; factor: number }[];
}

export interface Signal { key: string; priority: number; text: string; }

const pad2 = (n: number) => String(n).padStart(2, "0");
function daysBetween(a: string, b: string): number {
    return Math.floor((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
function addMonthsYm(ym: string, d: number): string {
    const [y, m] = ym.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1 + d, 1));
    return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}`;
}
const eur = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} €`;

/**
 * ЧИСТОЕ ЯДРО: финкартина → список сигналов (priority: меньше = выше). Без I/O.
 * Приоритеты: 1 качество данных · 2 бюджеты/цели · 3 net worth/runway · 4 аномалии.
 */
export function signalsFor(s: CoachSnapshot, cfg: CoachConfig = COACH_CONFIG): Signal[] {
    const out: Signal[] = [];

    // ── Качество данных (приоритет 1) — то, чего не видно на дашборде ──
    if (s.lastExpenseDate) {
        const d = daysBetween(s.lastExpenseDate, s.today);
        if (d >= cfg.GAP_DAYS) out.push({ key: "gap_no_expenses", priority: 1, text: `🔸 Нет трат ${d} дн. — записал всё?` });
    }
    if (s.lastSnapshotDate) {
        const d = daysBetween(s.lastSnapshotDate, s.today);
        if (d >= cfg.SNAPSHOT_STALE_DAYS) out.push({ key: "stale_snapshots", priority: 1, text: `🔸 Снапшоты не обновлялись ${d} дн. — балансы дрейфуют.` });
    }
    if (s.bucketsNoBaseline.length) {
        const names = s.bucketsNoBaseline.slice(0, 3).map(escapeHtml).join(", ");
        const more = s.bucketsNoBaseline.length > 3 ? ` и ещё ${s.bucketsNoBaseline.length - 3}` : "";
        out.push({ key: "bucket_no_baseline", priority: 1, text: `🔸 Без baseline: ${names}${more} — баланс неточен.` });
    }
    if (s.missingRates > 0) {
        out.push({ key: "missing_rates", priority: 1, text: `🔸 ${s.missingRates} поз. без курса — net worth недосчитан.` });
    }

    // ── Бюджеты / цели (приоритет 2) ──
    if (s.budgetsOver.length) {
        const worst = [...s.budgetsOver].sort((a, b) => b.pct - a.pct)[0];
        const more = s.budgetsOver.length > 1 ? ` и ещё ${s.budgetsOver.length - 1}` : "";
        out.push({ key: "budget_over", priority: 2, text: `🔸 Бюджет «${escapeHtml(worst.name)}» превышен (${Math.round(worst.pct)}%)${more}.` });
    }
    if (s.goalsOverdue.length) {
        const names = s.goalsOverdue.slice(0, 2).map(escapeHtml).join(", ");
        const more = s.goalsOverdue.length > 2 ? ` и ещё ${s.goalsOverdue.length - 2}` : "";
        out.push({ key: "goal_overdue", priority: 2, text: `🔸 Цель просрочена: ${names}${more}.` });
    }

    // ── Net worth / runway (приоритет 3) — ПОРОГ, не сводка (NG4) ──
    // Эпсилон −0.5: не палим (и не показываем «−0 €») на копеечном минусе.
    const freeNegative = s.freeEur < -0.5;
    if (freeNegative) {
        out.push({ key: "free_negative", priority: 3, text: `🔸 Свободные деньги в минусе (${eur(s.freeEur)}) — цели недообеспечены.` });
    }
    // runway_low подавляем, если уже палит free_negative — один корень (runway = free/burn → 0), не съедаем 2 слота.
    if (!freeNegative && s.runwayMonths != null && s.runwayMonths < cfg.RUNWAY_FLOOR) {
        out.push({ key: "runway_low", priority: 3, text: `🔸 Runway ${s.runwayMonths} мес — ниже ${cfg.RUNWAY_FLOOR}.` });
    }

    // ── Аномалия трат (приоритет 4, грубая — тонкая версия = routine, шаг 2) ──
    if (s.categorySpikes.length) {
        const top = s.categorySpikes[0];
        out.push({ key: "spending_spike", priority: 4, text: `🔸 «${escapeHtml(top.name)}»: ${eur(top.eur)} в этом месяце — ×${top.factor.toFixed(1)} к среднему.` });
    }

    return out.sort((a, b) => a.priority - b.priority);
}

interface DashShape { kpi: { free_net_worth_eur: number; missing_rates: number; runway_months: number | null } }

/** Сбор финкартины из D1 (rates грузим 1× и шарим — SPEC-038). */
export async function gatherCoachSnapshot(env: Env, today: string): Promise<CoachSnapshot> {
    const rates = await loadRatesIndex(env);
    const [dash, eff, buckets, budgets, goals, lastExp, lastSnap, spikes] = await Promise.all([
        getDashboard(env, { today }) as Promise<DashShape>,
        effectiveBalancePerAccount(env, today),
        listBuckets(env),
        getBudgetsWithProgress(env, { month: today.slice(0, 7) }, rates),   // месяц cron-today, не todayUtc()
        listGoals(env, { status: "active" }, rates),
        env.DB.prepare("SELECT MAX(date) AS d FROM expenses WHERE deleted_at IS NULL").first<{ d: string | null }>(),
        env.DB.prepare("SELECT MAX(date) AS d FROM snapshots WHERE deleted_at IS NULL").first<{ d: string | null }>(),
        computeCategorySpikes(env, today, rates),
    ]);

    const bucketsNoBaseline: string[] = [];
    for (const b of buckets as Array<{ id: string; name: string; is_investment?: number; is_active?: number }>) {
        if (b.is_investment || b.is_active === 0) continue;   // инвест-вёдра и архивные не нудим
        const e = eff[b.id];
        if (e && e.manual_baseline == null && e.events_count > 0) bucketsNoBaseline.push(b.name);
    }

    return {
        today,
        lastExpenseDate: lastExp?.d ?? null,
        lastSnapshotDate: lastSnap?.d ?? null,
        bucketsNoBaseline,
        missingRates: dash.kpi.missing_rates,
        freeEur: dash.kpi.free_net_worth_eur,
        runwayMonths: dash.kpi.runway_months,
        budgetsOver: budgets.categories.filter(c => c.status === "over").map(c => ({ name: c.name, pct: c.pct })),
        goalsOverdue: goals.filter(g => g.deadline && g.deadline < today && g.status === "active").map(g => g.name),
        categorySpikes: spikes,
    };
}

/** Грубая аномалия: сумма категории за текущий месяц ≥ factor × (среднее за пред. 3 мес). */
async function computeCategorySpikes(env: Env, today: string, rates: RatesIndex): Promise<{ name: string; eur: number; factor: number }[]> {
    const cfg = COACH_CONFIG;
    const curMonth = today.slice(0, 7);
    const from = `${addMonthsYm(curMonth, -3)}-01`;
    const rows = await env.DB.prepare(
        `SELECT e.category_id AS cid, e.date AS date, e.amount AS amount, e.currency AS currency, c.name AS name
           FROM expenses e LEFT JOIN categories c ON c.id = e.category_id
          WHERE e.deleted_at IS NULL AND e.date >= ?`,
    ).bind(from).all<{ cid: string | null; date: string; amount: number; currency: string; name: string | null }>();

    const cur = new Map<string, { name: string; sum: number }>();
    const prior = new Map<string, number>();
    const priorMonths = new Map<string, Set<string>>();   // распред. среднее по ФАКТИЧЕСКИМ месяцам с данными
    for (const r of rows.results) {
        const e = rates.toEurAt(r.amount, r.currency, r.date);
        if (e == null) continue;
        const cid = r.cid ?? "—";
        if (r.date.slice(0, 7) === curMonth) {
            const cell = cur.get(cid) ?? { name: r.name ?? "Без категории", sum: 0 };
            cell.sum += e; cur.set(cid, cell);
        } else {
            prior.set(cid, (prior.get(cid) ?? 0) + e);
            (priorMonths.get(cid) ?? priorMonths.set(cid, new Set()).get(cid)!).add(r.date.slice(0, 7));
        }
    }
    const out: { name: string; eur: number; factor: number }[] = [];
    for (const [cid, { name, sum }] of cur) {
        // Среднее по числу прошедших месяцев С ДАННЫМИ (не всегда 3) — иначе на молодой
        // системе среднее занижается и factor ложно раздувается (QA).
        const months = priorMonths.get(cid)?.size ?? 0;
        if (months === 0) continue;
        const avg = (prior.get(cid) ?? 0) / months;
        if (avg > 0 && sum >= cfg.SPIKE_FACTOR * avg && sum >= cfg.SPIKE_FLOOR_EUR) {
            out.push({ name, eur: Math.round(sum), factor: sum / avg });
        }
    }
    return out.sort((a, b) => b.factor - a.factor);
}

async function ownerChatIds(env: Env): Promise<number[]> {
    const r = await env.DB.prepare("SELECT telegram_id FROM authorized_users").all<{ telegram_id: string }>();
    // chat_id == telegram_id (приватный чат); пустой/0/нечисловой id отсекаем (иначе Number("")=0).
    return r.results.map(x => Number(x.telegram_id)).filter(n => Number.isInteger(n) && n > 0);
}

/**
 * Главный вход (cron). Собирает картину → правила → cooldown-фильтр → одно сообщение
 * (если есть что сказать) → запись `coach_state`. При ошибке отправки state НЕ обновляем (E6).
 */
export async function runDailyNudge(env: Env, today: string): Promise<{ sent: boolean; signals: number }> {
    const snap = await gatherCoachSnapshot(env, today);
    let sigs = signalsFor(snap);
    if (!sigs.length) return { sent: false, signals: 0 };

    const stateRows = await env.DB.prepare("SELECT signal_key, last_fired FROM coach_state").all<{ signal_key: string; last_fired: string }>();
    const lastFired = new Map(stateRows.results.map(r => [r.signal_key, r.last_fired]));
    sigs = sigs.filter(s => {
        const lf = lastFired.get(s.key);
        return !lf || daysBetween(lf, today) >= COACH_CONFIG.COOLDOWN_DAYS;
    });
    if (!sigs.length) return { sent: false, signals: 0 };

    const top = sigs.slice(0, COACH_CONFIG.MAX_SIGNALS);
    const msg = `🔔 <b>Финансы — на заметку</b>\n\n${top.map(s => s.text).join("\n")}`;
    const chatIds = await ownerChatIds(env);
    if (!chatIds.length) { console.log("coach: нет авторизованных получателей"); return { sent: false, signals: 0 }; }

    // E6: доставку проверяем ЯВНО (sendMessage→boolean). Если хоть одна не дошла —
    // coach_state НЕ обновляем, чтобы повторить завтра (не глушим сигнал на cooldown без доставки).
    const results = await Promise.all(chatIds.map(id => sendMessage(env, id, msg)));
    if (results.some(ok => !ok)) {
        console.error("coach: доставка не удалась — coach_state не обновлён");
        return { sent: false, signals: 0 };
    }

    await env.DB.batch(top.map(s => env.DB.prepare(
        "INSERT INTO coach_state (signal_key, last_fired) VALUES (?, ?) ON CONFLICT(signal_key) DO UPDATE SET last_fired = excluded.last_fired",
    ).bind(s.key, today)));
    return { sent: true, signals: top.length };
}
