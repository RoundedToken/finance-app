/**
 * Transactions (exchange + transfer). Single-step операции — без chains,
 * без goal-tagging. См. SPEC-012 (откат SPEC-008 chains + SPEC-009
 * goal-tagged tx).
 *
 * Колонки chain_id / chain_sequence / goal_id в схеме сохраняются как
 * «спящие» — на случай возврата фичи. Новые INSERT всегда пишут NULL.
 *
 * Balance ведра computed-on-read через snapshots.ts:getEffectiveBalance
 * (SPEC-011). Auto-snapshots не создаются.
 */

import type { Env } from "./types";
import { getEffectiveBalance } from "./snapshots";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type TransactionType = "exchange" | "transfer";

export interface TransactionPayload {
    id?: string;
    type: TransactionType;
    date: string;
    from_account_id: string;
    to_account_id: string;
    from_amount: number;
    to_amount: number;
    fee_amount?: number | null;
    fee_currency?: string | null;
    note?: string | null;
    /** @deprecated SPEC-012: принимается silently, в БД не пишется. */
    goal_id?: string | null;
}

export type Result<T extends Record<string, any> = {}> =
    | ({ ok: true } & T)
    | { ok: false; error: string };

// ── Helpers ─────────────────────────────────────────────────────────────────

interface AccountInfo { id: string; currency: string }

async function loadAccount(env: Env, id: string): Promise<AccountInfo | null> {
    const r = await env.DB.prepare(
        "SELECT id, currency FROM accounts WHERE id = ? AND is_active = 1 AND deleted_at IS NULL",
    ).bind(id).first<AccountInfo>();
    return r ?? null;
}

async function checkOverdraft(
    env: Env,
    bucketId: string,
    deductAmount: number,
    asOfDate: string,
    excludeTxId?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
    const eff = await getEffectiveBalance(env, bucketId, asOfDate);
    let available = eff.balance;
    if (excludeTxId) {
        const old = await env.DB.prepare(
            `SELECT from_account_id, to_account_id, from_amount, to_amount
             FROM transactions WHERE id = ? AND deleted_at IS NULL`,
        ).bind(excludeTxId).first<{ from_account_id: string; to_account_id: string; from_amount: number; to_amount: number }>();
        if (old) {
            if (old.from_account_id === bucketId) available += old.from_amount;
            if (old.to_account_id === bucketId)   available -= old.to_amount;
        }
    }
    if (available - deductAmount < 0) {
        return { ok: false, error: `недостаточно средств в ведре (доступно: ${available.toFixed(2)}, нужно: ${deductAmount.toFixed(2)})` };
    }
    return { ok: true };
}

// ── Validation ──────────────────────────────────────────────────────────────

async function validateStep(env: Env, step: TransactionPayload): Promise<Result<{ from: AccountInfo; to: AccountInfo }>> {
    if (!step.date || !ISO_DATE.test(step.date)) return { ok: false, error: "date must be YYYY-MM-DD" };
    if (!step.type || (step.type !== "exchange" && step.type !== "transfer")) {
        return { ok: false, error: "type must be 'exchange' or 'transfer'" };
    }
    if (!step.from_account_id || !step.to_account_id) {
        return { ok: false, error: "from_account_id and to_account_id are required" };
    }
    if (step.from_account_id === step.to_account_id) {
        return { ok: false, error: "from_account_id and to_account_id must differ" };
    }
    if (typeof step.from_amount !== "number" || step.from_amount <= 0) {
        return { ok: false, error: "from_amount must be positive" };
    }
    if (typeof step.to_amount !== "number" || step.to_amount <= 0) {
        return { ok: false, error: "to_amount must be positive" };
    }
    const from = await loadAccount(env, step.from_account_id);
    if (!from) return { ok: false, error: "unknown from_account_id" };
    const to = await loadAccount(env, step.to_account_id);
    if (!to) return { ok: false, error: "unknown to_account_id" };
    if (step.type === "exchange" && from.currency === to.currency) {
        return { ok: false, error: "exchange requires from.currency !== to.currency" };
    }
    if (step.type === "transfer" && from.currency !== to.currency) {
        return { ok: false, error: "transfer requires from.currency === to.currency" };
    }
    if (step.type === "transfer" && step.from_amount !== step.to_amount) {
        return { ok: false, error: "transfer requires from_amount === to_amount" };
    }
    if (step.fee_amount != null) {
        if (typeof step.fee_amount !== "number" || step.fee_amount < 0) {
            return { ok: false, error: "fee_amount must be non-negative" };
        }
        if (!step.fee_currency) {
            return { ok: false, error: "fee_currency required when fee_amount is set" };
        }
    }
    return { ok: true, from, to };
}

