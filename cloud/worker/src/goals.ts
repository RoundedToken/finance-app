/**
 * Goals + Goal Contributions (Stage 7). Web Admin only.
 *
 * Goal balance = SUM(incomes.amount converted to goal.target_currency)
 *              + SUM(goal_contributions.amount converted to goal.target_currency).
 * Конверсия — canonical RatesIndex по курсу НА СЕГОДНЯ (mark-to-market: goal
 * balance это «сколько накоплено стоит сейчас» — запас, → today rate;
 * ADR-014, SPEC-016). EUR base.
 *
 * См. SPEC-007.
 */

import type { Env } from "./types";
import { loadRatesIndex } from "./rates";
import { roundMoney } from "./ledger";

export type GoalStatus = "active" | "achieved" | "archived";

export interface GoalPayload {
    id?: string;
    name: string;
    emoji?: string | null;
    color?: string | null;
    target_amount?: number | null;
    target_currency?: string | null;
    deadline?: string | null;
    note?: string | null;
}

export interface ContributionPayload {
    id?: string;
    goal_id: string;
    date: string;
    amount: number;
    currency_code?: string;       // L4/G11: деривится из ведра (account.currency), клиентское игнорируется
    account_id?: string | null;
    note?: string | null;
}

// Result discriminated union. Generic T расширяет success-вариант (например
// `{ id: string }`). По умолчанию T={} — тогда успех = `{ ok: true }`.
export type Result<T extends Record<string, any> = {}> =
    | ({ ok: true } & T)
    | { ok: false; error: string };

// ── Helpers ─────────────────────────────────────────────────────────────────

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

async function currencyExists(env: Env, code: string): Promise<boolean> {
    const r = await env.DB.prepare("SELECT 1 FROM currencies WHERE code = ?").bind(code).first();
    return r !== null;
}

/** Валюта ведра — взнос всегда в native-валюте ведра (G11), деривится отсюда
 *  (также подтверждает существование account). */
async function accountCurrency(env: Env, id: string): Promise<string | null> {
    const r = await env.DB.prepare("SELECT currency FROM accounts WHERE id = ? AND deleted_at IS NULL").bind(id).first<{ currency: string }>();
    return r?.currency ?? null;
}

async function goalExists(env: Env, id: string): Promise<boolean> {
    const r = await env.DB.prepare("SELECT 1 FROM goals WHERE id = ? AND deleted_at IS NULL").bind(id).first();
    return r !== null;
}

/** Сегодня (UTC, YYYY-MM-DD) — дата конверсии goal balance (mark-to-market). */
function todayUtc(): string {
    return new Date().toISOString().slice(0, 10);
}

// ── Goal validation ─────────────────────────────────────────────────────────

export async function validateGoalPayload(env: Env, payload: GoalPayload): Promise<Result> {
    if (!payload.name || !payload.name.trim()) return { ok: false, error: "name is required" };
    // target_currency обязательно — без него балансы из разных валют
    // некуда сводить (см. SPEC-007 §11 R3).
    if (!payload.target_currency) return { ok: false, error: "target_currency is required" };
    if (!(await currencyExists(env, payload.target_currency))) {
        return { ok: false, error: "unknown target_currency" };
    }
    if (payload.target_amount != null) {
        if (typeof payload.target_amount !== "number" || payload.target_amount <= 0) {
            return { ok: false, error: "target_amount must be positive" };
        }
    }
    if (payload.deadline != null && payload.deadline !== "" && !ISO_DATE.test(payload.deadline)) {
        return { ok: false, error: "deadline must be YYYY-MM-DD" };
    }
    if (payload.color != null && payload.color !== "" && !HEX_COLOR.test(payload.color)) {
        return { ok: false, error: "color must be #RRGGBB" };
    }
    return { ok: true };
}

// ── List + balances ─────────────────────────────────────────────────────────

