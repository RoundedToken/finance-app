/**
 * Transactions (Stage 7.5). Web Admin only.
 *
 * Exchange / transfer между вёдрами + chain (multi-step). Каждая
 * transaction атомарно создаёт 2 auto-snapshots (from-, to+) одной
 * batch'ей. См. SPEC-008.
 */

import type { Env } from "./types";
import { validateGoalRef } from "./goals";

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
    goal_id?: string | null;          // Stage 7.5.2 (SPEC-009)
}

export interface ChainPayload {
    chain_id?: string;
    date: string;
    note?: string | null;
    goal_id?: string | null;          // Stage 7.5.2 — пробрасывается на все steps
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
    // Stage 7.5.2: goal_id может быть null (по умолчанию). Если задан —
    // должна существовать active цель.
    const goalCheck = await validateGoalRef(env, step.goal_id ?? null);
    if (!goalCheck.ok) return goalCheck;
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
        goalId?: string;
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
    if (opts.goalId)    { sql += " AND goal_id = ?";            params.push(opts.goalId); }
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
                goal_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        ).bind(
            id, payload.type, payload.date,
            payload.from_account_id, payload.to_account_id,
            payload.from_amount, from.currency,
            payload.to_amount, to.currency,
            payload.fee_amount ?? null, payload.fee_currency ?? null,
            payload.note ?? null,
            chainId, chainSequence,
            payload.goal_id ?? null,
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

    // Mixed-goal chains запрещены — goal на chain-уровне пробрасывается
    // на каждое звено. Если кто-то приходит с разнобоем в steps[i].goal_id,
    // отклоняем (SPEC-009 NG3).
    for (const step of payload.steps) {
        if (step.goal_id != null && payload.goal_id != null && step.goal_id !== payload.goal_id) {
            return { ok: false, error: "chain has mixed goal_id — only one goal per chain" };
        }
    }
    if (payload.goal_id != null) {
        const goalCheck = await validateGoalRef(env, payload.goal_id);
        if (!goalCheck.ok) return goalCheck;
    }

    // Pre-validate всех звеньев и заполняем date + propagate goal_id если не задан.
    const validated: Array<{ payload: TransactionPayload; from: AccountInfo; to: AccountInfo }> = [];
    for (let i = 0; i < payload.steps.length; i++) {
        const step = {
            ...payload.steps[i],
            date: payload.steps[i].date || payload.date,
            goal_id: payload.steps[i].goal_id ?? payload.goal_id ?? null,
        };
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
                    goal_id, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
            ).bind(
                id, withNote.type, withNote.date,
                withNote.from_account_id, withNote.to_account_id,
                withNote.from_amount, from.currency,
                withNote.to_amount, to.currency,
                withNote.fee_amount ?? null, withNote.fee_currency ?? null,
                withNote.note ?? null,
                chainId, i + 1,
                withNote.goal_id ?? null,
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

// ── Edit transaction (SPEC-010) ────────────────────────────────────────────

const STRUCTURAL_FIELDS = ["date", "from_account_id", "to_account_id", "from_amount", "to_amount"] as const;

export async function updateTransaction(
    env: Env,
    id: string,
    patch: Partial<TransactionPayload>,
): Promise<Result<{ updated: boolean; new_snapshot_ids?: string[] }>> {
    const existing = await env.DB.prepare(
        `SELECT id, type, date, from_account_id, to_account_id,
                from_amount, from_currency, to_amount, to_currency,
                fee_amount, fee_currency, note, chain_id, chain_sequence, goal_id
         FROM transactions WHERE id = ? AND deleted_at IS NULL`,
    ).bind(id).first<any>();
    if (!existing) return { ok: false, error: "transaction not found" };

    const inChain = existing.chain_id != null;
    const wantsStructural = STRUCTURAL_FIELDS.some(f => Object.prototype.hasOwnProperty.call(patch, f));
    if (inChain && wantsStructural) {
        return { ok: false, error: "edit of chain transaction is limited to note/fee/goal_id — delete chain to restructure" };
    }

    // Validate goal_id if provided (allows clearing via null).
    if (Object.prototype.hasOwnProperty.call(patch, "goal_id") && patch.goal_id != null) {
        const goalCheck = await validateGoalRef(env, patch.goal_id);
        if (!goalCheck.ok) return goalCheck;
    }

    // Build merged values (используем existing где не overridden).
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
        goal_id: Object.prototype.hasOwnProperty.call(patch, "goal_id")           ? (patch.goal_id ?? null)        : existing.goal_id,
    };

    // FK validation если accounts менялись.
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
    const hasGoal   = Object.prototype.hasOwnProperty.call(patch, "goal_id");

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
            goal_id          = ${hasGoal   ? "?" : "goal_id"},
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
        ...(hasGoal   ? [patch.goal_id ?? null] : []),
        id,
    );

    if (!wantsStructural) {
        const r = await updateStmt.run();
        return { ok: true, updated: (r.meta.changes ?? 0) > 0 };
    }

    // Structural change → recompute auto-snapshots:
    //   1. UPDATE tx
    //   2. soft-delete старые auto-snapshots (DELETE через deleted_at)
    //   3. INSERT новые auto-snapshots с пересчитанным prev_balance.
    //
    // Latest snapshot для merged account_ids считается ДО batch'а через
    // прямой read. Это OK потому что atomic batch overwrites именно эти
    // snapshots (link by transaction_id).
    const newFromSnap = crypto.randomUUID();
    const newToSnap   = crypto.randomUUID();
    const prevFrom = await latestSnapshotAmount(env, from.id, merged.date);
    const prevTo   = await latestSnapshotAmount(env, to.id,   merged.date);
    // ВАЖНО: prev_balance может включать старые auto-snapshots от этой
    // же tx (если account_id не менялся). Нужно их вычесть из prev.
    // Это автоматически решается если мы сначала «отменим» старую tx:
    // prev_with_old = latestSnapshotAmount; чтобы получить prev_clean
    // (без эффекта старой tx) — добавим обратно old.from_amount к from_prev
    // (потому что старая tx это снимала) и вычтем old.to_amount из to_prev.
    let cleanPrevFrom = prevFrom;
    let cleanPrevTo   = prevTo;
    if (existing.from_account_id === from.id) cleanPrevFrom = prevFrom + existing.from_amount;
    if (existing.to_account_id   === to.id)   cleanPrevTo   = prevTo   - existing.to_amount;
    // Если accounts менялись — старая tx влияла на ДРУГИЕ buckets.
    // Эти влияния остаются (они «зависшие»). Soft-delete старых snapshots
    // через transaction_id=id (см. ниже) их уберёт, и balance тех вёдер
    // вернётся к исходному.
    const newFromBalance = cleanPrevFrom - merged.from_amount;
    const newToBalance   = cleanPrevTo   + merged.to_amount;

    const stmts = [
        updateStmt,
        env.DB.prepare(
            `UPDATE snapshots SET deleted_at = datetime('now'), updated_at = datetime('now')
             WHERE transaction_id = ? AND source = 'auto_transaction' AND deleted_at IS NULL`,
        ).bind(id),
        env.DB.prepare(
            `INSERT OR IGNORE INTO snapshots
               (id, date, account_id, amount, note, source, transaction_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'auto_transaction', ?, datetime('now'), datetime('now'))`,
        ).bind(
            newFromSnap, merged.date, from.id, newFromBalance,
            `auto: ${merged.type} −${merged.from_amount} ${from.currency} (edited)`,
            id,
        ),
        env.DB.prepare(
            `INSERT OR IGNORE INTO snapshots
               (id, date, account_id, amount, note, source, transaction_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'auto_transaction', ?, datetime('now'), datetime('now'))`,
        ).bind(
            newToSnap, merged.date, to.id, newToBalance,
            `auto: ${merged.type} +${merged.to_amount} ${to.currency} (edited)`,
            id,
        ),
    ];
    const results = await env.DB.batch(stmts);
    return {
        ok: true,
        updated: (results[0].meta.changes ?? 0) > 0,
        new_snapshot_ids: [newFromSnap, newToSnap],
    };
}

