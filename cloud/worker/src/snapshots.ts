/**
 * Snapshots CRUD (Stage 5). Web Admin → Bearer JWT auth.
 *
 * Снапшот = «на дату X в аккаунте Y лежит сумма Z в native currency».
 * Аккаунты — 7 «вёдер» по парам (валюта × форма), см. миграцию 0006.
 */

import type { Env } from "./types";
import { roundMoney } from "./ledger";

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

/**
 * Возвращает последний MANUAL snapshot для каждого аккаунта (form != 'external').
 * После SPEC-011: auto-snapshots не используются для balance, только manual.
 */
export async function latestManualSnapshotPerAccount(env: Env): Promise<Record<string, { date: string; amount: number; id: string }>> {
    const r = await env.DB.prepare(
        `SELECT s.account_id, s.id, s.date, s.amount
         FROM snapshots s
         JOIN (
            SELECT account_id, MAX(date || '|' || created_at) AS mx
            FROM snapshots
            WHERE deleted_at IS NULL AND source = 'manual'
            GROUP BY account_id
         ) m ON m.account_id = s.account_id AND m.mx = s.date || '|' || s.created_at
         WHERE s.deleted_at IS NULL AND s.source = 'manual'`,
    ).all<{ account_id: string; id: string; date: string; amount: number }>();
    const out: Record<string, { date: string; amount: number; id: string }> = {};
    for (const row of r.results) {
        out[row.account_id] = { id: row.id, date: row.date, amount: row.amount };
    }
    return out;
}

/**
 * Backward-compatible alias — legacy callers всё ещё ищут это имя.
 * @deprecated используй `latestManualSnapshotPerAccount`.
 */
export const latestSnapshotPerAccount = latestManualSnapshotPerAccount;

/**
 * Effective balance ведра в native currency, computed on-demand:
 *
 *   effective = manual_baseline + Σ events after baseline.date
 *
 * baseline = последний manual snapshot для bucket'а с date ≤ asOfDate.
 * Если baseline нет — берётся 0 и события суммируются с самого начала.
 *
 * Events: incomes (+amount), expenses (−amount), transactions
 * (−from_amount если bucket=from, +to_amount если bucket=to),
 * goal_contributions (+amount если account_id=bucket).
 *
 * Все суммы в native валюте ведра — никаких конверсий.
 */
