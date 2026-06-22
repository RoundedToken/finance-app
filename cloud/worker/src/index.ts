/**
 * finances-worker — D1-centric, single API для двух клиентов (ADR-011, ADR-012).
 * Endpoints:
 *   POST   /tg                       — Telegram webhook
 *   GET    /v1/bootstrap              — refs + initial expenses (initData)
 *   GET    /v1/expenses               — list (initData)
 *   POST   /v1/expenses               — create (initData)
 *   PUT    /v1/expenses/:id           — update (initData)
 *   DELETE /v1/expenses/:id           — soft delete (initData)
 *   GET    /v1/rates                  — текущие курсы (initData)
 *
 *   GET    /v1/auth/google/start      — OAuth redirect
 *   GET    /v1/auth/google/callback   — OAuth code → JWT
 *   GET    /v1/web/me                 — sanity-check сессии (Bearer JWT)
 *   GET    /v1/web/expenses           — read-only список для Admin (Bearer JWT)
 *   GET    /v1/web/references         — accounts/categories/currencies (Bearer JWT)
 *   GET    /v1/web/accounts           — buckets + latest_snapshot (Bearer JWT)
 *   *      /v1/web/snapshots[/:id]    — CRUD snapshots (Bearer JWT)
 *   GET    /v1/web/income-categories  — список категорий доходов (Bearer JWT)
 *   *      /v1/web/incomes[/:id]      — CRUD incomes (Bearer JWT)
 *   GET    /v1/web/dashboard          — агрегированный дашборд (Bearer JWT)
 *
 *   POST   /v1/admin/references       — push refs (system bearer)
 *   POST   /v1/admin/migrate-expenses — bulk insert (system bearer)
 *   POST   /v1/admin/refresh-rates    — pull rates (system bearer)
 *   POST   /v1/admin/bulk-rates       — bulk insert rates (system bearer)
 *   GET    /healthz                   — public
 */

import type { Env } from "./types";
import { validateInitData, checkBearer } from "./auth";
import {
    isAuthorizedUser,
    createExpense,
    updateExpense,
    deleteExpense,
    listExpenses,
    bulkInsertExpenses,
    getBootstrapData,
    replaceReferences,
    setAppConfig,
} from "./db";
import { handleTelegramUpdate } from "./bot";
import { fetchLatestRatesEUR, fetchCryptoRatesEUR, fetchLidoStethApr, saveRates, saveCryptoRates, getLatestRates, loadRatesIndex } from "./rates";
import { getInvestments, upsertInvestmentSettings, STETH_APR_KEY } from "./investments";
import {
    listExpenseCategories,
    createExpenseCategory,
    updateExpenseCategory,
    createIncomeCategory,
    updateIncomeCategory,
} from "./categories";
import { handleGoogleStart, handleGoogleCallback, handleAdminMe, requireAdminSession } from "./auth-google";
import { corsHeaders, jsonResponse as jsonRes } from "./cors";
import {
    listSnapshots,
    latestManualSnapshotPerAccount,
    effectiveBalancePerAccount,
    createSnapshot,
    updateSnapshot,
    deleteSnapshot,
    listBuckets,
} from "./snapshots";
import {
    listIncomes,
    listIncomeCategories,
    createIncome,
    updateIncome,
    deleteIncome,
} from "./incomes";
import {
    listGoals,
    getGoalDetail,
    createGoal,
    updateGoal,
    setGoalStatus,
    deleteGoal,
    createContribution,
    updateContribution,
    deleteContribution,
} from "./goals";
import {
    listTransactions,
    createTransaction,
    updateTransaction,
    deleteTransaction,
} from "./transactions";
import { getDashboard } from "./dashboard";
import {
    getBudgetsWithProgress,
    createBudget,
    updateBudget,
    deleteBudget,
} from "./budgets";
import {
    getRecommendations,
    getArchetypes,
    upsertBudgetSettings,
    logRecommendationDecision,
} from "./rbar";
import {
    expenseCreateSchema, expenseUpdateSchema, incomeCreateSchema, incomeUpdateSchema,
    snapshotCreateSchema, snapshotUpdateSchema, transactionCreateSchema, transactionUpdateSchema,
    goalCreateSchema, goalUpdateSchema, goalStatusSchema, contributionCreateSchema,
    contributionUpdateSchema, categoryCreateSchema, categoryUpdateSchema,
    budgetCreateSchema, budgetUpdateSchema, budgetSettingsSchema, budgetDecisionSchema,
    investmentSettingsSchema, zodMessage,
} from "./schemas";
import type { z } from "zod";

