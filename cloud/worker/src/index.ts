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
} from "./db";
import { handleTelegramUpdate } from "./bot";
import { fetchLatestRatesEUR, saveRates, getLatestRates } from "./rates";
import { handleGoogleStart, handleGoogleCallback, handleAdminMe, requireAdminSession } from "./auth-google";
import { corsHeaders, jsonResponse as jsonRes } from "./cors";
import {
    listSnapshots,
    latestSnapshotPerAccount,
    createSnapshot,
    updateSnapshot,
    deleteSnapshot,
    listBuckets,
} from "./snapshots";

export default {
    /** Cron Trigger — ежедневно тянет курсы. */
    async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
        try {
            const payload = await fetchLatestRatesEUR(env);
            const n = await saveRates(env, payload);
            console.log(`scheduled rates: saved ${n} for date ${payload.date}`);
        } catch (e) {
            console.error("scheduled rates failed:", e);
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
            if (path === "/v1/web/accounts" && request.method === "GET") return handleWebAccounts(request, env);
            if (path === "/v1/web/snapshots" && request.method === "GET") return handleWebSnapshotsList(request, env, url);
            if (path === "/v1/web/snapshots" && request.method === "POST") return handleWebSnapshotsCreate(request, env);
            const snapMatch = path.match(/^\/v1\/web\/snapshots\/([0-9a-fA-F-]+)$/);
            if (snapMatch) {
                if (request.method === "PUT") return handleWebSnapshotsUpdate(request, env, snapMatch[1]);
                if (request.method === "DELETE") return handleWebSnapshotsDelete(request, env, snapMatch[1]);
            }

            // ── System admin (Bearer SYNC_TOKEN) ─────────────────────────────
            if (path === "/v1/admin/references" && request.method === "POST") return handlePushReferences(request, env);
            if (path === "/v1/admin/migrate-expenses" && request.method === "POST") return handleMigrate(request, env);
            if (path === "/v1/admin/refresh-rates" && request.method === "POST") return handleRefreshRates(request, env);
            if (path === "/v1/admin/bulk-rates" && request.method === "POST") return handleBulkRates(request, env);

            return json({ error: "not found" }, 404, request, env);
        } catch (err) {
            console.error("unhandled", err);
            return json({ error: String(err) }, 500, request, env);
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
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return json({ error: "bad json" }, 400, request, env);
    const r = await createExpense(env, auth.userId!, body as any);
    return json({ ok: true, ...r }, 200, request, env);
}

async function handleUpdateExpense(request: Request, env: Env, id: string): Promise<Response> {
    const auth = await authenticateMiniApp(request, env);
    if (!auth.ok) return auth.response;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return json({ error: "bad json" }, 400, request, env);
    const r = await updateExpense(env, id, auth.userId!, body);
    return json({ ok: true, ...r }, 200, request, env);
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
    const bootstrap = await getBootstrapData(env);
    return json({
        accounts: bootstrap.accounts,
        categories: bootstrap.categories,
        currencies: bootstrap.currencies,
        rates: bootstrap.rates,
    }, 200, request, env);
}

async function handleWebAccounts(request: Request, env: Env): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    const [buckets, latest] = await Promise.all([listBuckets(env), latestSnapshotPerAccount(env)]);
    const enriched = buckets.map((b: any) => ({
        ...b,
        latest_snapshot: latest[b.id] ?? null,
    }));
    return json({ accounts: enriched }, 200, request, env);
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
    const body = await request.json<any>().catch(() => null);
    if (!body || typeof body !== "object") return json({ error: "bad json" }, 400, request, env);
    if (!body.date || !body.account_id || typeof body.amount !== "number") {
        return json({ error: "date, account_id, amount are required" }, 400, request, env);
    }
    const r = await createSnapshot(env, body);
    return json({ ok: true, ...r }, 200, request, env);
}

async function handleWebSnapshotsUpdate(request: Request, env: Env, id: string): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    const body = await request.json<any>().catch(() => null);
    if (!body || typeof body !== "object") return json({ error: "bad json" }, 400, request, env);
    const r = await updateSnapshot(env, id, body);
    return json({ ok: true, ...r }, 200, request, env);
}

async function handleWebSnapshotsDelete(request: Request, env: Env, id: string): Promise<Response> {
    const session = await requireAdminSession(request, env);
    if (!session.ok) return session.response;
    const r = await deleteSnapshot(env, id);
    return json({ ok: true, ...r }, 200, request, env);
}

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
    return json({ ok: true, saved: n, date: payload.date }, 200, request, env);
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

// CORS + jsonResponse централизованы в ./cors.ts чтобы избежать расхождений
// между путями /v1/auth/* и остальными endpoints.
const json = jsonRes;
