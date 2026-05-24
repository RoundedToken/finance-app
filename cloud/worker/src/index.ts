/**
 * finances-worker — D1-centric, no MacBook ground truth.
 * Endpoints:
 *   POST   /tg                       — Telegram webhook (text bot)
 *   GET    /v1/bootstrap              — refs + initial expenses (initData)
 *   GET    /v1/expenses               — list (initData)
 *   POST   /v1/expenses               — create (initData)
 *   PUT    /v1/expenses/:id           — update (initData)
 *   DELETE /v1/expenses/:id           — soft delete (initData)
 *   POST   /v1/admin/references       — push refs from MacBook (bearer)
 *   POST   /v1/admin/migrate-expenses — bulk insert (bearer, миграция)
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

export default {
    /** Cron Trigger handler — ежедневно тянет курсы валют. */
    async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
        try {
            const payload = await fetchLatestRatesEUR();
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
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Telegram-Init-Data",
                    "Access-Control-Max-Age": "86400",
                },
            });
        }

        try {
            if (path === "/healthz") return json({ ok: true });
            if (path === "/tg" && request.method === "POST") return handleTg(request, env);

            if (path === "/v1/bootstrap" && request.method === "GET") return handleBootstrap(request, env);
            if (path === "/v1/expenses" && request.method === "GET") return handleListExpenses(request, env, url);
            if (path === "/v1/expenses" && request.method === "POST") return handleCreateExpense(request, env);

            const m = path.match(/^\/v1\/expenses\/([0-9a-fA-F-]+)$/);
            if (m) {
                if (request.method === "PUT") return handleUpdateExpense(request, env, m[1]);
                if (request.method === "DELETE") return handleDeleteExpense(request, env, m[1]);
            }

            if (path === "/v1/admin/references" && request.method === "POST") return handlePushReferences(request, env);
            if (path === "/v1/admin/migrate-expenses" && request.method === "POST") return handleMigrate(request, env);

            if (path === "/v1/rates" && request.method === "GET") return handleGetRates(request, env);
            if (path === "/v1/admin/refresh-rates" && request.method === "POST") return handleRefreshRates(request, env);

            return json({ error: "not found" }, 404);
        } catch (err) {
            console.error("unhandled", err);
            return json({ error: String(err) }, 500);
        }
    },
};

// ── Telegram bot webhook ───────────────────────────────────────────────────
async function handleTg(request: Request, env: Env): Promise<Response> {
    const body = await request.json().catch(() => null);
    if (!body) return json({ ok: false, reason: "bad json" });
    try {
        await handleTelegramUpdate(body as any, env);
    } catch (e) {
        console.error("bot error", e);
    }
    return json({ ok: true });
}

// ── Bootstrap ──────────────────────────────────────────────────────────────
async function handleBootstrap(request: Request, env: Env): Promise<Response> {
    const auth = await authenticateMiniApp(request, env);
    if (!auth.ok) return auth.response;
    return json(await getBootstrapData(env));
}

// ── List / CRUD expenses ───────────────────────────────────────────────────
async function handleListExpenses(request: Request, env: Env, url: URL): Promise<Response> {
    const auth = await authenticateMiniApp(request, env);
    if (!auth.ok) return auth.response;
    const limit = parseInt(url.searchParams.get("limit") ?? "500", 10);
    const from = url.searchParams.get("from") ?? undefined;
    const rows = await listExpenses(env, { limit, from });
    return json({ expenses: rows });
}

async function handleCreateExpense(request: Request, env: Env): Promise<Response> {
    const auth = await authenticateMiniApp(request, env);
    if (!auth.ok) return auth.response;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return json({ error: "bad json" }, 400);
    const r = await createExpense(env, auth.userId!, body as any);
    return json({ ok: true, ...r });
}

async function handleUpdateExpense(request: Request, env: Env, id: string): Promise<Response> {
    const auth = await authenticateMiniApp(request, env);
    if (!auth.ok) return auth.response;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return json({ error: "bad json" }, 400);
    const r = await updateExpense(env, id, auth.userId!, body);
    return json({ ok: true, ...r });
}

async function handleDeleteExpense(request: Request, env: Env, id: string): Promise<Response> {
    const auth = await authenticateMiniApp(request, env);
    if (!auth.ok) return auth.response;
    const r = await deleteExpense(env, id, auth.userId!);
    return json({ ok: true, ...r });
}

// ── Admin (bearer) ─────────────────────────────────────────────────────────
async function handlePushReferences(request: Request, env: Env): Promise<Response> {
    if (!checkBearer(request, env.SYNC_TOKEN)) return json({ error: "unauthorized" }, 401);
    const body = (await request.json().catch(() => ({}))) as any;
    await replaceReferences(env, body);
    return json({
        ok: true,
        replaced: {
            accounts: body.accounts?.length ?? null,
            categories: body.categories?.length ?? null,
            currencies: body.currencies?.length ?? null,
        },
    });
}

async function handleGetRates(request: Request, env: Env): Promise<Response> {
    const auth = await authenticateMiniApp(request, env);
    if (!auth.ok) return auth.response;
    const data = await getLatestRates(env);
    return json(data);
}

async function handleRefreshRates(request: Request, env: Env): Promise<Response> {
    if (!checkBearer(request, env.SYNC_TOKEN)) return json({ error: "unauthorized" }, 401);
    const payload = await fetchLatestRatesEUR();
    const n = await saveRates(env, payload);
    return json({ ok: true, saved: n, date: payload.date });
}

async function handleMigrate(request: Request, env: Env): Promise<Response> {
    if (!checkBearer(request, env.SYNC_TOKEN)) return json({ error: "unauthorized" }, 401);
    const body = (await request.json().catch(() => ({}))) as any;
    const expenses = Array.isArray(body.expenses) ? body.expenses : [];
    const n = await bulkInsertExpenses(env, expenses);
    return json({ ok: true, inserted: n, attempted: expenses.length });
}

// ── Auth helpers ───────────────────────────────────────────────────────────
async function authenticateMiniApp(
    request: Request,
    env: Env,
): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
    const initData = request.headers.get("X-Telegram-Init-Data") ?? "";
    const a = await validateInitData(initData, env.TELEGRAM_BOT_TOKEN);
    if (!a.ok || !a.user_id) return { ok: false, response: json({ error: "unauthorized" }, 401) };
    if (!(await isAuthorizedUser(env, a.user_id))) return { ok: false, response: json({ error: "forbidden" }, 403) };
    return { ok: true, userId: a.user_id };
}

function json(payload: unknown, status: number = 200): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Telegram-Init-Data",
        },
    });
}