export default {
    /** Cron Trigger — ежедневно тянет курсы (фиат из Google Sheets + крипта из Binance). */
    async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
        try {
            const payload = await fetchLatestRatesEUR(env);
            const n = await saveRates(env, payload);
            console.log(`scheduled rates: saved ${n} for date ${payload.date}`);
        } catch (e) {
            console.error("scheduled rates failed:", e);
        }
        // SPEC-026: крипто-курсы (ETH) — ОТДЕЛЬНЫЙ try/catch, чтобы гео-блок/таймаут
        // Binance не валил фиат-курсы (E7). Падение → курс ETH остаётся вчерашним.
        try {
            const crypto = await fetchCryptoRatesEUR();
            const n = await saveCryptoRates(env, crypto);
            console.log(`scheduled crypto rates: saved ${n} via ${crypto.provider} for date ${crypto.date}`);
        } catch (e) {
            console.error("scheduled crypto rates failed:", e);
        }
        // SPEC-027: авто-APR stETH с Lido — отдельный try/catch (изоляция).
        try {
            const apr = await fetchLidoStethApr();
            await setAppConfig(env, STETH_APR_KEY, String(apr));
            console.log(`scheduled lido apr: ${apr}`);
        } catch (e) {
            console.error("scheduled lido apr failed:", e);
        }
    },

    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        const path = url.pathname;

        if (request.method === "OPTIONS") {
            return new Response(null, {
                status: 204,
                headers: corsHeaders(request, env),
            });
        }

        try {
            if (path === "/healthz") return json({ ok: true }, 200, request, env);
            if (path === "/tg" && request.method === "POST") return handleTg(request, env);

            // ── Mini App API ────────────────────────────────────────────────
            if (path === "/v1/bootstrap" && request.method === "GET") return handleBootstrap(request, env);
            if (path === "/v1/expenses" && request.method === "GET") return handleListExpenses(request, env, url);
            if (path === "/v1/expenses" && request.method === "POST") return handleCreateExpense(request, env);
            const m = path.match(/^\/v1\/expenses\/([0-9a-fA-F-]+)$/);
            if (m) {
                if (request.method === "PUT") return handleUpdateExpense(request, env, m[1]);
                if (request.method === "DELETE") return handleDeleteExpense(request, env, m[1]);
            }
            if (path === "/v1/rates" && request.method === "GET") return handleGetRates(request, env);

            // ── Web Admin auth ──────────────────────────────────────────────
            if (path === "/v1/auth/google/start" && request.method === "GET") return handleGoogleStart(request, env);
            if (path === "/v1/auth/google/callback" && request.method === "GET") return handleGoogleCallback(request, env);

            // ── Web Admin API (Bearer JWT) ───────────────────────────────────
            if (path === "/v1/web/me" && request.method === "GET") return handleAdminMe(request, env);
            if (path === "/v1/web/expenses" && request.method === "GET") return handleWebExpenses(request, env, url);
            if (path === "/v1/web/references" && request.method === "GET") return handleWebReferences(request, env);
            if (path === "/v1/web/accounts" && request.method === "GET") return handleWebAccounts(request, env, url);
            if (path === "/v1/web/snapshots" && request.method === "GET") return handleWebSnapshotsList(request, env, url);
            if (path === "/v1/web/snapshots" && request.method === "POST") return handleWebSnapshotsCreate(request, env);
            const snapMatch = path.match(/^\/v1\/web\/snapshots\/([0-9a-fA-F-]+)$/);
            if (snapMatch) {
                if (request.method === "PUT") return handleWebSnapshotsUpdate(request, env, snapMatch[1]);
                if (request.method === "DELETE") return handleWebSnapshotsDelete(request, env, snapMatch[1]);
            }
            // Category management (SPEC-017)
            if (path === "/v1/web/categories" && request.method === "GET") return handleWebCategoriesList(request, env, url);
            if (path === "/v1/web/categories" && request.method === "POST") return handleWebCategoriesCreate(request, env);
            const catMatch = path.match(/^\/v1\/web\/categories\/([^/]+)$/);
            if (catMatch && request.method === "PUT") return handleWebCategoriesUpdate(request, env, catMatch[1]);
            if (path === "/v1/web/income-categories" && request.method === "GET") return handleWebIncomeCategories(request, env, url);
            if (path === "/v1/web/income-categories" && request.method === "POST") return handleWebIncomeCategoriesCreate(request, env);
            const incCatMatch = path.match(/^\/v1\/web\/income-categories\/([^/]+)$/);
            if (incCatMatch && request.method === "PUT") return handleWebIncomeCategoriesUpdate(request, env, incCatMatch[1]);
            if (path === "/v1/web/incomes" && request.method === "GET") return handleWebIncomesList(request, env, url);
            if (path === "/v1/web/incomes" && request.method === "POST") return handleWebIncomesCreate(request, env);
            const incMatch = path.match(/^\/v1\/web\/incomes\/([0-9a-fA-F-]+)$/);
            if (incMatch) {
                if (request.method === "PUT") return handleWebIncomesUpdate(request, env, incMatch[1]);
                if (request.method === "DELETE") return handleWebIncomesDelete(request, env, incMatch[1]);
            }
            if (path === "/v1/web/goals" && request.method === "GET") return handleWebGoalsList(request, env, url);
            if (path === "/v1/web/goals" && request.method === "POST") return handleWebGoalsCreate(request, env);
            const goalStatusMatch = path.match(/^\/v1\/web\/goals\/([0-9a-fA-F-]+)\/status$/);
            if (goalStatusMatch && request.method === "POST") return handleWebGoalsSetStatus(request, env, goalStatusMatch[1]);
            const goalMatch = path.match(/^\/v1\/web\/goals\/([0-9a-fA-F-]+)$/);
            if (goalMatch) {
                if (request.method === "GET") return handleWebGoalsDetail(request, env, goalMatch[1]);
                if (request.method === "PUT") return handleWebGoalsUpdate(request, env, goalMatch[1]);
                if (request.method === "DELETE") return handleWebGoalsDelete(request, env, goalMatch[1]);
            }
            if (path === "/v1/web/goal-contributions" && request.method === "POST") return handleWebContributionsCreate(request, env);
            const contribMatch = path.match(/^\/v1\/web\/goal-contributions\/([0-9a-fA-F-]+)$/);
            if (contribMatch) {
                if (request.method === "PUT") return handleWebContributionsUpdate(request, env, contribMatch[1]);
                if (request.method === "DELETE") return handleWebContributionsDelete(request, env, contribMatch[1]);
            }
            if (path === "/v1/web/transactions" && request.method === "GET") return handleWebTransactionsList(request, env, url);
            if (path === "/v1/web/transactions" && request.method === "POST") return handleWebTransactionsCreate(request, env);
            const txMatch = path.match(/^\/v1\/web\/transactions\/([0-9a-fA-F-]+)$/);
            if (txMatch) {
                if (request.method === "PUT")    return handleWebTransactionsUpdate(request, env, txMatch[1]);
                if (request.method === "DELETE") return handleWebTransactionsDelete(request, env, txMatch[1]);
            }
            if (path === "/v1/web/dashboard" && request.method === "GET") return handleWebDashboard(request, env, url);

            // ── Web Admin · investments (SPEC-026) ───────────────────────────
            if (path === "/v1/web/investments" && request.method === "GET") return handleWebInvestments(request, env, url);
            const invSettingsMatch = path.match(/^\/v1\/web\/investments\/settings\/([A-Za-z0-9_-]+)$/);
            if (invSettingsMatch && request.method === "PUT") return handleWebInvestmentSettings(request, env, invSettingsMatch[1]);

            // ── Web Admin · adaptive budgets RBAR (SPEC-023) — ДО generic budgets/:id ─
            if (path === "/v1/web/budgets/recommendations" && request.method === "GET") return handleWebBudgetRecommendations(request, env, url);
            if (path === "/v1/web/budgets/recommendations/decision" && request.method === "POST") return handleWebBudgetDecision(request, env);
            if (path === "/v1/web/budgets/archetypes" && request.method === "GET") return handleWebBudgetArchetypes(request, env);
            const settingsMatch = path.match(/^\/v1\/web\/budgets\/settings\/([A-Za-z0-9_-]+)$/);
            if (settingsMatch && request.method === "PUT") return handleWebBudgetSettingsUpdate(request, env, settingsMatch[1]);

            // ── Web Admin · budgets (SPEC-020) ───────────────────────────────
            if (path === "/v1/web/budgets" && request.method === "GET") return handleWebBudgetsList(request, env);
            if (path === "/v1/web/budgets" && request.method === "POST") return handleWebBudgetsCreate(request, env);
            const budgetMatch = path.match(/^\/v1\/web\/budgets\/([0-9a-fA-F-]+)$/);
            if (budgetMatch) {
                if (request.method === "PUT") return handleWebBudgetsUpdate(request, env, budgetMatch[1]);
                if (request.method === "DELETE") return handleWebBudgetsDelete(request, env, budgetMatch[1]);
            }

            // ── System admin (Bearer SYNC_TOKEN) ─────────────────────────────
            if (path === "/v1/admin/references" && request.method === "POST") return handlePushReferences(request, env);
            if (path === "/v1/admin/migrate-expenses" && request.method === "POST") return handleMigrate(request, env);
            if (path === "/v1/admin/refresh-rates" && request.method === "POST") return handleRefreshRates(request, env);
            if (path === "/v1/admin/bulk-rates" && request.method === "POST") return handleBulkRates(request, env);

            return json({ error: "not found" }, 404, request, env);
        } catch (err) {
            // S1: детали ошибки (SQL-фрагменты, пути) — только в лог, не в тело
            // публичного ответа. Зеркалит обработку в handleWebDashboard.
            console.error("unhandled", err);
            return json({ error: "internal" }, 500, request, env);
        }
    },
};

