/**
 * Бюджеты / лимиты по категориям (SPEC-020). Web Admin → Bearer JWT (CRUD);
 * Mini App → read-only подсказка через bootstrap.
 *
 * Модель: один recurring месячный лимит в EUR на расходную категорию
 * (scope='category') + опционально один общий потолок на все траты
 * (scope='total'). Истории по месяцам нет; факт трат — derived (не хранится).
 *
 * Факт = Σ toEurAt(amount, currency, date) по тратам ТЕКУЩЕГО календарного
 * месяца (date-aware, ADR-014/SPEC-016 — расход это поток). Тот же canonical
 * слой конвертации, что и donut на дашборде → цифры консистентны. В пределах
 * одного месяца дрейф курса пренебрежимо мал.
 *
 * `computeBudgetProgress` — чистая функция (тестируется без D1). Пороги статуса
 * — единственный источник (budgetStatus): переиспользуются Admin, Mini App и
 * будущим cron-нуджем (roadmap 2.4).
 */
import type { Env } from "./types";
import { loadRatesIndex, type RatesIndex } from "./rates";

const r2 = (x: number) => Math.round(x * 100) / 100;

function todayUtc(): string {
    return new Date().toISOString().slice(0, 10);
}

/** Последний день месяца "YYYY-MM" (UTC). */
function endOfMonth(ym: string): string {
    const [y, m] = ym.split("-").map(Number);
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export type BudgetStatus = "good" | "warn" | "over";

/**
 * Порог статуса (единственный источник правды, G5):
 *   good  — потрачено < 80% лимита
 *   warn  — 80% .. ровно лимит (на грани)
 *   over  — потрачено строго больше лимита
 */
export function budgetStatus(spent: number, limit: number): BudgetStatus {
    if (spent > limit) return "over";
    if (spent >= 0.8 * limit) return "warn";
    return "good";
}

// ── Row / output types ──────────────────────────────────────────────────────

export interface BudgetRow {
    id: string;
    scope: "category" | "total";
    category_id: string | null;
    limit_eur: number;
    name?: string | null;
    emoji?: string | null;
    color?: string | null;
}

export interface ExpenseLite {
    date: string;
    amount: number;
    currency: string;
    category_id: string | null;
}

export interface CategoryProgress {
    budget_id: string;
    category_id: string;
    name: string;
    emoji: string | null;
    color: string | null;
    limit_eur: number;
    spent_eur: number;
    remaining_eur: number;
    pct: number;
    status: BudgetStatus;
    missing_rates: number;
}

export interface TotalProgress {
    budget_id: string;
    limit_eur: number;
    spent_eur: number;
    remaining_eur: number;
    pct: number;
    status: BudgetStatus;
    missing_rates: number;
}

export interface BudgetsResult {
    month: string;
    currency: "EUR";
    total: TotalProgress | null;
    categories: CategoryProgress[];
}

/**
 * Чистый расчёт прогресса бюджетов за календарный месяц `month` ("YYYY-MM").
 * `expenses` — траты (любого окна; функция сама фильтрует по месяцу).
 */
export function computeBudgetProgress(
    budgets: BudgetRow[],
    expenses: ExpenseLite[],
    rates: RatesIndex,
    month: string,
): BudgetsResult {
    const from = month + "-01";
    const to = endOfMonth(month);

    // Σ EUR по категориям за месяц + счётчики трат без курса.
    const catSpent = new Map<string, number>();
    const catMissing = new Map<string, number>();
    let totalSpent = 0;
    let totalMissing = 0;

    for (const e of expenses) {
        if (e.date < from || e.date > to) continue;
        const v = rates.toEurAt(e.amount, e.currency, e.date);
        const cid = e.category_id; // null = uncategorized (учитывается только в total)
        if (v == null) {
            totalMissing++;
            if (cid != null) catMissing.set(cid, (catMissing.get(cid) ?? 0) + 1);
            continue;
        }
        totalSpent += v;
        if (cid != null) catSpent.set(cid, (catSpent.get(cid) ?? 0) + v);
    }

    let total: TotalProgress | null = null;
    const categories: CategoryProgress[] = [];

    for (const b of budgets) {
        if (b.scope === "total") {
            total = {
                budget_id: b.id,
                limit_eur: b.limit_eur,
                spent_eur: r2(totalSpent),
                remaining_eur: r2(b.limit_eur - totalSpent),
                pct: Math.round((totalSpent / b.limit_eur) * 100),
                status: budgetStatus(totalSpent, b.limit_eur),
                missing_rates: totalMissing,
            };
            continue;
        }
        const cid = b.category_id as string;
        const spent = catSpent.get(cid) ?? 0;
        categories.push({
            budget_id: b.id,
            category_id: cid,
            name: b.name ?? "Без категории",
            emoji: b.emoji ?? null,
            color: b.color ?? null,
            limit_eur: b.limit_eur,
            spent_eur: r2(spent),
            remaining_eur: r2(b.limit_eur - spent),
            pct: Math.round((spent / b.limit_eur) * 100),
            status: budgetStatus(spent, b.limit_eur),
            missing_rates: catMissing.get(cid) ?? 0,
        });
    }

    return { month, currency: "EUR", total, categories };
}

// ── D1-обёртка чтения (переиспользуется /v1/web/budgets и bootstrap, AC10) ───

/**
 * Грузит активные бюджеты (категорийные — только для активных расходных
 * категорий, AC7) + траты текущего месяца + индекс курсов, считает прогресс.
 */
export async function getBudgetsWithProgress(env: Env, opts: { month?: string } = {}, ratesArg?: RatesIndex): Promise<BudgetsResult> {
    const month = opts.month ?? todayUtc().slice(0, 7);
    const from = month + "-01";
    const to = endOfMonth(month);

    const [budgetsR, expR, rates] = await Promise.all([
        env.DB.prepare(
            `SELECT b.id, b.scope, b.category_id, b.limit_eur, c.name, c.emoji, c.color
               FROM budgets b
               LEFT JOIN categories c ON c.id = b.category_id AND c.type = 'expense'
              WHERE b.deleted_at IS NULL
                AND (b.scope = 'total' OR (c.id IS NOT NULL AND c.is_active = 1))
              ORDER BY c.sort_order, c.name`,
        ).all<BudgetRow>(),
        env.DB.prepare(
            `SELECT date, amount, currency, category_id FROM expenses
              WHERE deleted_at IS NULL AND date >= ? AND date <= ?`,
        ).bind(from, to).all<ExpenseLite>(),
        ratesArg ? Promise.resolve(ratesArg) : loadRatesIndex(env),   // SPEC-038: bootstrap шарит индекс
    ]);

    return computeBudgetProgress(budgetsR.results, expR.results, rates, month);
}

// ── D1 CRUD (домен; бизнес-правила здесь, shape — в schemas.ts) ──────────────

export type Result<T extends Record<string, any> = {}> =
    | ({ ok: true } & T)
    | { ok: false; error: string };

export interface BudgetPayload {
    id?: string;
    scope?: "category" | "total";
    category_id?: string | null;
    limit_eur: number;
}

async function activeExpenseCategoryExists(env: Env, categoryId: string): Promise<boolean> {
    const r = await env.DB.prepare(
        "SELECT 1 FROM categories WHERE id = ? AND type = 'expense' AND is_active = 1",
    ).bind(categoryId).first();
    return r !== null;
}

export async function createBudget(env: Env, payload: BudgetPayload): Promise<Result<{ id: string; inserted: boolean }>> {
    const scope = payload.scope ?? "category";

    if (scope === "category") {
        const categoryId = payload.category_id;
        if (!categoryId) return { ok: false, error: "category_id is required" };
        if (!(await activeExpenseCategoryExists(env, categoryId))) {
            return { ok: false, error: "unknown or inactive expense category" };
        }
        const dup = await env.DB.prepare(
            "SELECT 1 FROM budgets WHERE category_id = ? AND deleted_at IS NULL",
        ).bind(categoryId).first();
        if (dup) return { ok: false, error: "бюджет для категории уже есть" };
    } else {
        if (payload.category_id) return { ok: false, error: "total budget must not have category_id" };
        const dup = await env.DB.prepare(
            "SELECT 1 FROM budgets WHERE scope = 'total' AND deleted_at IS NULL",
        ).first();
        if (dup) return { ok: false, error: "общий потолок уже задан" };
    }

    const id = payload.id ?? crypto.randomUUID();
    const r = await env.DB.prepare(
        `INSERT OR IGNORE INTO budgets (id, scope, category_id, limit_eur, created_at, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
    ).bind(id, scope, scope === "total" ? null : payload.category_id, payload.limit_eur).run();
    return { ok: true, id, inserted: (r.meta.changes ?? 0) > 0 };
}

export async function updateBudget(env: Env, id: string, patch: { limit_eur: number }): Promise<Result<{ updated: boolean }>> {
    const r = await env.DB.prepare(
        `UPDATE budgets SET limit_eur = ?, updated_at = datetime('now')
         WHERE id = ? AND deleted_at IS NULL`,
    ).bind(patch.limit_eur, id).run();
    return { ok: true, updated: (r.meta.changes ?? 0) > 0 };
}

export async function deleteBudget(env: Env, id: string): Promise<{ deleted: boolean }> {
    const r = await env.DB.prepare(
        "UPDATE budgets SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND deleted_at IS NULL",
    ).bind(id).run();
    return { deleted: (r.meta.changes ?? 0) > 0 };
}
