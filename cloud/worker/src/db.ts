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

export async function updateHeartbeat(
    env: Env,
    deviceId: string,
    payload: {
        last_sync_attempt_at: string;
        last_sync_success_at?: string | null;
        last_pulled?: number;
        last_inserted?: number;
        last_confirmed?: number;
        last_error?: string | null;
        notes?: string | null;
    },
): Promise<void> {
    await env.DB.prepare(
        `INSERT INTO device_heartbeats
            (device_id, last_seen, last_sync_attempt_at, last_sync_success_at,
             last_pulled, last_inserted, last_confirmed, last_error, notes)
         VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(device_id) DO UPDATE SET
            last_seen = datetime('now'),
            last_sync_attempt_at = excluded.last_sync_attempt_at,
            last_sync_success_at = COALESCE(excluded.last_sync_success_at, device_heartbeats.last_sync_success_at),
            last_pulled = excluded.last_pulled,
            last_inserted = excluded.last_inserted,
            last_confirmed = excluded.last_confirmed,
            last_error = excluded.last_error,
            notes = excluded.notes`,
    )
        .bind(
            deviceId,
            payload.last_sync_attempt_at,
            payload.last_sync_success_at ?? null,
            payload.last_pulled ?? 0,
            payload.last_inserted ?? 0,
            payload.last_confirmed ?? 0,
            payload.last_error ?? null,
            payload.notes ?? null,
        )
        .run();
}

export async function getSyncStatus(env: Env) {
    const [heartbeat, outboxStats] = await Promise.all([
        env.DB.prepare(
            `SELECT * FROM device_heartbeats WHERE device_id = 'macbook'`,
        ).first<any>(),
        env.DB.prepare(
            `SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN confirmed_at IS NULL THEN 1 ELSE 0 END) AS pending,
                SUM(CASE WHEN confirmed_at IS NOT NULL THEN 1 ELSE 0 END) AS confirmed
             FROM expenses_outbox`,
        ).first<any>(),
    ]);
    return {
        heartbeat: heartbeat ?? null,
        outbox: outboxStats ?? { total: 0, pending: 0, confirmed: 0 },
    };
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

interface ReferencePayload {
    accounts?: any[];
    categories?: any[];
    currencies?: any[];
}

export async function replaceReferences(env: Env, payload: ReferencePayload): Promise<void> {
    // D1 batch — атомарный replace. На D1 нет multi-statement BEGIN, но batch выполняет
    // массив команд транзакционно.
    const statements: D1PreparedStatement[] = [];

    if (payload.currencies) {
        statements.push(env.DB.prepare("DELETE FROM currencies"));
        for (const c of payload.currencies) {
            statements.push(
                env.DB.prepare(
                    "INSERT INTO currencies (code, name, emoji, is_crypto, decimals) VALUES (?, ?, ?, ?, ?)",
                ).bind(c.code, c.name, c.emoji ?? null, c.is_crypto ?? 0, c.decimals ?? 2),
            );
        }
    }
    if (payload.accounts) {
        statements.push(env.DB.prepare("DELETE FROM accounts"));
        for (const a of payload.accounts) {
            statements.push(
                env.DB.prepare(
                    "INSERT INTO accounts (id, name, type, currency, is_active, color, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
                ).bind(
                    a.id,
                    a.name,
                    a.type,
                    a.currency,
                    a.is_active ?? 1,
                    a.color ?? null,
                ),
            );
        }
    }
    if (payload.categories) {
        statements.push(env.DB.prepare("DELETE FROM categories"));
        for (const c of payload.categories) {
            statements.push(
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
    if (statements.length > 0) {
        await env.DB.batch(statements);
    }
}