// ── Telegram bot webhook ───────────────────────────────────────────────────
async function handleTg(request: Request, env: Env): Promise<Response> {
    const body = await request.json().catch(() => null);
    if (!body) return json({ ok: false, reason: "bad json" }, 200, request, env);
    try {
        await handleTelegramUpdate(body as any, env);
    } catch (e) {
        console.error("bot error", e);
    }
    return json({ ok: true }, 200, request, env);
}

// ── Mini App handlers ──────────────────────────────────────────────────────
async function handleBootstrap(request: Request, env: Env): Promise<Response> {
    const auth = await authenticateMiniApp(request, env);
    if (!auth.ok) return auth.response;
    return json(await getBootstrapData(env), 200, request, env);
}

async function handleListExpenses(request: Request, env: Env, url: URL): Promise<Response> {
    const auth = await authenticateMiniApp(request, env);
    if (!auth.ok) return auth.response;
    const limit = parseInt(url.searchParams.get("limit") ?? "500", 10);
    const from = url.searchParams.get("from") ?? undefined;
    const rows = await listExpenses(env, { limit, from });
    return json({ expenses: rows }, 200, request, env);
}

async function handleCreateExpense(request: Request, env: Env): Promise<Response> {
    const auth = await authenticateMiniApp(request, env);
    if (!auth.ok) return auth.response;
    const parsed = await readBody(request, env, expenseCreateSchema);
    if (!parsed.ok) return parsed.response;
    const r = await createExpense(env, auth.userId!, parsed.data);
    if (!r.ok) return json({ error: r.error }, 400, request, env);
    return json({ ok: true, inserted: r.inserted }, 200, request, env);
}