// ── List ────────────────────────────────────────────────────────────────────

export async function listTransactions(
    env: Env,
    opts: {
        limit?: number;
        from?: string;
        to?: string;
        type?: TransactionType;
        accountId?: string;
    },
): Promise<any[]> {
    const limit = Math.min(opts.limit ?? 1000, 20000);
    let sql = `SELECT id, type, date, from_account_id, to_account_id,
                      from_amount, from_currency, to_amount, to_currency,
                      fee_amount, fee_currency, note,
                      created_at, updated_at
               FROM transactions WHERE deleted_at IS NULL`;
    const params: any[] = [];
    if (opts.from)      { sql += " AND date >= ?";              params.push(opts.from); }
    if (opts.to)        { sql += " AND date <= ?";              params.push(opts.to); }
    if (opts.type)      { sql += " AND type = ?";               params.push(opts.type); }
    if (opts.accountId) {
        sql += " AND (from_account_id = ? OR to_account_id = ?)";
        params.push(opts.accountId, opts.accountId);
    }
    sql += " ORDER BY date DESC, created_at DESC LIMIT ?";
    params.push(limit);
    const r = await env.DB.prepare(sql).bind(...params).all();
    return r.results as any[];
}

// ── Insert helper ───────────────────────────────────────────────────────────

function buildTransactionInsert(
    env: Env,
    payload: TransactionPayload,
    from: AccountInfo,
    to: AccountInfo,
): { id: string; stmt: any } {
    const id = payload.id ?? crypto.randomUUID();
    // SPEC-012: chain_id, chain_sequence, goal_id всегда NULL для новых записей.
    const stmt = env.DB.prepare(
        `INSERT OR IGNORE INTO transactions
           (id, type, date, from_account_id, to_account_id,
            from_amount, from_currency, to_amount, to_currency,
            fee_amount, fee_currency, note, chain_id, chain_sequence,
            goal_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, datetime('now'), datetime('now'))`,
    ).bind(
        id, payload.type, payload.date,
        payload.from_account_id, payload.to_account_id,
        payload.from_amount, from.currency,
        payload.to_amount, to.currency,
        payload.fee_amount ?? null, payload.fee_currency ?? null,
        payload.note ?? null,
    );
    return { id, stmt };
}

// ── Create ──────────────────────────────────────────────────────────────────

export async function createTransaction(env: Env, payload: TransactionPayload): Promise<Result<{ id: string; inserted: boolean }>> {
    const v = await validateStep(env, payload);
    if (!v.ok) return v;
    const od = await checkOverdraft(env, payload.from_account_id, payload.from_amount, payload.date);
    if (!od.ok) return od;
    const { id, stmt } = buildTransactionInsert(env, payload, v.from, v.to);
    const r = await stmt.run();
    return { ok: true, id, inserted: (r.meta.changes ?? 0) > 0 };
}

// ── Update ──────────────────────────────────────────────────────────────────

const STRUCTURAL_FIELDS = ["date", "from_account_id", "to_account_id", "from_amount", "to_amount"] as const;