interface GoalRow {
    id: string;
    name: string;
    emoji: string | null;
    color: string | null;
    target_amount: number | null;
    target_currency: string | null;
    deadline: string | null;
    note: string | null;
    status: GoalStatus;
    sort_order: number;
    created_at: string;
    updated_at: string;
}

export interface GoalWithBalance extends GoalRow {
    balance: number;
    balance_eur?: number | null;          // SPEC-017: mark-to-market today (для dashboard forecast)
    target_amount_eur?: number | null;
    balance_missing_rates: number;
    contribution_count: number;
}

export async function listGoals(env: Env, opts: { status?: GoalStatus | "all" } = {}): Promise<GoalWithBalance[]> {
    const status = opts.status ?? "active";
    let sql = `SELECT id, name, emoji, color, target_amount, target_currency, deadline, note,
                      status, sort_order, created_at, updated_at
               FROM goals WHERE deleted_at IS NULL`;
    const params: any[] = [];
    if (status !== "all") { sql += " AND status = ?"; params.push(status); }
    sql += " ORDER BY sort_order, created_at DESC";

    const r = await env.DB.prepare(sql).bind(...params).all<GoalRow>();
    const goals = r.results;
    if (!goals.length) return [];

    const rates = await loadRatesIndex(env);
    const today = todayUtc();
    const ids = goals.map(g => g.id);
    const placeholders = ids.map(() => "?").join(",");

    // Suma contributions из incomes
    const incomeRows = await env.DB.prepare(
        `SELECT goal_id, amount, currency_code FROM incomes
         WHERE deleted_at IS NULL AND goal_id IN (${placeholders})`,
    ).bind(...ids).all<{ goal_id: string; amount: number; currency_code: string }>();

    // Suma из goal_contributions
    const contribRows = await env.DB.prepare(
        `SELECT goal_id, amount, currency_code FROM goal_contributions
         WHERE deleted_at IS NULL AND goal_id IN (${placeholders})`,
    ).bind(...ids).all<{ goal_id: string; amount: number; currency_code: string }>();

    // Считаем balance + counters
    const balances = new Map<string, { sum: number; missing: number; count: number }>();
    for (const id of ids) balances.set(id, { sum: 0, missing: 0, count: 0 });

    const aggregate = (rows: Array<{ goal_id: string; amount: number; currency_code: string }>) => {
        for (const row of rows) {
            const goal = goals.find(g => g.id === row.goal_id);
            if (!goal) continue;
            const acc = balances.get(row.goal_id)!;
            acc.count += 1;
            // После SPEC-007 invariant fix target_currency required. Для старых
            // записей без него — конверсия в EUR (нейтральный знаменатель), а
            // на фронте такая goal помечается как «требует редактирования».
            const target = goal.target_currency ?? "EUR";
            const conv = rates.convertAt(row.amount, row.currency_code, target, today);
            if (conv == null) acc.missing += 1;
            else acc.sum += conv;
        }
    };
    aggregate(incomeRows.results);
    aggregate(contribRows.results);

    // SPEC-012: transactions больше не входят в goal balance.

    return goals.map(g => {
        const b = balances.get(g.id)!;
        // SPEC-017: EUR-эквивалент баланса/таргета (mark-to-market today, ADR-014) —
        // чтобы dashboard goals-forecast не конвертировал на клиенте.
        const balEur = g.target_currency ? rates.toEurAt(b.sum, g.target_currency, today) : b.sum;
        const tgtEur = g.target_amount != null && g.target_currency ? rates.toEurAt(g.target_amount, g.target_currency, today) : null;
        return {
            ...g, balance: roundMoney(b.sum), balance_missing_rates: b.missing, contribution_count: b.count,
            balance_eur: balEur == null ? null : Math.round(balEur * 100) / 100,
            target_amount_eur: tgtEur == null ? null : Math.round(tgtEur * 100) / 100,
        };
    });
}

