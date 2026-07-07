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

// WRK-17 (SPEC-043): regex пропускает несуществующие даты («2026-13-99»), которые дальше
// живут в строковых сравнениях и ломают окна KPI/бюджетов. Проверяем реальность календарного дня.
export function isRealIsoDate(d: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
    const [y, m, dd] = d.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, dd));
    return t.getUTCMonth() === m - 1 && t.getUTCDate() === dd;
}
const isoDate = z.string().refine(isRealIsoDate, "date must be a real YYYY-MM-DD");
// WRK-03 (SPEC-043): JSON.parse("1e309") = Infinity, а z.number().positive() его пропускает —
// одна такая строка отравляет SUM/балансы/KPI каскадом. finite + широкий sanity-cap.
const MONEY_CAP = 1e12;
const posAmount = z.number().positive("amount must be positive").finite().max(MONEY_CAP, "amount too large");
const moneyValue = z.number().finite().min(-MONEY_CAP, "amount too small").max(MONEY_CAP, "amount too large");  // снапшот: баланс, знак любой
const nonNegAmount = z.number().nonnegative().finite().max(MONEY_CAP, "amount too large");
// SEC-13 (SPEC-047): caps на длину строк — анти-раздувание записей/CPU. Это SHAPE
// (форма), не бизнес-валидация: реальные значения на порядки короче (UUID 36,
// код валюты 3-5, имя ≤ пары десятков символов). Bump тривиален при нужде.
const STR_CAP = 1000;                                       // note/source и прочие свободные тексты
const idStr = z.string().min(1).max(128, "id too long");    // UUID/slug-идентификаторы
const nameStr = z.string().min(1).max(200, "name too long");
const ccyStr = z.string().min(1).max(16, "currency too long");
const optStr = z.string().max(STR_CAP, "string too long").nullish();   // string | null | undefined

// ── Expenses (Mini App + бот) ───────────────────────────────────────────────
export const expenseCreateSchema = z.object({
    id: idStr,
    date: isoDate,
    amount: posAmount,
    currency: ccyStr,
    account_id: optStr,
    category_id: optStr,
    note: optStr,
    source: z.string().max(64).optional(),
    source_record_id: optStr,
    created_at: z.string().optional(),
    allow_currency_mismatch: z.boolean().optional(),   // SPEC-032: осознанный override валюты ≠ счёта
});
export const expenseUpdateSchema = z.object({
    date: isoDate.optional(),
    amount: posAmount.optional(),
    currency: ccyStr.optional(),
    category_id: optStr,
    account_id: optStr,
    note: optStr,
    allow_currency_mismatch: z.boolean().optional(),   // SPEC-032
});

// ── Incomes ─────────────────────────────────────────────────────────────────
export const incomeCreateSchema = z.object({
    id: idStr.optional(),
    date: isoDate,
    account_id: idStr,
    amount: posAmount,
    category_id: idStr,
    source: optStr,
    note: optStr,
    goal_id: optStr,
});
export const incomeUpdateSchema = z.object({
    date: isoDate.optional(),
    account_id: idStr.optional(),
    amount: posAmount.optional(),
    category_id: idStr.optional(),
    source: optStr,
    note: optStr,
    goal_id: optStr,
});

// ── Snapshots (amount может быть любым — это баланс, не поток) ───────────────
export const snapshotCreateSchema = z.object({
    id: idStr.optional(),
    date: isoDate,
    account_id: idStr,
    amount: moneyValue,
    note: optStr,
    source: z.string().max(64).optional(),
});
export const snapshotUpdateSchema = z.object({
    date: isoDate.optional(),
    account_id: idStr.optional(),
    amount: moneyValue.optional(),
    note: optStr,
});

