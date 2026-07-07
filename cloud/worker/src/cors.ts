/**
 * CORS helpers. Один центральный источник правды для всех ответов Worker'а,
 * чтобы избежать расхождений между local jsonResponse в auth-google.ts
 * и основным в index.ts (см. retro arch audit SPEC-004).
 */

import type { Env } from "./types";

export function corsHeaders(request: Request, env: Env): Record<string, string> {
    const origin = request.headers.get("Origin") ?? "";
    const allow = pickAllowedOrigin(origin, env);
    const headers: Record<string, string> = {
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Telegram-Init-Data",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin",
    };
    // SEC-12 (SPEC-047): allow == null → заголовок ACAO не ставим вовсе (deny).
    if (allow) headers["Access-Control-Allow-Origin"] = allow;
    return headers;
}

/**
 * SEC-12 (SPEC-047): браузерные origin — только из allowlist (echo), неизвестные —
 * deny (без ACAO-заголовка), раньше был wildcard "*". Auth токен-ориентированный
 * (Bearer/initData), поэтому "*" не был дырой, но deny — гигиеничнее.
 *
 * ⚠ Деплой-предусловие: ADMIN_ALLOWED_ORIGINS теперь обязан содержать и origin
 * Mini App Pages (не только Admin) — иначе fetch Mini App не пройдёт CORS.
 * Запросы БЕЗ Origin (curl, cron, Telegram webhook) в CORS не участвуют — null.
 */
function pickAllowedOrigin(origin: string, env: Env): string | null {
    if (!origin) return null;
    const raw = env.ADMIN_ALLOWED_ORIGINS ?? "";
    const list = raw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    const lower = origin.toLowerCase();
    if (list.includes(lower)) return origin;
    return null;
}

export function jsonResponse(
    payload: unknown,
    status: number,
    request: Request,
    env: Env,
): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: {
            "Content-Type": "application/json",
            // SEC-12 (SPEC-047): JSON никогда не должен сниффиться как HTML.
            "X-Content-Type-Options": "nosniff",
            ...corsHeaders(request, env),
        },
    });
}