export async function getGoalDetail(env: Env, id: string): Promise<{ goal: GoalWithBalance | null; contributions: any[] }> {
    const goalRow = await env.DB.prepare(
        `SELECT id, name, emoji, color, target_amount, target_currency, deadline, note,
                status, sort_order, created_at, updated_at
         FROM goals WHERE id = ? AND deleted_at IS NULL`,
    ).bind(id).first<GoalRow>();
    if (!goalRow) return { goal: null, contributions: [] };

    const rates = await loadRatesIndex(env);
    const today = todayUtc();

    const incomes = await env.DB.prepare(
        `SELECT id, date, amount, currency_code, account_id, note, created_at
         FROM incomes WHERE deleted_at IS NULL AND goal_id = ?
         ORDER BY date DESC, created_at DESC`,
    ).bind(id).all<{ id: string; date: string; amount: number; currency_code: string; account_id: string; note: string | null; created_at: string }>();

    const manual = await env.DB.prepare(
        `SELECT id, date, amount, currency_code, account_id, note, created_at
         FROM goal_contributions WHERE deleted_at IS NULL AND goal_id = ?
         ORDER BY date DESC, created_at DESC`,
    ).bind(id).all<{ id: string; date: string; amount: number; currency_code: string; account_id: string | null; note: string | null; created_at: string }>();

    // SPEC-012: timeline только income + manual.
    let sum = 0, missing = 0;
    const allRows: any[] = [];
    for (const r of incomes.results) {
        const target = goalRow.target_currency ?? r.currency_code;
        const conv = rates.convertAt(r.amount, r.currency_code, target, today);
        if (conv == null) missing += 1; else sum += conv;
        allRows.push({ source: "income", income_id: r.id, ...r, delta_in_target: conv });
    }
    for (const r of manual.results) {
        const target = goalRow.target_currency ?? r.currency_code;
        const conv = rates.convertAt(r.amount, r.currency_code, target, today);
        if (conv == null) missing += 1; else sum += conv;
        allRows.push({ source: "manual", ...r, delta_in_target: conv });
    }
    allRows.sort((a, b) =>
        a.date < b.date ? 1 : a.date > b.date ? -1 :
        a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0,
    );

    return {
        goal: { ...goalRow, balance: roundMoney(sum), balance_missing_rates: missing, contribution_count: incomes.results.length + manual.results.length },
        contributions: allRows,
    };
}

// ── CRUD goals ──────────────────────────────────────────────────────────────

export async function createGoal(env: Env, payload: GoalPayload): Promise<Result<{ id: string; inserted: boolean }>> {
    const v = await validateGoalPayload(env, payload);
    if (!v.ok) return v;

    const id = payload.id ?? crypto.randomUUID();
    const r = await env.DB.prepare(
        `INSERT OR IGNORE INTO goals
           (id, name, emoji, color, target_amount, target_currency, deadline, note, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'), datetime('now'))`,
    ).bind(
        id,
        payload.name.trim(),
        payload.emoji ?? null,
        payload.color ?? null,
        payload.target_amount ?? null,
        payload.target_currency ?? null,
        payload.deadline ?? null,
        payload.note ?? null,
    ).run();
    return { ok: true, id, inserted: (r.meta.changes ?? 0) > 0 };
}

