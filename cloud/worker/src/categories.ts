/**
 * Управление категориями (SPEC-017). Web Admin only (Bearer JWT).
 *
 * Два набора:
 *  - расходные: таблица `categories` с `type='expense'`;
 *  - доходные:  таблица `income_categories`.
 * «Удаление» — мягкое (`is_active=0`): категория уходит из выбора, но старые
 * записи её сохраняют (история / аналитика целы). Без миграций D1.
 *
 * `list` доходных живёт в incomes.ts (`listIncomeCategories`) — переиспользуем.
 */
import type { Env } from "./types";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export type Result<T extends Record<string, any> = {}> =
    | ({ ok: true } & T)
    | { ok: false; error: string };

export interface CategoryPayload {
    id?: string;
    name?: string;
    emoji?: string | null;
    color?: string | null;
    sort_order?: number | null;
    is_active?: boolean | number;
}

function validateCreate(p: CategoryPayload): Result {
    if (!p.name || !p.name.trim()) return { ok: false, error: "name is required" };
    if (p.color != null && p.color !== "" && !HEX_COLOR.test(p.color)) return { ok: false, error: "color must be #RRGGBB" };
    return { ok: true };
}

function validateUpdate(p: CategoryPayload): Result {
    if (p.name !== undefined && (!p.name || !p.name.trim())) return { ok: false, error: "name must not be empty" };
    if (p.color != null && p.color !== "" && !HEX_COLOR.test(p.color)) return { ok: false, error: "color must be #RRGGBB" };
    return { ok: true };
}

// ── Расходные категории (`categories`, type='expense') ──────────────────────

export async function listExpenseCategories(env: Env, includeInactive = false): Promise<any[]> {
    let sql = "SELECT id, name, type, parent_id, emoji, color, sort_order, is_active FROM categories WHERE type = 'expense'";
    if (!includeInactive) sql += " AND is_active = 1";
    sql += " ORDER BY sort_order, name";
    const r = await env.DB.prepare(sql).all();
    return r.results as any[];
}

export async function createExpenseCategory(env: Env, payload: CategoryPayload): Promise<Result<{ id: string; inserted: boolean }>> {
    const v = validateCreate(payload);
    if (!v.ok) return v;
    const id = payload.id ?? crypto.randomUUID();
    // sort_order не задан → в конец списка (max+10, шаг как в seed-данных).
    const r = await env.DB.prepare(
        `INSERT OR IGNORE INTO categories (id, name, type, parent_id, emoji, color, sort_order, is_active, updated_at)
         VALUES (?, ?, 'expense', NULL, ?, ?,
                 COALESCE(?, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM categories WHERE type = 'expense')), 1, datetime('now'))`,
    ).bind(id, payload.name!.trim(), payload.emoji ?? null, payload.color ?? null, payload.sort_order ?? null).run();
    return { ok: true, id, inserted: (r.meta.changes ?? 0) > 0 };
}

export async function updateExpenseCategory(env: Env, id: string, patch: CategoryPayload): Promise<Result<{ updated: boolean }>> {
    const v = validateUpdate(patch);
    if (!v.ok) return v;
    const hasEmoji = Object.prototype.hasOwnProperty.call(patch, "emoji");
    const hasColor = Object.prototype.hasOwnProperty.call(patch, "color");
    const hasSort = Object.prototype.hasOwnProperty.call(patch, "sort_order");
    const hasActive = Object.prototype.hasOwnProperty.call(patch, "is_active");
    const r = await env.DB.prepare(
        `UPDATE categories SET
            name       = COALESCE(?, name),
            emoji      = ${hasEmoji ? "?" : "emoji"},
            color      = ${hasColor ? "?" : "color"},
            sort_order = ${hasSort ? "?" : "sort_order"},
            is_active  = ${hasActive ? "?" : "is_active"},
            updated_at = datetime('now')
         WHERE id = ? AND type = 'expense'`,
    ).bind(
        patch.name?.trim() ?? null,
        ...(hasEmoji ? [patch.emoji ?? null] : []),
        ...(hasColor ? [patch.color ?? null] : []),
        ...(hasSort ? [patch.sort_order ?? 0] : []),
        ...(hasActive ? [patch.is_active ? 1 : 0] : []),
        id,
    ).run();
    return { ok: true, updated: (r.meta.changes ?? 0) > 0 };
}

// ── Доходные категории (`income_categories`) ────────────────────────────────

export async function createIncomeCategory(env: Env, payload: CategoryPayload): Promise<Result<{ id: string; inserted: boolean }>> {
    const v = validateCreate(payload);
    if (!v.ok) return v;
    const id = payload.id ?? crypto.randomUUID();
    const r = await env.DB.prepare(
        `INSERT OR IGNORE INTO income_categories (id, name, emoji, color, sort_order, is_active, created_at)
         VALUES (?, ?, ?, ?,
                 COALESCE(?, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM income_categories)), 1, datetime('now'))`,
    ).bind(id, payload.name!.trim(), payload.emoji ?? null, payload.color ?? null, payload.sort_order ?? null).run();
    return { ok: true, id, inserted: (r.meta.changes ?? 0) > 0 };
}

export async function updateIncomeCategory(env: Env, id: string, patch: CategoryPayload): Promise<Result<{ updated: boolean }>> {
    const v = validateUpdate(patch);
    if (!v.ok) return v;
    const hasEmoji = Object.prototype.hasOwnProperty.call(patch, "emoji");
    const hasColor = Object.prototype.hasOwnProperty.call(patch, "color");
    const hasSort = Object.prototype.hasOwnProperty.call(patch, "sort_order");
    const hasActive = Object.prototype.hasOwnProperty.call(patch, "is_active");
    const r = await env.DB.prepare(
        `UPDATE income_categories SET
            name       = COALESCE(?, name),
            emoji      = ${hasEmoji ? "?" : "emoji"},
            color      = ${hasColor ? "?" : "color"},
            sort_order = ${hasSort ? "?" : "sort_order"},
            is_active  = ${hasActive ? "?" : "is_active"}
         WHERE id = ?`,
    ).bind(
        patch.name?.trim() ?? null,
        ...(hasEmoji ? [patch.emoji ?? null] : []),
        ...(hasColor ? [patch.color ?? null] : []),
        ...(hasSort ? [patch.sort_order ?? 0] : []),
        ...(hasActive ? [patch.is_active ? 1 : 0] : []),
        id,
    ).run();
    return { ok: true, updated: (r.meta.changes ?? 0) > 0 };
}