export async function getEffectiveBalance(env: Env, accountId: string, asOfDate?: string): Promise<{
    balance: number;
    manual_baseline: { id: string; date: string; amount: number } | null;
    events_count: number;
}> {
    const upTo = asOfDate ?? "9999-12-31";

    const baselineRow = await env.DB.prepare(
        `SELECT id, date, amount, created_at FROM snapshots
         WHERE account_id = ? AND source = 'manual' AND deleted_at IS NULL AND date <= ?
         ORDER BY date DESC, created_at DESC LIMIT 1`,
    ).bind(accountId, upTo).first<{ id: string; date: string; amount: number; created_at: string }>();

    const baseline = baselineRow ?? null;
    const fromDate = baseline ? baseline.date : "0000-01-01";
    // created_at tie-break внутри дня снапшота (SPEC-024). Нет baseline → "" пропускает
    // ничью (все события и так берутся по date > "0000-01-01"). Каноничный формат
    // 'YYYY-MM-DD HH:MM:SS' гарантируется миграцией 0013 + серверным created_at.
    const fromCreatedAt = baseline?.created_at ?? "";
    let balance = baseline?.amount ?? 0;
    let events = 0;

    // Событие учитывается, если date <= asOf И (date > baseline.date ИЛИ
    // (date == baseline.date И created_at > baseline.created_at)). SPEC-024.
    const afterBaseline = "date <= ? AND (date > ? OR (date = ? AND created_at > ?))";

    // Incomes (+amount)
    const inc = await env.DB.prepare(
        `SELECT COALESCE(SUM(amount), 0) AS s, COUNT(*) AS c FROM incomes
         WHERE account_id = ? AND deleted_at IS NULL AND ${afterBaseline}`,
    ).bind(accountId, upTo, fromDate, fromDate, fromCreatedAt).first<{ s: number; c: number }>();
    balance += inc?.s ?? 0;
    events  += inc?.c ?? 0;

    // Expenses (−amount)
    const exp = await env.DB.prepare(
        `SELECT COALESCE(SUM(amount), 0) AS s, COUNT(*) AS c FROM expenses
         WHERE account_id = ? AND deleted_at IS NULL AND ${afterBaseline}`,
    ).bind(accountId, upTo, fromDate, fromDate, fromCreatedAt).first<{ s: number; c: number }>();
    balance -= exp?.s ?? 0;
    events  += exp?.c ?? 0;

    // Transactions out (−from_amount)
    const txOut = await env.DB.prepare(
        `SELECT COALESCE(SUM(from_amount), 0) AS s, COUNT(*) AS c FROM transactions
         WHERE from_account_id = ? AND deleted_at IS NULL AND ${afterBaseline}`,
    ).bind(accountId, upTo, fromDate, fromDate, fromCreatedAt).first<{ s: number; c: number }>();
    balance -= txOut?.s ?? 0;
    events  += txOut?.c ?? 0;

    // Transactions in (+to_amount)
    const txIn = await env.DB.prepare(
        `SELECT COALESCE(SUM(to_amount), 0) AS s, COUNT(*) AS c FROM transactions
         WHERE to_account_id = ? AND deleted_at IS NULL AND ${afterBaseline}`,
    ).bind(accountId, upTo, fromDate, fromDate, fromCreatedAt).first<{ s: number; c: number }>();
    balance += txIn?.s ?? 0;
    events  += txIn?.c ?? 0;

    // Goal contributions (+amount если account_id=bucket)
    const gc = await env.DB.prepare(
        `SELECT COALESCE(SUM(amount), 0) AS s, COUNT(*) AS c FROM goal_contributions
         WHERE account_id = ? AND deleted_at IS NULL AND ${afterBaseline}`,
    ).bind(accountId, upTo, fromDate, fromDate, fromCreatedAt).first<{ s: number; c: number }>();
    balance += gc?.s ?? 0;
    events  += gc?.c ?? 0;

    // Transaction fee (−fee_amount) — комиссия как отток из ведра-плательщика (L2).
    // Платит ведро, чья валюта = fee_currency, приоритет from (см. ledger.feePayerBucket):
    //   • bucket == from И fee_currency == from.currency, ИЛИ
    //   • bucket == to   И fee_currency == to.currency И fee_currency != from.currency.
    const fee = await env.DB.prepare(
        `SELECT COALESCE(SUM(t.fee_amount), 0) AS s
         FROM transactions t
         JOIN accounts fa ON fa.id = t.from_account_id
         JOIN accounts ta ON ta.id = t.to_account_id
         WHERE t.deleted_at IS NULL AND t.fee_amount IS NOT NULL
           AND t.date <= ? AND (t.date > ? OR (t.date = ? AND t.created_at > ?))
           AND ( (t.from_account_id = ? AND t.fee_currency = fa.currency)
              OR (t.to_account_id = ? AND t.fee_currency = ta.currency AND t.fee_currency <> fa.currency) )`,
    ).bind(upTo, fromDate, fromDate, fromCreatedAt, accountId, accountId).first<{ s: number }>();
    balance -= fee?.s ?? 0;

    // manual_baseline — публичный контракт {id,date,amount} (created_at тащим только
    // внутри для tie-break, наружу не отдаём — паритет с latestManualSnapshotPerAccount).
    const publicBaseline = baseline ? { id: baseline.id, date: baseline.date, amount: baseline.amount } : null;
    return { balance: roundMoney(balance), manual_baseline: publicBaseline, events_count: events };
}

/** Effective balance для всех active buckets. asOf по умолчанию — все события
 *  (9999); передавай today, чтобы /accounts зеркалил dashboard KPI «сейчас» и не
 *  учитывал события с будущей датой (AC7). */
export async function effectiveBalancePerAccount(env: Env, asOf?: string): Promise<Record<string, { balance: number; manual_baseline: { id: string; date: string; amount: number } | null; events_count: number }>> {
    const buckets = await listBuckets(env);
    const out: Record<string, { balance: number; manual_baseline: any; events_count: number }> = {};
    // N+1 queries но buckets всего 7 — приемлемо.
    for (const b of buckets) {
        out[b.id] = await getEffectiveBalance(env, b.id, asOf);
    }
    return out;
}

export async function createSnapshot(env: Env, payload: SnapshotPayload): Promise<{ ok: true; id: string; inserted: boolean } | { ok: false; error: string }> {
    // Guard: account существует (как в transactions.ts) — иначе снапшот «висит» в
    // воздухе и getEffectiveBalance для несуществующего ведра даёт неверный baseline.
    const acc = await env.DB.prepare(
        "SELECT 1 FROM accounts WHERE id = ? AND deleted_at IS NULL",
    ).bind(payload.account_id).first();
    if (!acc) return { ok: false, error: "unknown account_id" };

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
    return { ok: true, id, inserted: (r.meta.changes ?? 0) > 0 };
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
        `SELECT id, name, type, currency, form, sort_order, color, is_active, is_investment
         FROM accounts
         WHERE form != 'external' AND deleted_at IS NULL
         ORDER BY sort_order, name`,
    ).all();
    return r.results as any[];
}