export async function updateGoal(env: Env, id: string, patch: Partial<GoalPayload>): Promise<Result<{ updated: boolean }>> {
    // Если в patch есть target_amount/target_currency/color/deadline — валидируем.
    if (Object.keys(patch).length > 0) {
        const merged: GoalPayload = {
            name: patch.name ?? (await loadGoalRow(env, id))?.name ?? "",
            ...patch,
        };
        const v = await validateGoalPayload(env, merged);
        if (!v.ok) return v;
    }

    const hasEmoji = Object.prototype.hasOwnProperty.call(patch, "emoji");
    const hasColor = Object.prototype.hasOwnProperty.call(patch, "color");
    const hasTargetA = Object.prototype.hasOwnProperty.call(patch, "target_amount");
    const hasTargetC = Object.prototype.hasOwnProperty.call(patch, "target_currency");
    const hasDeadline = Object.prototype.hasOwnProperty.call(patch, "deadline");
    const hasNote = Object.prototype.hasOwnProperty.call(patch, "note");

    const r = await env.DB.prepare(
        `UPDATE goals SET
            name            = COALESCE(?, name),
            emoji           = ${hasEmoji   ? "?" : "emoji"},
            color           = ${hasColor   ? "?" : "color"},
            target_amount   = ${hasTargetA ? "?" : "target_amount"},
            target_currency = ${hasTargetC ? "?" : "target_currency"},
            deadline        = ${hasDeadline? "?" : "deadline"},
            note            = ${hasNote    ? "?" : "note"},
            updated_at      = datetime('now')
         WHERE id = ? AND deleted_at IS NULL`,
    ).bind(
        patch.name?.trim() ?? null,
        ...(hasEmoji    ? [patch.emoji ?? null] : []),
        ...(hasColor    ? [patch.color ?? null] : []),
        ...(hasTargetA  ? [patch.target_amount ?? null] : []),
        ...(hasTargetC  ? [patch.target_currency ?? null] : []),
        ...(hasDeadline ? [patch.deadline ?? null] : []),
        ...(hasNote     ? [patch.note ?? null] : []),
        id,
    ).run();
    return { ok: true, updated: (r.meta.changes ?? 0) > 0 };
}

async function loadGoalRow(env: Env, id: string): Promise<GoalRow | null> {
    const r = await env.DB.prepare(
        "SELECT id, name, emoji, color, target_amount, target_currency, deadline, note, status, sort_order, created_at, updated_at " +
        "FROM goals WHERE id = ? AND deleted_at IS NULL",
    ).bind(id).first<GoalRow>();
    return r ?? null;
}

export async function setGoalStatus(env: Env, id: string, status: GoalStatus): Promise<Result<{ updated: boolean }>> {
    if (!["active", "achieved", "archived"].includes(status)) {
        return { ok: false, error: "invalid status" };
    }
    const r = await env.DB.prepare(
        "UPDATE goals SET status = ?, updated_at = datetime('now') WHERE id = ? AND deleted_at IS NULL",
    ).bind(status, id).run();
    return { ok: true, updated: (r.meta.changes ?? 0) > 0 };
}

/** Soft-delete + detach incomes + soft-delete contributions, всё в одном batch. */
export async function deleteGoal(env: Env, id: string): Promise<{ deleted: boolean; detached_incomes: number; deleted_contributions: number }> {
    const exists = await goalExists(env, id);
    if (!exists) return { deleted: false, detached_incomes: 0, deleted_contributions: 0 };

    const results = await env.DB.batch([
        env.DB.prepare("UPDATE goals SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND deleted_at IS NULL").bind(id),
        env.DB.prepare("UPDATE incomes SET goal_id = NULL, updated_at = datetime('now') WHERE goal_id = ?").bind(id),
        env.DB.prepare("UPDATE goal_contributions SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE goal_id = ? AND deleted_at IS NULL").bind(id),
    ]);
    return {
        deleted: (results[0].meta.changes ?? 0) > 0,
        detached_incomes: results[1].meta.changes ?? 0,
        deleted_contributions: results[2].meta.changes ?? 0,
    };
}

// ── CRUD contributions ──────────────────────────────────────────────────────