// ── Chain-from existing transaction (SPEC-009) ─────────────────────────────

export interface ChainFromPayload {
    next_step: {
        type: TransactionType;
        to_account_id: string;
        to_amount: number;
        fee_amount?: number | null;
        fee_currency?: string | null;
    };
    date?: string;
    note?: string | null;
}

export async function chainFromTransaction(
    env: Env,
    sourceId: string,
    payload: ChainFromPayload,
): Promise<Result<{ chain_id: string; new_tx_id: string; snapshot_ids: string[] }>> {
    // Load source tx
    const source = await env.DB.prepare(
        `SELECT id, type, date, from_account_id, to_account_id,
                from_amount, from_currency, to_amount, to_currency,
                chain_id, chain_sequence, goal_id
         FROM transactions WHERE id = ? AND deleted_at IS NULL`,
    ).bind(sourceId).first<any>();
    if (!source) return { ok: false, error: "source transaction not found" };

    const date = payload.date ?? source.date;
    if (!ISO_DATE.test(date)) return { ok: false, error: "date must be YYYY-MM-DD" };

    // Build new step inheriting from source.to_*
    const step: TransactionPayload = {
        type: payload.next_step.type,
        date,
        from_account_id: source.to_account_id,
        to_account_id: payload.next_step.to_account_id,
        from_amount: source.to_amount,
        to_amount: payload.next_step.to_amount,
        fee_amount: payload.next_step.fee_amount ?? null,
        fee_currency: payload.next_step.fee_currency ?? null,
        note: payload.note ?? null,
        goal_id: source.goal_id,
    };
    const v = await validateStep(env, step);
    if (!v.ok) return v;

    // Determine chain_id / next sequence.
    let chainId = source.chain_id as string | null;
    let nextSeq: number;
    const stmts: any[] = [];

    if (!chainId) {
        chainId = crypto.randomUUID();
        // Update source to join the new chain as sequence 1.
        stmts.push(
            env.DB.prepare(
                `UPDATE transactions SET chain_id = ?, chain_sequence = 1, updated_at = datetime('now')
                 WHERE id = ? AND deleted_at IS NULL`,
            ).bind(chainId, sourceId),
        );
        nextSeq = 2;
    } else {
        const maxSeq = await env.DB.prepare(
            `SELECT MAX(chain_sequence) AS mx FROM transactions WHERE chain_id = ? AND deleted_at IS NULL`,
        ).bind(chainId).first<{ mx: number | null }>();
        nextSeq = (maxSeq?.mx ?? 0) + 1;
        if (nextSeq > 10) return { ok: false, error: "chain limited to 10 steps" };
    }

    // Compose new step stmts (mirror createChain inner loop logic, single step).
    const newId = crypto.randomUUID();
    const fromSnapId = crypto.randomUUID();
    const toSnapId = crypto.randomUUID();
    const prevFrom = await latestSnapshotAmount(env, v.from.id, date);
    const prevTo   = await latestSnapshotAmount(env, v.to.id,   date);
    const newFromBalance = prevFrom - step.from_amount;
    const newToBalance   = prevTo   + step.to_amount;

    stmts.push(
        env.DB.prepare(
            `INSERT OR IGNORE INTO transactions
               (id, type, date, from_account_id, to_account_id,
                from_amount, from_currency, to_amount, to_currency,
                fee_amount, fee_currency, note, chain_id, chain_sequence,
                goal_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        ).bind(
            newId, step.type, date,
            step.from_account_id, step.to_account_id,
            step.from_amount, v.from.currency,
            step.to_amount, v.to.currency,
            step.fee_amount ?? null, step.fee_currency ?? null,
            step.note ?? null,
            chainId, nextSeq,
            step.goal_id ?? null,
        ),
        env.DB.prepare(
            `INSERT OR IGNORE INTO snapshots
               (id, date, account_id, amount, note, source, transaction_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'auto_transaction', ?, datetime('now'), datetime('now'))`,
        ).bind(
            fromSnapId, date, v.from.id, newFromBalance,
            `auto: chain step ${nextSeq} −${step.from_amount} ${v.from.currency}`,
            newId,
        ),
        env.DB.prepare(
            `INSERT OR IGNORE INTO snapshots
               (id, date, account_id, amount, note, source, transaction_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'auto_transaction', ?, datetime('now'), datetime('now'))`,
        ).bind(
            toSnapId, date, v.to.id, newToBalance,
            `auto: chain step ${nextSeq} +${step.to_amount} ${v.to.currency}`,
            newId,
        ),
    );

    await env.DB.batch(stmts);
    return { ok: true, chain_id: chainId, new_tx_id: newId, snapshot_ids: [fromSnapId, toSnapId] };
}

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
