/**
 * D1 access helpers.
 */
import type { Env, ExpensePayload, ExpenseRow } from "./types";

export async function isAuthorizedUser(
    env: Env,
    telegramId: string,
): Promise<boolean> {
    const row = await env.DB.prepare(
        "SELECT 1 FROM authorized_users WHERE telegram_id = ?",
    )
        .bind(telegramId)
        .first();
    return !!row;
}

export async function insertExpense(
    env: Env,
    userId: string,
    e: ExpensePayload,
): Promise<{ inserted: boolean }> {
    // INSERT OR IGNORE by PK gives idempotency
    const result = await env.DB.prepare(
        `INSERT OR IGNORE INTO expenses_outbox
           (id, user_id, date, account_id, amount, currency, category_id, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
        .bind(
            e.id,
            userId,
            e.date,
            e.account_id ?? null,
            e.amount,
            e.currency,
            e.category_id ?? null,
            e.note ?? null,
            e.created_at,
        )
        .run();
    return { inserted: (result.meta.changes ?? 0) > 0 };
}

export async function fetchExpensesSince(
    env: Env,
    since: string,
    limit: number = 500,
): Promise<ExpenseRow[]> {
    const { results } = await env.DB.prepare(
        `SELECT id, user_id, date, account_id, amount, currency, category_id, note, created_at, confirmed_at
         FROM expenses_outbox
         WHERE created_at > ?
         ORDER BY created_at ASC
         LIMIT ?`,
    )
        .bind(since, limit)
        .all<ExpenseRow>();
    return results;
}

export async function confirmExpenses(env: Env, ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => "?").join(",");
    const result = await env.DB.prepare(
        `UPDATE expenses_outbox
         SET confirmed_at = datetime('now')
         WHERE id IN (${placeholders})
           AND confirmed_at IS NULL`,
    )
        .bind(...ids)
        .run();
    return result.meta.changes ?? 0;
}

export async function cleanupConfirmed(env: Env, daysOld: number = 7): Promise<number> {
    const result = await env.DB.prepare(
        `DELETE FROM expenses_outbox
         WHERE confirmed_at IS NOT NULL
           AND confirmed_at < datetime('now', ? )`,
    )
        .bind(`-${daysOld} days`)
        .run();
    return result.meta.changes ?? 0;
}

export async function getBootstrapData(env: Env) {
    const [accounts, categories, currencies] = await Promise.all([
        env.DB.prepare("SELECT * FROM accounts WHERE is_active = 1").all(),
        env.DB.prepare("SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order, name").all(),
        env.DB.prepare("SELECT * FROM currencies").all(),
    ]);
    return {
        accounts: accounts.results,
        categories: categories.results,
        currencies: currencies.results,
    };
}