export async function updateTransaction(
    env: Env,
    id: string,
    patch: Partial<TransactionPayload>,
): Promise<Result<{ updated: boolean }>> {
    const existing = await env.DB.prepare(
        `SELECT id, type, date, from_account_id, to_account_id,
                from_amount, from_currency, to_amount, to_currency,
                fee_amount, fee_currency, note
         FROM transactions WHERE id = ? AND deleted_at IS NULL`,
    ).bind(id).first<any>();
    if (!existing) return { ok: false, error: "transaction not found" };

    const wantsStructural = STRUCTURAL_FIELDS.some(f => Object.prototype.hasOwnProperty.call(patch, f));

    const merged: TransactionPayload = {
        type: existing.type,
        date: (patch.date ?? existing.date) as string,
        from_account_id: (patch.from_account_id ?? existing.from_account_id) as string,
        to_account_id:   (patch.to_account_id   ?? existing.to_account_id)   as string,
        from_amount: (patch.from_amount ?? existing.from_amount) as number,
        to_amount:   (patch.to_amount   ?? existing.to_amount)   as number,
        fee_amount: Object.prototype.hasOwnProperty.call(patch, "fee_amount")     ? (patch.fee_amount ?? null)     : existing.fee_amount,
        fee_currency: Object.prototype.hasOwnProperty.call(patch, "fee_currency") ? (patch.fee_currency ?? null)   : existing.fee_currency,
        note: Object.prototype.hasOwnProperty.call(patch, "note")                 ? (patch.note ?? null)           : existing.note,
    };

    let from: AccountInfo, to: AccountInfo;
    if (wantsStructural) {
        const v = await validateStep(env, merged);
        if (!v.ok) return v;
        from = v.from; to = v.to;
    } else {
        from = { id: existing.from_account_id, currency: existing.from_currency };
        to   = { id: existing.to_account_id,   currency: existing.to_currency };
    }

    const hasFeeAmt = Object.prototype.hasOwnProperty.call(patch, "fee_amount");
    const hasFeeCcy = Object.prototype.hasOwnProperty.call(patch, "fee_currency");
    const hasNote   = Object.prototype.hasOwnProperty.call(patch, "note");

    const updateStmt = env.DB.prepare(
        `UPDATE transactions SET
            date             = COALESCE(?, date),
            from_account_id  = COALESCE(?, from_account_id),
            to_account_id    = COALESCE(?, to_account_id),
            from_amount      = COALESCE(?, from_amount),
            from_currency    = COALESCE(?, from_currency),
            to_amount        = COALESCE(?, to_amount),
            to_currency      = COALESCE(?, to_currency),
            fee_amount       = ${hasFeeAmt ? "?" : "fee_amount"},
            fee_currency     = ${hasFeeCcy ? "?" : "fee_currency"},
            note             = ${hasNote   ? "?" : "note"},
            updated_at       = datetime('now')
         WHERE id = ? AND deleted_at IS NULL`,
    ).bind(
        patch.date ?? null,
        patch.from_account_id ?? null,
        patch.to_account_id ?? null,
        patch.from_amount ?? null,
        wantsStructural ? from.currency : null,
        patch.to_amount ?? null,
        wantsStructural ? to.currency : null,
        ...(hasFeeAmt ? [patch.fee_amount ?? null] : []),
        ...(hasFeeCcy ? [patch.fee_currency ?? null] : []),
        ...(hasNote   ? [patch.note ?? null] : []),
        id,
    );

    if (wantsStructural) {
        const od = await checkOverdraft(env, merged.from_account_id, merged.from_amount, merged.date, id);
        if (!od.ok) return od;
    }
    const r = await updateStmt.run();
    return { ok: true, updated: (r.meta.changes ?? 0) > 0 };
}

// ── Delete ──────────────────────────────────────────────────────────────────

export async function deleteTransaction(env: Env, id: string): Promise<{ deleted: boolean }> {
    const r = await env.DB.prepare(
        "UPDATE transactions SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND deleted_at IS NULL",
    ).bind(id).run();
    return { deleted: (r.meta.changes ?? 0) > 0 };
}