// ── Transactions ────────────────────────────────────────────────────────────
export const transactionCreateSchema = z.object({
    id: idStr.optional(),
    type: z.enum(["exchange", "transfer"]),
    date: isoDate,
    from_account_id: idStr,
    to_account_id: idStr,
    from_amount: posAmount,
    to_amount: posAmount,
    fee_amount: nonNegAmount.nullish(),
    fee_currency: optStr,
    note: optStr,
});
export const transactionUpdateSchema = z.object({
    type: z.enum(["exchange", "transfer"]).optional(),
    date: isoDate.optional(),
    from_account_id: idStr.optional(),
    to_account_id: idStr.optional(),
    from_amount: posAmount.optional(),
    to_amount: posAmount.optional(),
    fee_amount: nonNegAmount.nullish(),
    fee_currency: optStr,
    note: optStr,
});

// ── Goals (формат hex / обязательность target_currency — в домене) ──────────
export const goalCreateSchema = z.object({
    id: idStr.optional(),
    name: nameStr,
    emoji: optStr,
    color: optStr,
    target_amount: posAmount.nullish(),
    target_currency: optStr,
    deadline: optStr,
    note: optStr,
});
export const goalUpdateSchema = z.object({
    name: nameStr.optional(),
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
    id: idStr.optional(),
    goal_id: idStr,
    date: isoDate,
    amount: posAmount,
    currency_code: ccyStr.optional(),   // сервер деривит из ведра, клиентское игнорируется
    account_id: idStr,
    note: optStr,
});
export const contributionUpdateSchema = z.object({
    goal_id: idStr.optional(),
    date: isoDate.optional(),
    amount: posAmount.optional(),
    currency_code: ccyStr.optional(),
    account_id: idStr.optional(),
    note: optStr,
});

// ── Budgets (SPEC-020; бизнес-правила scope/FK/uniqueness — в budgets.ts) ───
// SPEC-038: верхняя граница — ловит fat-finger (лишний ноль), 1M EUR/мес заведомо
// выше любого личного месячного лимита; бамп тривиален.
const budgetLimit = z.number().positive("amount must be positive").max(1_000_000, "limit_eur too large");
export const budgetCreateSchema = z.object({
    id: idStr.optional(),
    scope: z.enum(["category", "total"]).optional(),   // default 'category' в домене
    category_id: optStr,                               // обязателен при scope='category' (проверка в домене)
    limit_eur: budgetLimit,
});
export const budgetUpdateSchema = z.object({
    limit_eur: budgetLimit,
});

// ── Adaptive budgets (SPEC-023; домен RBAR в rbar.ts) ───────────────────────
const archetypeEnum = z.enum(["fixed", "recurring", "seasonal", "lumpy", "intermittent"]);
export const budgetSettingsSchema = z.object({
    archetype_override: archetypeEnum.nullish(),
    floor_eur: nonNegAmount.nullish(),
    adaptive_enabled: z.boolean().optional(),
});
export const budgetDecisionSchema = z.object({
    category_id: idStr,
    period: z.string().regex(/^\d{4}-\d{2}$/, "period must be YYYY-MM").refine(p => { const m = Number(p.slice(5)); return m >= 1 && m <= 12; }, "period month must be 01-12"),
    archetype: z.string().min(1).max(32),
    prev_limit_eur: nonNegAmount.nullish(),
    reco_limit_eur: nonNegAmount,
    reason_code: z.string().min(1).max(64),
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
    id: idStr.optional(),
    name: nameStr,
    emoji: optStr,
    color: optStr,
    sort_order: z.number().finite().nullish(),
});
export const categoryUpdateSchema = z.object({
    name: nameStr.optional(),
    emoji: optStr,
    color: optStr,
    sort_order: z.number().finite().nullish(),
    is_active: z.union([z.boolean(), z.number()]).optional(),
});

/** Человекочитаемое сообщение из ZodError для тела 400. */
export function zodMessage(err: z.ZodError): string {
    return err.issues
        .map(i => `${i.path.join(".") || "body"}: ${i.message}`)
        .join("; ");
}
