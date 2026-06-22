/**
 * Zod-схемы payload'ов мутирующих endpoint'ов (SPEC-019, ADR-012).
 *
 * ГРАНИЦА ОТВЕТСТВЕННОСТИ:
 *  - Zod = SHAPE: типы, required-присутствие, enum, положительность сумм, формат даты.
 *  - Домен (db/incomes/transactions/goals/...) = БИЗНЕС: существование FK, кросс-поля,
 *    формат hex-цвета, обязательность target_currency и т.п. (требуют D1).
 * Не дублируем бизнес-правила здесь, чтобы не было двух источников истины.
 *
 * z.object по умолчанию срезает неизвестные ключи (strip) — лишние поля игнорируются.
 */
import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");
const posAmount = z.number().positive("amount must be positive");
const optStr = z.string().nullish();   // string | null | undefined

// ── Expenses (Mini App + бот) ───────────────────────────────────────────────
export const expenseCreateSchema = z.object({
    id: z.string().min(1),
    date: isoDate,
    amount: posAmount,
    currency: z.string().min(1),
    account_id: optStr,
    category_id: optStr,
    note: optStr,
    source: z.string().optional(),
    source_record_id: optStr,
    created_at: z.string().optional(),
    allow_currency_mismatch: z.boolean().optional(),   // SPEC-032: осознанный override валюты ≠ счёта
});
export const expenseUpdateSchema = z.object({
    date: isoDate.optional(),
    amount: posAmount.optional(),
    currency: z.string().min(1).optional(),
    category_id: optStr,
    account_id: optStr,
    note: optStr,
    allow_currency_mismatch: z.boolean().optional(),   // SPEC-032
});

// ── Incomes ─────────────────────────────────────────────────────────────────
export const incomeCreateSchema = z.object({
    id: z.string().optional(),
    date: isoDate,
    account_id: z.string().min(1),
    amount: posAmount,
    category_id: z.string().min(1),
    source: optStr,
    note: optStr,
    goal_id: optStr,
});
export const incomeUpdateSchema = z.object({
    date: isoDate.optional(),
    account_id: z.string().min(1).optional(),
    amount: posAmount.optional(),
    category_id: z.string().min(1).optional(),
    source: optStr,
    note: optStr,
    goal_id: optStr,
});

// ── Snapshots (amount может быть любым — это баланс, не поток) ───────────────
export const snapshotCreateSchema = z.object({
    id: z.string().optional(),
    date: isoDate,
    account_id: z.string().min(1),
    amount: z.number(),
    note: optStr,
    source: z.string().optional(),
});
export const snapshotUpdateSchema = z.object({
    date: isoDate.optional(),
    account_id: z.string().min(1).optional(),
    amount: z.number().optional(),
    note: optStr,
});

// ── Transactions ────────────────────────────────────────────────────────────
export const transactionCreateSchema = z.object({
    id: z.string().optional(),
    type: z.enum(["exchange", "transfer"]),
    date: isoDate,
    from_account_id: z.string().min(1),
    to_account_id: z.string().min(1),
    from_amount: posAmount,
    to_amount: posAmount,
    fee_amount: z.number().nonnegative().nullish(),
    fee_currency: optStr,
    note: optStr,
});
export const transactionUpdateSchema = z.object({
    type: z.enum(["exchange", "transfer"]).optional(),
    date: isoDate.optional(),
    from_account_id: z.string().min(1).optional(),
    to_account_id: z.string().min(1).optional(),
    from_amount: posAmount.optional(),
    to_amount: posAmount.optional(),
    fee_amount: z.number().nonnegative().nullish(),
    fee_currency: optStr,
    note: optStr,
});

// ── Goals (формат hex / обязательность target_currency — в домене) ──────────
export const goalCreateSchema = z.object({
    id: z.string().optional(),
    name: z.string().min(1),
    emoji: optStr,
    color: optStr,
    target_amount: posAmount.nullish(),
    target_currency: optStr,
    deadline: optStr,
    note: optStr,
});
export const goalUpdateSchema = z.object({
    name: z.string().min(1).optional(),
    emoji: optStr,
    color: optStr,
    target_amount: posAmount.nullish(),
    target_currency: optStr,
    deadline: optStr,
    note: optStr,
});
export const goalStatusSchema = z.object({
    status: z.enum(["active", "achieved", "archived"]),
});

// ── Goal contributions (account_id обязателен — L4/G11) ─────────────────────
export const contributionCreateSchema = z.object({
    id: z.string().optional(),
    goal_id: z.string().min(1),
    date: isoDate,
    amount: posAmount,
    currency_code: z.string().optional(),   // сервер деривит из ведра, клиентское игнорируется
    account_id: z.string().min(1),
    note: optStr,
});
export const contributionUpdateSchema = z.object({
    goal_id: z.string().min(1).optional(),
    date: isoDate.optional(),
    amount: posAmount.optional(),
    currency_code: z.string().optional(),
    account_id: z.string().min(1).optional(),
    note: optStr,
});

// ── Budgets (SPEC-020; бизнес-правила scope/FK/uniqueness — в budgets.ts) ───
export const budgetCreateSchema = z.object({
    id: z.string().optional(),
    scope: z.enum(["category", "total"]).optional(),   // default 'category' в домене
    category_id: optStr,                               // обязателен при scope='category' (проверка в домене)
    limit_eur: posAmount,
});
export const budgetUpdateSchema = z.object({
    limit_eur: posAmount,
});

// ── Adaptive budgets (SPEC-023; домен RBAR в rbar.ts) ───────────────────────
const archetypeEnum = z.enum(["fixed", "recurring", "seasonal", "lumpy", "intermittent"]);
export const budgetSettingsSchema = z.object({
    archetype_override: archetypeEnum.nullish(),
    floor_eur: z.number().nonnegative().nullish(),
    adaptive_enabled: z.boolean().optional(),
});
export const budgetDecisionSchema = z.object({
    category_id: z.string().min(1),
    period: z.string().regex(/^\d{4}-\d{2}$/, "period must be YYYY-MM"),
    archetype: z.string().min(1),
    prev_limit_eur: z.number().nonnegative().nullish(),
    reco_limit_eur: z.number().nonnegative(),
    reason_code: z.string().min(1),
    decision: z.enum(["accepted", "dismissed"]),
});

// ── Investments (SPEC-026; бизнес-правила is_investment/APR — в investments.ts) ─
export const investmentSettingsSchema = z.object({
    staked_qty: z.number().min(0).finite().nullish(),        // SPEC-027: сколько в стейкинге (0 = убрать); finite — отсечь Infinity
    staking_apr_pct: z.number().min(0).max(100).nullish(),   // ручной override; sanity APR ≤ 100%
    note: optStr,
});

// ── Categories (expense + income, общий shape) ──────────────────────────────
export const categoryCreateSchema = z.object({
    id: z.string().optional(),
    name: z.string().min(1),
    emoji: optStr,
    color: optStr,
    sort_order: z.number().nullish(),
});
export const categoryUpdateSchema = z.object({
    name: z.string().min(1).optional(),
    emoji: optStr,
    color: optStr,
    sort_order: z.number().nullish(),
    is_active: z.union([z.boolean(), z.number()]).optional(),
});

/** Человекочитаемое сообщение из ZodError для тела 400. */
export function zodMessage(err: z.ZodError): string {
    return err.issues
        .map(i => `${i.path.join(".") || "body"}: ${i.message}`)
        .join("; ");
}
