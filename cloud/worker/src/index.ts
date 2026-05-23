/**
 * finances-worker — entry point.
 *
 * Routes:
 *   POST /tg                       — Telegram webhook (text bot for Stage 1)
 *   POST /v1/expenses              — Mini App пишет трату (initData auth)
 *   GET  /v1/sync                  — MacBook забирает новое (bearer auth)
 *   POST /v1/sync/confirm          — MacBook подтверждает (bearer auth)
 *   POST /v1/admin/references      — MacBook пушит справочники (bearer auth)
 *   GET  /v1/bootstrap             — Mini App грузит справочники (initData auth)
 *   GET  /healthz                  — public
 *
 * Cron (configured in wrangler.toml):
 *   "0 3 * * *"  — daily cleanup of confirmed expenses older than 7 days
 */

import type { Env } from "./types";
import { validateInitData, checkBearer } from "./auth";
import {
    isAuthorizedUser,
    insertExpense,
    fetchExpensesSince,
    confirmExpenses,
    cleanupConfirmed,
    getBootstrapData,
} from "./db";
import { handleTelegramUpdate } from "./bot";

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        const path = url.pathname;

        try {
            if (path === "/healthz") return json({ ok: true });
            if (path === "/tg" && request.method === "POST") return handleTelegramWebhook(request, env);
            if (path === "/v1/expenses" && request.method === "POST") return handlePostExpense(request, env);
            if (path === "/v1/sync" && request.method === "GET") return handleSync(request, env, url);
            if (path === "/v1/sync/confirm" && request.method === "POST") return handleConfirm(request, env);
            if (path === "/v1/admin/references" && request.method === "POST") return handlePushReferences(request, env);
            if (path === "/v1/bootstrap" && request.method === "GET") return handleBootstrap(request, env);

            return json({ error: "not found" }, 404);
        } catch (err) {
            console.error("unhandled", err);
            return json({ error: String(err) }, 500);
        }
    },

    async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
        const removed = await cleanupConfirmed(env, 7);
        console.log(`cron cleanup: removed ${removed} confirmed records`);
    },
};

// ────────────────────────────────────────────────────────────────────────────
// Handlers
// ────────────────────────────────────────────────────────────────────────────

async function handleTelegramWebhook(request: Request, env: Env): Promise<Response> {
    const body = await request.json().catch(() => null);
    if (!body) return json({ ok: false, reason: "bad json" });
    try {
        await handleTelegramUpdate(body as any, env);
    } catch (e) {
        console.error("bot error", e);
    }
    // Telegram считает webhook успешным только при 200 OK.
    return json({ ok: true });
}

async function handlePostExpense(request: Request, env: Env): Promise<Response> {
    const initData = request.headers.get("X-Telegram-Init-Data") ?? "";
    const auth = await validateInitData(initData, env.TELEGRAM_BOT_TOKEN);
    if (!auth.ok || !auth.user_id) {
        return json({ error: "unauthorized", reason: auth.reason }, 401);
    }
    if (!(await isAuthorizedUser(env, auth.user_id))) {
        return json({ error: "user not in whitelist" }, 403);
    }
    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload !== "object") {
        return json({ error: "bad json" }, 400);
    }
    // TODO: schema validation
    const { inserted } = await insertExpense(env, auth.user_id, payload as any);
    return json({ ok: true, inserted });
}

async function handleSync(request: Request, env: Env, url: URL): Promise<Response> {
    if (!checkBearer(request, env.SYNC_TOKEN)) return json({ error: "unauthorized" }, 401);
    const since = url.searchParams.get("since") ?? "1970-01-01T00:00:00Z";
    const expenses = await fetchExpensesSince(env, since, 500);
    const has_more = expenses.length === 500;
    const next_since = expenses.length > 0 ? expenses[expenses.length - 1].created_at : since;
    return json({ expenses, next_since, has_more });
}

async function handleConfirm(request: Request, env: Env): Promise<Response> {
    if (!checkBearer(request, env.SYNC_TOKEN)) return json({ error: "unauthorized" }, 401);
    const body = (await request.json().catch(() => ({}))) as { ids?: string[] };
    const ids = Array.isArray(body.ids) ? body.ids : [];
    const confirmed = await confirmExpenses(env, ids);
    return json({ ok: true, confirmed });
}

async function handlePushReferences(request: Request, env: Env): Promise<Response> {
    if (!checkBearer(request, env.SYNC_TOKEN)) return json({ error: "unauthorized" }, 401);
    // TODO: реализация в Этапе 2
    return json({ ok: true, todo: "implement push of accounts/categories/currencies" });
}

async function handleBootstrap(request: Request, env: Env): Promise<Response> {
    const initData = request.headers.get("X-Telegram-Init-Data") ?? "";
    const auth = await validateInitData(initData, env.TELEGRAM_BOT_TOKEN);
    if (!auth.ok || !auth.user_id) return json({ error: "unauthorized" }, 401);
    if (!(await isAuthorizedUser(env, auth.user_id))) return json({ error: "forbidden" }, 403);
    const data = await getBootstrapData(env);
    return json(data);
}

// ────────────────────────────────────────────────────────────────────────────
function json(payload: unknown, status: number = 200): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
    });
}
