/**
 * Incomes CRUD (Stage 6). Web Admin → Bearer JWT auth.
 * См. SPEC-006.
 *
 * Доход = «на дату X в ведро Y пришла сумма Z в native currency,
 *          по причине C (категория), от Source».
 *
 * Идемпотентен по `id` (UUID, может прийти от клиента); `INSERT OR IGNORE`.
 */

import type { Env } from "./types";
import { validateGoalRef } from "./goals";
import { loadRatesIndex } from "./rates";

export interface IncomePayload {
    id?: string;
    date: string;
    account_id: string;
    amount: number;
    category_id: string;
    source?: string | null;
    note?: string | null;
    goal_id?: string | null;            // Stage 7: optional FK на цели
}

export interface IncomeCategory {
    id: string;
    name: string;
    emoji: string | null;
    color: string | null;
    sort_order: number;
}

export async function listIncomes(
    env: Env,
    opts: { limit?: number; from?: string; to?: string; accountId?: string; categoryId?: string; goalId?: string },
): Promise<any[]> {
    const limit = Math.min(opts.limit ?? 1000, 20000);
    let sql =
        "SELECT id, date, account_id, amount, currency_code, category_id, source, note, goal_id, created_at, updated_at " +
        "FROM incomes WHERE deleted_at IS NULL";
    const params: any[] = [];
    if (opts.from) { sql += " AND date >= ?"; params.push(opts.from); }
    if (opts.to)   { sql += " AND date <= ?"; params.push(opts.to); }
    if (opts.accountId)  { sql += " AND account_id = ?";  params.push(opts.accountId); }
    if (opts.categoryId) { sql += " AND category_id = ?"; params.push(opts.categoryId); }
    if (opts.goalId)     { sql += " AND goal_id = ?";     params.push(opts.goalId); }
    sql += " ORDER BY date DESC, created_at DESC LIMIT ?";
    params.push(limit);
    const r = await env.DB.prepare(sql).bind(...params).all();
    const rows = r.results as any[];

    // EUR-эквивалент date-aware (по курсу на дату дохода, НЕ latest) — чтобы
    // «1300 €-экв в RSD» показывался ровно как 1300 €, а не плавал по курсу.
    const rates = await loadRatesIndex(env);
    for (const row of rows) {
        const eur = rates.toEurAt(row.amount, row.currency_code, row.date);
        row.amount_eur = eur == null ? null : Math.round(eur * 100) / 100;
    }
    return rows;
}

export async function listIncomeCategories(env: Env): Promise<IncomeCategory[]> {
    const r = await env.DB.prepare(
        "SELECT id, name, emoji, color, sort_order " +
        "FROM income_categories WHERE is_active = 1 ORDER BY sort_order, name",
    ).all<IncomeCategory>();
    return r.results;
}

/** Кэш можно добавить позже; пока — 1 query за валютой ведра. */
async function lookupAccountCurrency(env: Env, accountId: string): Promise<string | null> {
    const r = await env.DB.prepare(
        "SELECT currency FROM accounts WHERE id = ? AND deleted_at IS NULL",
    ).bind(accountId).first<{ currency: string }>();
    return r?.currency ?? null;
}

async function categoryExists(env: Env, categoryId: string): Promise<boolean> {
    const r = await env.DB.prepare(
        "SELECT 1 FROM income_categories WHERE id = ? AND is_active = 1",
    ).bind(categoryId).first();
    return r !== null;
}

export type CreateResult =
    | { ok: true; id: string; inserted: boolean }
    | { ok: false; error: string };

export async function createIncome(env: Env, payload: IncomePayload): Promise<CreateResult> {
    const currency = await lookupAccountCurrency(env, payload.account_id);
    if (!currency) return { ok: false, error: "unknown account_id" };
    if (!(await categoryExists(env, payload.category_id))) return { ok: false, error: "unknown category_id" };
    const goalCheck = await validateGoalRef(env, payload.goal_id);
    if (!goalCheck.ok) return goalCheck;

    const id = payload.id ?? crypto.randomUUID();
    const r = await env.DB.prepare(
        `INSERT OR IGNORE INTO incomes
           (id, date, account_id, amount, currency_code, category_id, source, note, goal_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    ).bind(
        id,
        payload.date,
        payload.account_id,
        payload.amount,
        currency,
        payload.category_id,
        payload.source ?? null,
        payload.note ?? null,
        payload.goal_id ?? null,
    ).run();
    return { ok: true, id, inserted: (r.meta.changes ?? 0) > 0 };
}

export type UpdateResult =
    | { ok: true; updated: boolean }
    | { ok: false; error: string };

export async function updateIncome(env: Env, id: string, patch: Partial<IncomePayload>): Promise<UpdateResult> {
    // Валидируем FK заранее, если в patch'е есть соответствующие поля.
    let newCurrency: string | null = null;
    if (patch.account_id !== undefined) {
        newCurrency = await lookupAccountCurrency(env, patch.account_id);
        if (!newCurrency) return { ok: false, error: "unknown account_id" };
    }
    if (patch.category_id !== undefined) {
        if (!(await categoryExists(env, patch.category_id))) return { ok: false, error: "unknown category_id" };
    }
    if (patch.goal_id !== undefined && patch.goal_id !== null) {
        const goalCheck = await validateGoalRef(env, patch.goal_id);
        if (!goalCheck.ok) return goalCheck;
    }

    const hasSource = Object.prototype.hasOwnProperty.call(patch, "source");
    const hasNote   = Object.prototype.hasOwnProperty.call(patch, "note");
    const hasGoal   = Object.prototype.hasOwnProperty.call(patch, "goal_id");

    // currency_code привязан к account_id: при смене аккаунта обновляется,
    // иначе сохраняется. Используем COALESCE с newCurrency.
    const r = await env.DB.prepare(
        `UPDATE incomes
           SET date          = COALESCE(?, date),
               account_id    = COALESCE(?, account_id),
               currency_code = COALESCE(?, currency_code),
               amount        = COALESCE(?, amount),
               category_id   = COALESCE(?, category_id),
               source        = ${hasSource ? "?" : "source"},
               note          = ${hasNote   ? "?" : "note"},
               goal_id       = ${hasGoal   ? "?" : "goal_id"},
               updated_at    = datetime('now')
         WHERE id = ? AND deleted_at IS NULL`,
    ).bind(
        patch.date ?? null,
        patch.account_id ?? null,
        newCurrency,
        patch.amount ?? null,
        patch.category_id ?? null,
        ...(hasSource ? [patch.source ?? null] : []),
        ...(hasNote   ? [patch.note   ?? null] : []),
        ...(hasGoal   ? [patch.goal_id ?? null] : []),
        id,
    ).run();
    return { ok: true, updated: (r.meta.changes ?? 0) > 0 };
}

export async function deleteIncome(env: Env, id: string): Promise<{ deleted: boolean }> {
    const r = await env.DB.prepare(
        "UPDATE incomes SET deleted_at = datetime('now'), updated_at = datetime('now') " +
        "WHERE id = ? AND deleted_at IS NULL",
    ).bind(id).run();
    return { deleted: (r.meta.changes ?? 0) > 0 };
}
