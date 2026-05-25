/**
 * Transactions (Stage 7.5). Web Admin only.
 *
 * Exchange / transfer между вёдрами + chain (multi-step). Каждая
 * transaction атомарно создаёт 2 auto-snapshots (from-, to+) одной
 * batch'ей. См. SPEC-008.
 */

import type { Env } from "./types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ── Types ───────────────────────────────────────────────────────────────────

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
}

export interface ChainPayload {
    chain_id?: string;
    date: string;
    note?: string | null;
    steps: TransactionPayload[];
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

async function latestSnapshotAmount(env: Env, accountId: string, beforeDate: string): Promise<number> {
    // Берём последний snapshot for the account на дату <= beforeDate (inclusive).
    // Используется для prev_balance при auto-snapshot generation.
    const r = await env.DB.prepare(
        `SELECT amount FROM snapshots
         WHERE account_id = ? AND deleted_at IS NULL AND date <= ?
         ORDER BY date DESC, created_at DESC LIMIT 1`,
    ).bind(accountId, beforeDate).first<{ amount: number }>();
    return r?.amount ?? 0;
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
    // transfer — это движение той же суммы между вёдрами одной валюты.
    // Разные amounts через API нарушают инвариант (drift в snapshot балансах).
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

// ── List / Detail ───────────────────────────────────────────────────────────

export async function listTransactions(
    env: Env,
    opts: {
        limit?: number;
        from?: string;
        to?: string;
        type?: TransactionType;
        accountId?: string;
        chainId?: string;
    },
): Promise<any[]> {
    const limit = Math.min(opts.limit ?? 1000, 20000);
    let sql = `SELECT id, type, date, from_account_id, to_account_id,
                      from_amount, from_currency, to_amount, to_currency,
                      fee_amount, fee_currency, note, chain_id, chain_sequence,
                      goal_id, created_at, updated_at
               FROM transactions WHERE deleted_at IS NULL`;
    const params: any[] = [];
    if (opts.from)      { sql += " AND date >= ?";              params.push(opts.from); }
    if (opts.to)        { sql += " AND date <= ?";              params.push(opts.to); }
    if (opts.type)      { sql += " AND type = ?";               params.push(opts.type); }
    if (opts.chainId)   { sql += " AND chain_id = ?";           params.push(opts.chainId); }
    if (opts.accountId) {
        sql += " AND (from_account_id = ? OR to_account_id = ?)";
        params.push(opts.accountId, opts.accountId);
    }
    sql += " ORDER BY date DESC, created_at DESC, chain_sequence ASC LIMIT ?";
    params.push(limit);
    const r = await env.DB.prepare(sql).bind(...params).all();
    return r.results as any[];
}

export async function getChainDetail(env: Env, chainId: string): Promise<{
    chain_id: string;
    transactions: any[];
    initial: { account_id: string; amount: number; currency: string } | null;
    final: { account_id: string; amount: number; currency: string } | null;
    effective_rate: number | null;
    step_count: number;
} | null> {
    const rows = await env.DB.prepare(
        `SELECT id, type, date, from_account_id, to_account_id,
                from_amount, from_currency, to_amount, to_currency,
                fee_amount, fee_currency, note, chain_id, chain_sequence,
                created_at
         FROM transactions
         WHERE chain_id = ? AND deleted_at IS NULL
         ORDER BY chain_sequence ASC`,
    ).bind(chainId).all<any>();
    if (!rows.results.length) return null;
    const txs = rows.results;
    const first = txs[0];
    const last = txs[txs.length - 1];
    const effective = last.to_amount && first.from_amount
        ? last.to_amount / first.from_amount
        : null;
    return {
        chain_id: chainId,
        transactions: txs,
        initial: { account_id: first.from_account_id, amount: first.from_amount, currency: first.from_currency },
        final:   { account_id: last.to_account_id,    amount: last.to_amount,    currency: last.to_currency },
        effective_rate: effective,
        step_count: txs.length,
    };
}

// ── Single transaction create ──────────────────────────────────────────────

export async function createTransaction(env: Env, payload: TransactionPayload): Promise<Result<{ id: string; inserted: boolean; snapshot_ids: string[] }>> {
    const v = await validateStep(env, payload);
    if (!v.ok) return v;
    const { id, from_snap_id, to_snap_id, stmts } = await prepareTransactionStmts(env, payload, v.from, v.to, null, null);
    const results = await env.DB.batch(stmts);
    return { ok: true, id, inserted: (results[0].meta.changes ?? 0) > 0, snapshot_ids: [from_snap_id, to_snap_id] };
}

/**
 * Подготавливает 3 prepared-statements для одной transaction (tx + 2 snapshots).
 * Возвращает statements + сгенерированные ID — caller'у remains только
 * скормить их в env.DB.batch вместе с другими transactions (для chain).
 *
 * Inserted-флаг определяется ПОСЛЕ batch'а через index в results.
 */
async function prepareTransactionStmts(
    env: Env,
    payload: TransactionPayload,
    from: AccountInfo,
    to: AccountInfo,
    chainId: string | null,
    chainSequence: number | null,
): Promise<{ id: string; from_snap_id: string; to_snap_id: string; stmts: any[] }> {
    const id = payload.id ?? crypto.randomUUID();
    const fromSnapId = crypto.randomUUID();
    const toSnapId   = crypto.randomUUID();

    const prevFrom = await latestSnapshotAmount(env, from.id, payload.date);
    const prevTo   = await latestSnapshotAmount(env, to.id,   payload.date);

    const newFromBalance = prevFrom - payload.from_amount;
    const newToBalance   = prevTo   + payload.to_amount;

    const stmts = [
        env.DB.prepare(
            `INSERT OR IGNORE INTO transactions
               (id, type, date, from_account_id, to_account_id,
                from_amount, from_currency, to_amount, to_currency,
                fee_amount, fee_currency, note, chain_id, chain_sequence,
                created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        ).bind(
            id, payload.type, payload.date,
            payload.from_account_id, payload.to_account_id,
            payload.from_amount, from.currency,
            payload.to_amount, to.currency,
            payload.fee_amount ?? null, payload.fee_currency ?? null,
            payload.note ?? null,
            chainId, chainSequence,
        ),
        // OR IGNORE на snapshots — защита от retry'я при той же UUID
        // (например, повторный POST с тем же payload.id).
        env.DB.prepare(
            `INSERT OR IGNORE INTO snapshots
               (id, date, account_id, amount, note, source, transaction_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'auto_transaction', ?, datetime('now'), datetime('now'))`,
        ).bind(
            fromSnapId, payload.date, from.id, newFromBalance,
            `auto: ${payload.type} −${payload.from_amount} ${from.currency}`,
            id,
        ),
        env.DB.prepare(
            `INSERT OR IGNORE INTO snapshots
               (id, date, account_id, amount, note, source, transaction_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'auto_transaction', ?, datetime('now'), datetime('now'))`,
        ).bind(
            toSnapId, payload.date, to.id, newToBalance,
            `auto: ${payload.type} +${payload.to_amount} ${to.currency}`,
            id,
        ),
    ];
    return { id, from_snap_id: fromSnapId, to_snap_id: toSnapId, stmts };
}

// ── Chain create ────────────────────────────────────────────────────────────

export async function createChain(env: Env, payload: ChainPayload): Promise<Result<{ chain_id: string; transaction_ids: string[]; snapshot_ids: string[] }>> {
    if (!Array.isArray(payload.steps) || payload.steps.length < 2) {
        return { ok: false, error: "chain requires at least 2 steps" };
    }
    if (payload.steps.length > 10) {
        return { ok: false, error: "chain limited to 10 steps" };
    }
    if (!payload.date || !ISO_DATE.test(payload.date)) {
        return { ok: false, error: "date must be YYYY-MM-DD" };
    }

    // Pre-validate всех звеньев и заполняем date если не задана.
    const validated: Array<{ payload: TransactionPayload; from: AccountInfo; to: AccountInfo }> = [];
    for (let i = 0; i < payload.steps.length; i++) {
        const step = { ...payload.steps[i], date: payload.steps[i].date || payload.date };
        const v = await validateStep(env, step);
        if (!v.ok) return { ok: false, error: `step ${i + 1}: ${v.error}` };
        validated.push({ payload: step, from: v.from, to: v.to });
    }

    // Sequence consistency: steps[i].to_account_id === steps[i+1].from_account_id.
    for (let i = 0; i < validated.length - 1; i++) {
        if (validated[i].payload.to_account_id !== validated[i + 1].payload.from_account_id) {
            return { ok: false, error: `chain inconsistency between steps ${i + 1} and ${i + 2}: to/from must match` };
        }
    }

    const chainId = payload.chain_id ?? crypto.randomUUID();
    const transactionIds: string[] = [];
    const snapshotIds: string[] = [];
    const allStmts: any[] = [];

    // Готовим все 3N statements (N звеньев × 3 INSERT) ЗАРАНЕЕ, потом
    // одним env.DB.batch — гарантия атомарности всей цепочки. Если SQL
    // упадёт на M-м звене, D1 rollback'ит предыдущие insert'ы. Это
    // M1 fix из SPEC-008 audit.
    //
    // Однако: latestSnapshotAmount читает прошлые snapshots для
    // prev_balance. Если в цепочке звено N меняет ведро X, то звено N+1
    // которое тоже трогает X должно использовать «новое» значение
    // (после звена N), а не «то что было до chain'а». Поэтому мы строим
    // virtual delta-map во время prepareStmts по ходу loop'а.
    const virtualDeltas = new Map<string, number>();   // account_id → накопленная delta

    for (let i = 0; i < validated.length; i++) {
        const { payload: stepPayload, from, to } = validated[i];
        const withNote = { ...stepPayload, note: stepPayload.note ?? payload.note ?? null };

        // Compose prev_balance с учётом предыдущих звеньев в этой же цепочке.
        const id = withNote.id ?? crypto.randomUUID();
        const fromSnapId = crypto.randomUUID();
        const toSnapId   = crypto.randomUUID();
        const baseFrom = await latestSnapshotAmount(env, from.id, withNote.date);
        const baseTo   = await latestSnapshotAmount(env, to.id,   withNote.date);
        const prevFrom = baseFrom + (virtualDeltas.get(from.id) ?? 0);
        const prevTo   = baseTo   + (virtualDeltas.get(to.id)   ?? 0);
        const newFromBalance = prevFrom - withNote.from_amount;
        const newToBalance   = prevTo   + withNote.to_amount;
        virtualDeltas.set(from.id, (virtualDeltas.get(from.id) ?? 0) - withNote.from_amount);
        virtualDeltas.set(to.id,   (virtualDeltas.get(to.id)   ?? 0) + withNote.to_amount);

        allStmts.push(
            env.DB.prepare(
                `INSERT OR IGNORE INTO transactions
                   (id, type, date, from_account_id, to_account_id,
                    from_amount, from_currency, to_amount, to_currency,
                    fee_amount, fee_currency, note, chain_id, chain_sequence,
                    created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
            ).bind(
                id, withNote.type, withNote.date,
                withNote.from_account_id, withNote.to_account_id,
                withNote.from_amount, from.currency,
                withNote.to_amount, to.currency,
                withNote.fee_amount ?? null, withNote.fee_currency ?? null,
                withNote.note ?? null,
                chainId, i + 1,
            ),
            env.DB.prepare(
                `INSERT OR IGNORE INTO snapshots
                   (id, date, account_id, amount, note, source, transaction_id, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, 'auto_transaction', ?, datetime('now'), datetime('now'))`,
            ).bind(
                fromSnapId, withNote.date, from.id, newFromBalance,
                `auto: chain step ${i + 1} −${withNote.from_amount} ${from.currency}`,
                id,
            ),
            env.DB.prepare(
                `INSERT OR IGNORE INTO snapshots
                   (id, date, account_id, amount, note, source, transaction_id, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, 'auto_transaction', ?, datetime('now'), datetime('now'))`,
            ).bind(
                toSnapId, withNote.date, to.id, newToBalance,
                `auto: chain step ${i + 1} +${withNote.to_amount} ${to.currency}`,
                id,
            ),
        );

        transactionIds.push(id);
        snapshotIds.push(fromSnapId, toSnapId);
    }

    await env.DB.batch(allStmts);
    return { ok: true, chain_id: chainId, transaction_ids: transactionIds, snapshot_ids: snapshotIds };
}

// ── Delete ──────────────────────────────────────────────────────────────────

export async function deleteTransaction(env: Env, id: string): Promise<{ deleted: boolean; deleted_snapshots: number }> {
    const results = await env.DB.batch([
        env.DB.prepare(
            "UPDATE transactions SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND deleted_at IS NULL",
        ).bind(id),
        env.DB.prepare(
            `UPDATE snapshots SET deleted_at = datetime('now'), updated_at = datetime('now')
             WHERE transaction_id = ? AND source = 'auto_transaction' AND deleted_at IS NULL`,
        ).bind(id),
    ]);
    return {
        deleted: (results[0].meta.changes ?? 0) > 0,
        deleted_snapshots: results[1].meta.changes ?? 0,
    };
}

export async function deleteChain(env: Env, chainId: string): Promise<{ deleted_transactions: number; deleted_snapshots: number }> {
    const txs = await env.DB.prepare(
        "SELECT id FROM transactions WHERE chain_id = ? AND deleted_at IS NULL",
    ).bind(chainId).all<{ id: string }>();
    if (!txs.results.length) return { deleted_transactions: 0, deleted_snapshots: 0 };

    const ids = txs.results.map(r => r.id);
    const placeholders = ids.map(() => "?").join(",");
    const results = await env.DB.batch([
        env.DB.prepare(
            `UPDATE transactions SET deleted_at = datetime('now'), updated_at = datetime('now')
             WHERE chain_id = ? AND deleted_at IS NULL`,
        ).bind(chainId),
        env.DB.prepare(
            `UPDATE snapshots SET deleted_at = datetime('now'), updated_at = datetime('now')
             WHERE transaction_id IN (${placeholders}) AND source = 'auto_transaction' AND deleted_at IS NULL`,
        ).bind(...ids),
    ]);
    return {
        deleted_transactions: results[0].meta.changes ?? 0,
        deleted_snapshots: results[1].meta.changes ?? 0,
    };
}