export async function createContribution(env: Env, payload: ContributionPayload): Promise<Result<{ id: string; inserted: boolean }>> {
    if (!payload.goal_id || !(await goalExists(env, payload.goal_id))) return { ok: false, error: "unknown goal_id" };
    if (typeof payload.amount !== "number" || payload.amount <= 0) return { ok: false, error: "amount must be positive" };
    // L4/G11: account_id обязателен — взнос лежит в реальном ведре, иначе targeted
    // раздувается без покрытия в net (инвариант free = net − targeted).
    if (!payload.account_id) return { ok: false, error: "account_id обязателен: взнос привязывается к ведру" };
    // currency_code деривится ИЗ ведра (как incomes): взнос прибавляется к балансу
    // ведра в native-валюте (SUM amount), поэтому его валюта = валюта ведра — иначе
    // net (native) и targeted (convertAt) разъезжаются (G11). Клиентский currency_code
    // игнорируется.
    const currencyCode = await accountCurrency(env, payload.account_id);
    if (!currencyCode) return { ok: false, error: "unknown account_id" };
    if (!payload.date || !ISO_DATE.test(payload.date)) return { ok: false, error: "date must be YYYY-MM-DD" };

    const id = payload.id ?? crypto.randomUUID();
    const r = await env.DB.prepare(
        `INSERT OR IGNORE INTO goal_contributions
           (id, goal_id, date, amount, currency_code, account_id, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    ).bind(
        id,
        payload.goal_id,
        payload.date,
        payload.amount,
        currencyCode,
        payload.account_id,
        payload.note ?? null,
    ).run();
    return { ok: true, id, inserted: (r.meta.changes ?? 0) > 0 };
}

export async function updateContribution(env: Env, id: string, patch: Partial<ContributionPayload>): Promise<Result<{ updated: boolean }>> {
    if (patch.amount !== undefined && (typeof patch.amount !== "number" || patch.amount <= 0)) {
        return { ok: false, error: "amount must be positive" };
    }
    // L4/G11: account_id обязателен; currency_code деривится из ведра (нельзя
    // прислать рассинхрон валюты взноса и ведра — иначе net/targeted разъезжаются).
    let newCurrency: string | null = null;
    if (patch.account_id !== undefined) {
        if (patch.account_id === null) return { ok: false, error: "account_id обязателен: взнос привязан к ведру" };
        newCurrency = await accountCurrency(env, patch.account_id);
        if (!newCurrency) return { ok: false, error: "unknown account_id" };
    }
    if (patch.goal_id !== undefined && !(await goalExists(env, patch.goal_id))) {
        return { ok: false, error: "unknown goal_id" };
    }

    const hasAccount = Object.prototype.hasOwnProperty.call(patch, "account_id");
    const hasNote = Object.prototype.hasOwnProperty.call(patch, "note");

    const r = await env.DB.prepare(
        `UPDATE goal_contributions SET
            goal_id       = COALESCE(?, goal_id),
            date          = COALESCE(?, date),
            amount        = COALESCE(?, amount),
            currency_code = COALESCE(?, currency_code),
            account_id    = ${hasAccount ? "?" : "account_id"},
            note          = ${hasNote    ? "?" : "note"},
            updated_at    = datetime('now')
         WHERE id = ? AND deleted_at IS NULL`,
    ).bind(
        patch.goal_id ?? null,
        patch.date ?? null,
        patch.amount ?? null,
        newCurrency,
        ...(hasAccount ? [patch.account_id ?? null] : []),
        ...(hasNote    ? [patch.note       ?? null] : []),
        id,
    ).run();
    return { ok: true, updated: (r.meta.changes ?? 0) > 0 };
}

export async function deleteContribution(env: Env, id: string): Promise<{ deleted: boolean }> {
    const r = await env.DB.prepare(
        "UPDATE goal_contributions SET deleted_at = datetime('now'), updated_at = datetime('now') " +
        "WHERE id = ? AND deleted_at IS NULL",
    ).bind(id).run();
    return { deleted: (r.meta.changes ?? 0) > 0 };
}

// Используется handler'ом при validate'е incomes.goal_id (см. incomes.ts).
export async function validateGoalRef(env: Env, goalId: string | null | undefined): Promise<Result> {
    if (goalId == null) return { ok: true };
    if (!(await goalExists(env, goalId))) return { ok: false, error: "unknown goal_id" };
    return { ok: true };
}