async function handleUpdateExpense(request: Request, env: Env, id: string): Promise<Response> {
    const auth = await authenticateMiniApp(request, env);
    if (!auth.ok) return auth.response;
    const parsed = await readBody(request, env, expenseUpdateSchema);
    if (!parsed.ok) return parsed.response;
    const r = await updateExpense(env, id, auth.userId!, parsed.data);
    if (!r.ok) return json({ error: r.error }, 400, request, env);   // SPEC-032: рассогласование валюта↔счёт
    return json({ ok: true, updated: r.updated }, 200, request, env);
}

async function handleDeleteExpense(request: Request, env: Env, id: string): Promise<Response> {
    const auth = await authenticateMiniApp(request, env);
    if (!auth.ok) return auth.response;
    const r = await deleteExpense(env, id, auth.userId!);
    return json({ ok: true, ...r }, 200, request, env);
}

async function handleGetRates(request: Request, env: Env): Promise<Response> {
    const auth = await authenticateMiniApp(request, env);
    if (!auth.ok) return auth.response;
    const data = await getLatestRates(env);
    return json(data, 200, request, env);
}

// ── Web Admin handlers ─────────────────────────────────────────────────────
async function handleWebExpenses(request: Request, env: Env, url: URL): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    const limit = parseInt(url.searchParams.get("limit") ?? "20000", 10);
    const from = url.searchParams.get("from") ?? undefined;
    const rows = await listExpenses(env, { limit, from });
    return json({ expenses: rows }, 200, request, env);
}

async function handleWebReferences(request: Request, env: Env): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    const bootstrap = await getBootstrapData(env, { withExpenses: false, withBudgets: false });   // refs не используют ни траты (Фаза 1.8), ни бюджеты (SPEC-020)
    return json({
        accounts: bootstrap.accounts,
        categories: bootstrap.categories,
        currencies: bootstrap.currencies,
        rates: bootstrap.rates,
    }, 200, request, env);
}

