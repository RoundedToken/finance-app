/**
 * D1 access helpers. После pivot к D1-centric архитектуре, D1 — источник правды
 * для всех expenses. Mini App пишет напрямую через CRUD endpoints.
 */
import type { Env, ExpensePayload } from "./types";

export async function isAuthorizedUser(env: Env, telegramId: string): Promise<boolean> {
    const row = await env.DB
        .prepare("SELECT 1 FROM authorized_users WHERE telegram_id = ?")
        .bind(telegramId)
        .first();
    return !!row;
}

// ─── Expenses CRUD ──────────────────────────────────────────────────────────

export async function createExpense(env: Env, userId: string, e: ExpensePayload): Promise<{ inserted: boolean }> {
    const r = await env.DB.prepare(
        `INSERT OR IGNORE INTO expenses
           (id, date, account_id, amount, currency, category_id, note, source, source_record_id, user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
        .bind(
            e.id,
            e.date,
            e.account_id ?? null,
            e.amount,
            e.currency,
            e.category_id ?? null,
            e.note ?? null,
            e.source ?? "mini_app",
            e.source_record_id ?? null,
            userId,
            e.created_at,
        )
        .run();
    return { inserted: (r.meta.changes ?? 0) > 0 };
}

export async function updateExpense(env: Env, id: string, userId: string, patch: any): Promise<{ updated: boolean }> {
    // PATCH-семантика: отсутствие ключа → оставить старое; явный null → стереть.
    // Для note различаем "не передан" и "стереть" через hasOwnProperty.
    const hasNote = Object.prototype.hasOwnProperty.call(patch, "note");
    const sql =
        `UPDATE expenses
         SET date         = COALESCE(?, date),
             amount       = COALESCE(?, amount),
             currency     = COALESCE(?, currency),
             category_id  = COALESCE(?, category_id),
             account_id   = COALESCE(?, account_id),
             note         = ${hasNote ? "?" : "note"},
             updated_at   = datetime('now')
         WHERE id = ? AND user_id = ? AND deleted_at IS NULL`;
    const params: any[] = [
        patch.date ?? null,
        patch.amount ?? null,
        patch.currency ?? null,
        patch.category_id ?? null,
        patch.account_id ?? null,
    ];
    if (hasNote) params.push(patch.note ?? null);
    params.push(id, userId);
    const r = await env.DB.prepare(sql).bind(...params).run();
    return { updated: (r.meta.changes ?? 0) > 0 };
}

export async function deleteExpense(env: Env, id: string, userId: string): Promise<{ deleted: boolean }> {
    const r = await env.DB.prepare(
        `UPDATE expenses
         SET deleted_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    )
        .bind(id, userId)
        .run();
    return { deleted: (r.meta.changes ?? 0) > 0 };
}

export async function listExpenses(env: Env, options: { limit?: number; from?: string }): Promise<any[]> {
    const limit = Math.min(options.limit ?? 10000, 20000);
    let sql = "SELECT id, date, account_id, amount, currency, category_id, note, source, created_at, updated_at " +
              "FROM expenses WHERE deleted_at IS NULL";
    const params: any[] = [];
    if (options.from) {
        sql += " AND date >= ?";
        params.push(options.from);
    }
    sql += " ORDER BY date DESC, created_at DESC LIMIT ?";
    params.push(limit);
    const r = await env.DB.prepare(sql).bind(...params).all();
    return r.results as any[];
}

export async function bulkInsertExpenses(env: Env, expenses: any[]): Promise<number> {
    const stmts = [];
    for (const e of expenses) {
        stmts.push(
            env.DB.prepare(
                `INSERT OR IGNORE INTO expenses
                   (id, date, account_id, amount, currency, category_id, note, source, source_record_id, user_id, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ).bind(
                e.id,
                e.date,
                e.account_id ?? null,
                e.amount,
                e.currency,
                e.category_id ?? null,
                e.note ?? null,
                e.source ?? "migration",
                e.source_record_id ?? null,
                e.user_id ?? "migration",
                e.created_at,
                e.updated_at ?? e.created_at,
            ),
        );
    }
    if (stmts.length === 0) return 0;
    const results = await env.DB.batch(stmts);
    return results.reduce((acc, r) => acc + (r.meta.changes ?? 0), 0);
}

// ─── References ────────────────────────────────────────────────────────────

interface ReferencePayload {
    accounts?: any[];
    categories?: any[];
    currencies?: any[];
}

export async function replaceReferences(env: Env, payload: ReferencePayload): Promise<void> {
    const stmts = [];
    if (payload.currencies) {
        stmts.push(env.DB.prepare("DELETE FROM currencies"));
        for (const c of payload.currencies) {
            stmts.push(
                env.DB.prepare(
                    "INSERT INTO currencies (code, name, emoji, is_crypto, decimals) VALUES (?, ?, ?, ?, ?)",
                ).bind(c.code, c.name, c.emoji ?? null, c.is_crypto ?? 0, c.decimals ?? 2),
            );
        }
    }
    if (payload.accounts) {
        stmts.push(env.DB.prepare("DELETE FROM accounts"));
        for (const a of payload.accounts) {
            stmts.push(
                env.DB.prepare(
                    "INSERT INTO accounts (id, name, type, currency, is_active, color, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
                ).bind(a.id, a.name, a.type, a.currency, a.is_active ?? 1, a.color ?? null),
            );
        }
    }
    if (payload.categories) {
        stmts.push(env.DB.prepare("DELETE FROM categories"));
        for (const c of payload.categories) {
            stmts.push(
                env.DB.prepare(
                    "INSERT INTO categories (id, name, type, parent_id, emoji, color, sort_order, is_active, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
                ).bind(
                    c.id,
                    c.name,
                    c.type,
                    c.parent_id ?? null,
                    c.emoji ?? null,
                    c.color ?? null,
                    c.sort_order ?? 0,
                    c.is_active ?? 1,
                ),
            );
        }
    }
    if (stmts.length > 0) await env.DB.batch(stmts);
}

// ─── Bootstrap (для Mini App при старте) ────────────────────────────────────

export async function getBootstrapData(env: Env) {
    const [accounts, categories, currencies, expenses, ratesMaxDate] = await Promise.all([
        env.DB.prepare("SELECT * FROM accounts WHERE is_active = 1").all(),
        env.DB.prepare("SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order, name").all(),
        env.DB.prepare("SELECT * FROM currencies").all(),
        env.DB.prepare(
            "SELECT id, date, account_id, amount, currency, category_id, note, source, created_at, updated_at " +
            "FROM expenses WHERE deleted_at IS NULL ORDER BY date DESC, created_at DESC LIMIT 20000",
        ).all(),
        env.DB.prepare("SELECT MAX(date) AS d FROM rates").first<{ d: string | null }>(),
    ]);
    const date = ratesMaxDate?.d ?? null;
    let rates: Record<string, number> = {};
    if (date) {
        const r = await env.DB.prepare(
            "SELECT quote, rate FROM rates WHERE date = ? AND base = 'EUR'",
        ).bind(date).all<{ quote: string; rate: number }>();
        for (const row of r.results) rates[row.quote] = row.rate;
    }
    return {
        accounts: accounts.results,
        categories: categories.results,
        currencies: currencies.results,
        expenses: expenses.results,
        rates: { date, base: "EUR", quotes: rates },
    };
}
