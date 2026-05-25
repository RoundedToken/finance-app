/**
 * Snapshots CRUD (Stage 5). Web Admin → Bearer JWT auth.
 *
 * Снапшот = «на дату X в аккаунте Y лежит сумма Z в native currency».
 * Аккаунты — 7 «вёдер» по парам (валюта × форма), см. миграцию 0006.
 */

import type { Env } from "./types";

export interface SnapshotPayload {
    id?: string;
    date: string;
    account_id: string;
    amount: number;
    note?: string | null;
    source?: string;
}

export async function listSnapshots(env: Env, opts: { limit?: number; from?: string; accountId?: string }): Promise<any[]> {
    const limit = Math.min(opts.limit ?? 1000, 20000);
    let sql = "SELECT id, date, account_id, amount, note, source, transaction_id, created_at, updated_at " +
              "FROM snapshots WHERE deleted_at IS NULL";
    const params: any[] = [];
    if (opts.from) { sql += " AND date >= ?"; params.push(opts.from); }
    if (opts.accountId) { sql += " AND account_id = ?"; params.push(opts.accountId); }
    sql += " ORDER BY date DESC, created_at DESC LIMIT ?";
    params.push(limit);
    const r = await env.DB.prepare(sql).bind(...params).all();
    return r.results as any[];
}

/** Возвращает: для каждого аккаунта (form != 'external') — последний снапшот. */
export async function latestSnapshotPerAccount(env: Env): Promise<Record<string, { date: string; amount: number; id: string }>> {
    const r = await env.DB.prepare(
        `SELECT s.account_id, s.id, s.date, s.amount
         FROM snapshots s
         JOIN (
            SELECT account_id, MAX(date || '|' || created_at) AS mx
            FROM snapshots
            WHERE deleted_at IS NULL
            GROUP BY account_id
         ) m ON m.account_id = s.account_id AND m.mx = s.date || '|' || s.created_at
         WHERE s.deleted_at IS NULL`,
    ).all<{ account_id: string; id: string; date: string; amount: number }>();
    const out: Record<string, { date: string; amount: number; id: string }> = {};
    for (const row of r.results) {
        out[row.account_id] = { id: row.id, date: row.date, amount: row.amount };
    }
    return out;
}

export async function createSnapshot(env: Env, payload: SnapshotPayload): Promise<{ id: string; inserted: boolean }> {
    const id = payload.id ?? crypto.randomUUID();
    const r = await env.DB.prepare(
        `INSERT OR IGNORE INTO snapshots
           (id, date, account_id, amount, note, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    ).bind(
        id,
        payload.date,
        payload.account_id,
        payload.amount,
        payload.note ?? null,
        payload.source ?? "manual",
    ).run();
    return { id, inserted: (r.meta.changes ?? 0) > 0 };
}

export async function updateSnapshot(env: Env, id: string, patch: Partial<SnapshotPayload>): Promise<{ updated: boolean }> {
    const r = await env.DB.prepare(
        `UPDATE snapshots
           SET date        = COALESCE(?, date),
               account_id  = COALESCE(?, account_id),
               amount      = COALESCE(?, amount),
               note        = ?,
               updated_at  = datetime('now')
         WHERE id = ? AND deleted_at IS NULL`,
    ).bind(
        patch.date ?? null,
        patch.account_id ?? null,
        patch.amount ?? null,
        patch.note ?? null,
        id,
    ).run();
    return { updated: (r.meta.changes ?? 0) > 0 };
}

export async function deleteSnapshot(env: Env, id: string): Promise<{ deleted: boolean }> {
    const r = await env.DB.prepare(
        "UPDATE snapshots SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND deleted_at IS NULL",
    ).bind(id).run();
    return { deleted: (r.meta.changes ?? 0) > 0 };
}

/** Возвращает список «активных» вёдер (form != 'external'). */
export async function listBuckets(env: Env): Promise<any[]> {
    const r = await env.DB.prepare(
        `SELECT id, name, type, currency, form, sort_order, color, is_active
         FROM accounts
         WHERE form != 'external' AND deleted_at IS NULL
         ORDER BY sort_order, name`,
    ).all();
    return r.results as any[];
}