/** Локальное «сегодня» клиента из ?today=YYYY-MM-DD (зона устройства), иначе UTC
 *  fallback (SPEC-024). Валидируем формат — в SQL уходит только как bind/сравнение. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function resolveToday(url: URL): string {
    const t = url.searchParams.get("today");
    return t && ISO_DATE_RE.test(t) ? t : new Date().toISOString().slice(0, 10);
}

async function handleWebAccounts(request: Request, env: Env, url: URL): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    // SPEC-011: balance computed on-demand. Manual snapshot — отдельное поле.
    // SPEC-016: EUR-эквивалент (запас → курс НА СЕГОДНЯ, mark-to-market) считаем
    // на worker через canonical RatesIndex per-quote — клиент не конвертирует.
    // net/targeted/free зеркалят dashboard KPI «сейчас» (AC7).
    // SPEC-024: «сегодня» — локальный день клиента (?today=), иначе UTC.
    const today = resolveToday(url);
    // Фаза 1.8: rates грузим один раз и передаём в listGoals (раньше listGoals
    // грузил их повторно — двойная загрузка на каждом /accounts).
    const rates = await loadRatesIndex(env);
    const [buckets, manual, effective, goals] = await Promise.all([
        listBuckets(env),
        latestManualSnapshotPerAccount(env),
        effectiveBalancePerAccount(env, today),   // asOf=today → зеркалит dashboard KPI (AC7), без будущих событий
        listGoals(env, { status: "active" }, rates),
    ]);
    const r2 = (x: number) => Math.round(x * 100) / 100;

    let netWorthEur = 0, investedEur = 0, missingRates = 0;
    const enriched = buckets.map((b: any) => {
        const balance = effective[b.id]?.balance ?? 0;
        const eur = rates.toEurAt(balance, b.currency, today);
        if (eur == null) missingRates++;
        else {
            netWorthEur += eur;
            // SPEC-026: инвест-ведро входит в net, но вычитается из free (invested).
            if (b.is_investment) investedEur += eur;
        }
        return {
            ...b,
            is_investment: !!b.is_investment,
            manual_snapshot: manual[b.id] ?? null,
            effective_balance: balance,
            effective_balance_eur: eur == null ? null : r2(eur),
            events_count: effective[b.id]?.events_count ?? 0,
        };
    });

    let targetedEur = 0;
    for (const g of goals) {
        if (g.target_currency) {
            const eur = rates.toEurAt(g.balance, g.target_currency, today);
            if (eur == null) missingRates++; else targetedEur += eur;
        } else {
            targetedEur += g.balance;   // legacy без target_currency — balance в EUR-нейтрале
        }
    }

    return json({
        accounts: enriched,
        summary: {
            net_worth_eur: r2(netWorthEur),
            targeted_eur: r2(targetedEur),
            invested_eur: r2(investedEur),
            free_eur: r2(netWorthEur - targetedEur - investedEur),   // SPEC-026
            missing_rates: missingRates,
            rates_date: rates.latestDate(),
        },
    }, 200, request, env);
}

async function handleWebSnapshotsList(request: Request, env: Env, url: URL): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    const limit = parseInt(url.searchParams.get("limit") ?? "1000", 10);
    const from = url.searchParams.get("from") ?? undefined;
    const accountId = url.searchParams.get("account_id") ?? undefined;
    const rows = await listSnapshots(env, { limit, from, accountId });
    return json({ snapshots: rows }, 200, request, env);
}

async function handleWebSnapshotsCreate(request: Request, env: Env): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    const parsed = await readBody(request, env, snapshotCreateSchema);
    if (!parsed.ok) return parsed.response;
    const r = await createSnapshot(env, parsed.data);
    if (!r.ok) return json({ error: r.error }, 400, request, env);
    return json({ ok: true, id: r.id, inserted: r.inserted }, 200, request, env);
}

async function handleWebSnapshotsUpdate(request: Request, env: Env, id: string): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    const parsed = await readBody(request, env, snapshotUpdateSchema);
    if (!parsed.ok) return parsed.response;
    const r = await updateSnapshot(env, id, parsed.data);
    return json({ ok: true, ...r }, 200, request, env);
}

async function handleWebSnapshotsDelete(request: Request, env: Env, id: string): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    const r = await deleteSnapshot(env, id);
    return json({ ok: true, ...r }, 200, request, env);
}

// ── Web Admin · category management (SPEC-017) ────────────────────────────
async function handleWebCategoriesList(request: Request, env: Env, url: URL): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    const includeInactive = url.searchParams.get("include_inactive") === "1";
    return json({ categories: await listExpenseCategories(env, includeInactive) }, 200, request, env);
}

async function handleWebCategoriesCreate(request: Request, env: Env): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    const parsed = await readBody(request, env, categoryCreateSchema);
    if (!parsed.ok) return parsed.response;
    const r = await createExpenseCategory(env, parsed.data);
    if (!r.ok) return json({ error: r.error }, 400, request, env);
    return json(r, 200, request, env);
}

async function handleWebCategoriesUpdate(request: Request, env: Env, id: string): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    const parsed = await readBody(request, env, categoryUpdateSchema);
    if (!parsed.ok) return parsed.response;
    const r = await updateExpenseCategory(env, id, parsed.data);
    if (!r.ok) return json({ error: r.error }, 400, request, env);
    return json(r, 200, request, env);
}

// ── Web Admin · incomes ───────────────────────────────────────────────────
async function handleWebIncomeCategories(request: Request, env: Env, url: URL): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    const includeInactive = url.searchParams.get("include_inactive") === "1";
    return json({ categories: await listIncomeCategories(env, includeInactive) }, 200, request, env);
}

async function handleWebIncomeCategoriesCreate(request: Request, env: Env): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    const parsed = await readBody(request, env, categoryCreateSchema);
    if (!parsed.ok) return parsed.response;
    const r = await createIncomeCategory(env, parsed.data);
    if (!r.ok) return json({ error: r.error }, 400, request, env);
    return json(r, 200, request, env);
}

async function handleWebIncomeCategoriesUpdate(request: Request, env: Env, id: string): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    const parsed = await readBody(request, env, categoryUpdateSchema);
    if (!parsed.ok) return parsed.response;
    const r = await updateIncomeCategory(env, id, parsed.data);
    if (!r.ok) return json({ error: r.error }, 400, request, env);
    return json(r, 200, request, env);
}

async function handleWebIncomesList(request: Request, env: Env, url: URL): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    const limit = parseInt(url.searchParams.get("limit") ?? "1000", 10);
    const from = url.searchParams.get("from") ?? undefined;
    const to = url.searchParams.get("to") ?? undefined;
    const accountId = url.searchParams.get("account_id") ?? undefined;
    const categoryId = url.searchParams.get("category_id") ?? undefined;
    const goalId = url.searchParams.get("goal_id") ?? undefined;
    const rows = await listIncomes(env, { limit, from, to, accountId, categoryId, goalId });
    return json({ incomes: rows }, 200, request, env);
}

async function handleWebIncomesCreate(request: Request, env: Env): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    const parsed = await readBody(request, env, incomeCreateSchema);
    if (!parsed.ok) return parsed.response;
    const r = await createIncome(env, parsed.data);
    if (!r.ok) return json({ error: r.error }, 400, request, env);
    return json({ ok: true, id: r.id, inserted: r.inserted }, 200, request, env);
}

async function handleWebIncomesUpdate(request: Request, env: Env, id: string): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    const parsed = await readBody(request, env, incomeUpdateSchema);
    if (!parsed.ok) return parsed.response;
    const r = await updateIncome(env, id, parsed.data);
    if (!r.ok) return json({ error: r.error }, 400, request, env);
    return json({ ok: true, updated: r.updated }, 200, request, env);
}

async function handleWebIncomesDelete(request: Request, env: Env, id: string): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    const r = await deleteIncome(env, id);
    return json({ ok: true, ...r }, 200, request, env);
}

// ── Web Admin · goals ─────────────────────────────────────────────────────
async function handleWebGoalsList(request: Request, env: Env, url: URL): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    const statusRaw = url.searchParams.get("status") ?? "active";
    const ALLOWED = ["active", "achieved", "archived", "all"] as const;
    if (!ALLOWED.includes(statusRaw as any)) {
        return json({ error: "invalid status" }, 400, request, env);
    }
    const goals = await listGoals(env, { status: statusRaw as any });
    return json({ goals }, 200, request, env);
}

async function handleWebGoalsDetail(request: Request, env: Env, id: string): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    const data = await getGoalDetail(env, id);
    if (!data.goal) return json({ error: "not found" }, 404, request, env);
    return json(data, 200, request, env);
}

async function handleWebGoalsCreate(request: Request, env: Env): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    const parsed = await readBody(request, env, goalCreateSchema);
    if (!parsed.ok) return parsed.response;
    const r = await createGoal(env, parsed.data);
    if (!r.ok) return json({ error: r.error }, 400, request, env);
    return json({ ok: true, id: r.id, inserted: r.inserted }, 200, request, env);
}

async function handleWebGoalsUpdate(request: Request, env: Env, id: string): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    const parsed = await readBody(request, env, goalUpdateSchema);
    if (!parsed.ok) return parsed.response;
    const r = await updateGoal(env, id, parsed.data);
    if (!r.ok) return json({ error: r.error }, 400, request, env);
    return json({ ok: true, updated: r.updated }, 200, request, env);
}

async function handleWebGoalsSetStatus(request: Request, env: Env, id: string): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    const parsed = await readBody(request, env, goalStatusSchema);
    if (!parsed.ok) return parsed.response;
    const r = await setGoalStatus(env, id, parsed.data.status);
    if (!r.ok) return json({ error: r.error }, 400, request, env);
    return json({ ok: true, updated: r.updated }, 200, request, env);
}

async function handleWebGoalsDelete(request: Request, env: Env, id: string): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    const r = await deleteGoal(env, id);
    return json({ ok: true, ...r }, 200, request, env);
}

async function handleWebContributionsCreate(request: Request, env: Env): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    const parsed = await readBody(request, env, contributionCreateSchema);
    if (!parsed.ok) return parsed.response;
    const r = await createContribution(env, parsed.data);
    if (!r.ok) return json({ error: r.error }, 400, request, env);
    return json({ ok: true, id: r.id, inserted: r.inserted }, 200, request, env);
}

async function handleWebContributionsUpdate(request: Request, env: Env, id: string): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    const parsed = await readBody(request, env, contributionUpdateSchema);
    if (!parsed.ok) return parsed.response;
    const r = await updateContribution(env, id, parsed.data);
    if (!r.ok) return json({ error: r.error }, 400, request, env);
    return json({ ok: true, updated: r.updated }, 200, request, env);
}

async function handleWebContributionsDelete(request: Request, env: Env, id: string): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    const r = await deleteContribution(env, id);
    return json({ ok: true, ...r }, 200, request, env);
}

// ── Web Admin · transactions ──────────────────────────────────────────────
async function handleWebTransactionsList(request: Request, env: Env, url: URL): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    const limit = parseInt(url.searchParams.get("limit") ?? "1000", 10);
    const rows = await listTransactions(env, {
        limit,
        from: url.searchParams.get("from") ?? undefined,
        to: url.searchParams.get("to") ?? undefined,
        type: (url.searchParams.get("type") as any) ?? undefined,
        accountId: url.searchParams.get("account_id") ?? undefined,
    });
    return json({ transactions: rows }, 200, request, env);
}

async function handleWebTransactionsCreate(request: Request, env: Env): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    const parsed = await readBody(request, env, transactionCreateSchema);
    if (!parsed.ok) return parsed.response;
    const r = await createTransaction(env, parsed.data);
    if (!r.ok) return json({ error: r.error }, 400, request, env);
    return json({ ok: true, id: r.id, inserted: r.inserted }, 200, request, env);
}

async function handleWebTransactionsUpdate(request: Request, env: Env, id: string): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    const parsed = await readBody(request, env, transactionUpdateSchema);
    if (!parsed.ok) return parsed.response;
    const r = await updateTransaction(env, id, parsed.data);
    if (!r.ok) return json({ error: r.error }, 400, request, env);
    return json({ ok: true, updated: r.updated }, 200, request, env);
}

async function handleWebTransactionsDelete(request: Request, env: Env, id: string): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    const r = await deleteTransaction(env, id);
    return json({ ok: true, ...r }, 200, request, env);
}

// ── Web Admin · dashboard (SPEC-013) ──────────────────────────────────────
async function handleWebDashboard(request: Request, env: Env, url: URL): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    try {
        const data = await getDashboard(env, {
            from: url.searchParams.get("from") ?? undefined,
            to: url.searchParams.get("to") ?? undefined,
            today: resolveToday(url),   // SPEC-024: локальный день клиента, иначе UTC
        });
        return json(data, 200, request, env);
    } catch (err) {
        // generic 5xx без stack-trace в body (SPEC-013 §8); детали — только в лог.
        console.error("dashboard error", err);
        return json({ error: "internal" }, 500, request, env);
    }
}

// ── Web Admin · investments (SPEC-026) ────────────────────────────────────
async function handleWebInvestments(request: Request, env: Env, url: URL): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    try {
        // SPEC-029: окно value_series — from/to (как /dashboard); getInvestments валидирует ISO.
        const from = url.searchParams.get("from") ?? undefined;
        const to = url.searchParams.get("to") ?? undefined;
        const data = await getInvestments(env, { today: resolveToday(url), from, to });
        return json(data, 200, request, env);
    } catch (err) {
        console.error("investments error", err);
        return json({ error: "internal" }, 500, request, env);
    }
}

async function handleWebInvestmentSettings(request: Request, env: Env, accountId: string): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    const parsed = await readBody(request, env, investmentSettingsSchema);
    if (!parsed.ok) return parsed.response;
    const r = await upsertInvestmentSettings(env, accountId, parsed.data);
    if (!r.ok) return json({ error: r.error }, 400, request, env);
    return json({ ok: true, updated: r.updated }, 200, request, env);
}

// ── Web Admin · budgets (SPEC-020) ────────────────────────────────────────
async function handleWebBudgetsList(request: Request, env: Env): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    return json(await getBudgetsWithProgress(env), 200, request, env);
}

async function handleWebBudgetsCreate(request: Request, env: Env): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    const parsed = await readBody(request, env, budgetCreateSchema);
    if (!parsed.ok) return parsed.response;
    const r = await createBudget(env, parsed.data);
    if (!r.ok) return json({ error: r.error }, 400, request, env);
    return json({ ok: true, id: r.id, inserted: r.inserted }, 200, request, env);
}

async function handleWebBudgetsUpdate(request: Request, env: Env, id: string): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    const parsed = await readBody(request, env, budgetUpdateSchema);
    if (!parsed.ok) return parsed.response;
    const r = await updateBudget(env, id, parsed.data);
    if (!r.ok) return json({ error: r.error }, 400, request, env);
    return json({ ok: true, updated: r.updated }, 200, request, env);
}

async function handleWebBudgetsDelete(request: Request, env: Env, id: string): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    const r = await deleteBudget(env, id);
    return json({ ok: true, ...r }, 200, request, env);
}

// ── Web Admin · adaptive budgets RBAR (SPEC-023) ───────────────────────────
async function handleWebBudgetRecommendations(request: Request, env: Env, url: URL): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    const period = url.searchParams.get("period") ?? undefined;
    const valid = period === undefined || /^\d{4}-\d{2}$/.test(period);
    return json(await getRecommendations(env, { period: valid ? period : undefined }), 200, request, env);
}

async function handleWebBudgetArchetypes(request: Request, env: Env): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    return json(await getArchetypes(env), 200, request, env);
}

async function handleWebBudgetSettingsUpdate(request: Request, env: Env, categoryId: string): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    const parsed = await readBody(request, env, budgetSettingsSchema);
    if (!parsed.ok) return parsed.response;
    const r = await upsertBudgetSettings(env, categoryId, parsed.data);
    if (!r.ok) return json({ error: r.error }, 400, request, env);
    return json({ ok: true, updated: r.updated }, 200, request, env);
}

async function handleWebBudgetDecision(request: Request, env: Env): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    const parsed = await readBody(request, env, budgetDecisionSchema);
    if (!parsed.ok) return parsed.response;
    const r = await logRecommendationDecision(env, parsed.data);
    if (!r.ok) return json({ error: r.error }, 400, request, env);
    return json({ ok: true, id: r.id }, 200, request, env);
}

// SPEC-012: chain endpoints удалены. transactions работают как
// одиночные операции (exchange/transfer). Goal-tagging на tx тоже
// удалено — incomes остаются единственным способом привязать деньги
// к цели.

// ── System admin (bearer) ──────────────────────────────────────────────────
async function handlePushReferences(request: Request, env: Env): Promise<Response> {
    if (!checkBearer(request, env.SYNC_TOKEN)) return json({ error: "unauthorized" }, 401, request, env);
    const body = (await request.json().catch(() => ({}))) as any;
    await replaceReferences(env, body);
    return json({
        ok: true,
        replaced: {
            accounts: body.accounts?.length ?? null,
            categories: body.categories?.length ?? null,
            currencies: body.currencies?.length ?? null,
        },
    }, 200, request, env);
}

async function handleRefreshRates(request: Request, env: Env): Promise<Response> {
    if (!checkBearer(request, env.SYNC_TOKEN)) return json({ error: "unauthorized" }, 401, request, env);
    const payload = await fetchLatestRatesEUR(env);
    const n = await saveRates(env, payload);
    // SPEC-026: крипта (ETH) — отдельный try/catch, падение не валит ответ по фиату (E7).
    let cryptoSaved = 0;
    let cryptoProvider: string | null = null;
    let cryptoError: string | null = null;
    try {
        const crypto = await fetchCryptoRatesEUR(payload.date);
        cryptoSaved = await saveCryptoRates(env, crypto);
        cryptoProvider = crypto.provider ?? null;
    } catch (e) {
        cryptoError = String((e as Error)?.message ?? e);
        console.error("refresh crypto rates failed:", e);
    }
    // SPEC-027: авто-APR stETH с Lido — отдельный try/catch.
    let lidoApr: number | null = null;
    let lidoError: string | null = null;
    try {
        lidoApr = await fetchLidoStethApr();
        await setAppConfig(env, STETH_APR_KEY, String(lidoApr));
    } catch (e) {
        lidoError = String((e as Error)?.message ?? e);
        console.error("refresh lido apr failed:", e);
    }
    return json({ ok: true, saved: n, crypto_saved: cryptoSaved, crypto_provider: cryptoProvider, crypto_error: cryptoError, lido_apr: lidoApr, lido_error: lidoError, date: payload.date }, 200, request, env);
}

async function handleBulkRates(request: Request, env: Env): Promise<Response> {
    if (!checkBearer(request, env.SYNC_TOKEN)) return json({ error: "unauthorized" }, 401, request, env);
    const body = (await request.json().catch(() => ({}))) as any;
    const items = Array.isArray(body.rates) ? body.rates : [];
    if (!items.length) return json({ ok: true, inserted: 0 }, 200, request, env);
    const stmts = items.map((r: any) =>
        env.DB.prepare(
            "INSERT OR REPLACE INTO rates (date, base, quote, rate, source, fetched_at) " +
            "VALUES (?, ?, ?, ?, ?, datetime('now'))",
        ).bind(r.date, r.base ?? "EUR", r.quote, r.rate, r.source ?? "backfill"),
    );
    const results = await env.DB.batch(stmts);
    const changes = results.reduce((acc, r) => acc + (r.meta.changes ?? 0), 0);
    return json({ ok: true, inserted: changes, attempted: stmts.length }, 200, request, env);
}

async function handleMigrate(request: Request, env: Env): Promise<Response> {
    if (!checkBearer(request, env.SYNC_TOKEN)) return json({ error: "unauthorized" }, 401, request, env);
    const body = (await request.json().catch(() => ({}))) as any;
    const expenses = Array.isArray(body.expenses) ? body.expenses : [];
    const n = await bulkInsertExpenses(env, expenses);
    return json({ ok: true, inserted: n, attempted: expenses.length }, 200, request, env);
}

// ── Auth helpers ───────────────────────────────────────────────────────────
async function authenticateMiniApp(
    request: Request,
    env: Env,
): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
    const initData = request.headers.get("X-Telegram-Init-Data") ?? "";
    const a = await validateInitData(initData, env.TELEGRAM_BOT_TOKEN);
    if (!a.ok || !a.user_id) return { ok: false, response: json({ error: "unauthorized" }, 401, request, env) };
    if (!(await isAuthorizedUser(env, a.user_id))) return { ok: false, response: json({ error: "forbidden" }, 403, request, env) };
    return { ok: true, userId: a.user_id };
}

// SPEC-019: shape-валидация payload через Zod. Парсит тело, safeParse по схеме,
// при ошибке — 400 с человекочитаемым сообщением (без stack-trace). Бизнес-правила
// (FK, кросс-поля) остаются в доменных функциях.
async function readBody<S extends z.ZodTypeAny>(
    request: Request, env: Env, schema: S,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: Response }> {
    const raw = await request.json().catch(() => undefined);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return { ok: false, response: json({ error: zodMessage(parsed.error) }, 400, request, env) };
    return { ok: true, data: parsed.data };
}

// CORS + jsonResponse централизованы в ./cors.ts чтобы избежать расхождений
// между путями /v1/auth/* и остальными endpoints.
const json = jsonRes;
