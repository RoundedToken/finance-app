/**
 * CORS helpers. Один центральный источник правды для всех ответов Worker'а,
 * чтобы избежать расхождений между local jsonResponse в auth-google.ts
 * и основным в index.ts (см. retro arch audit SPEC-004).
 */

import type { Env } from "./types";

export function corsHeaders(request: Request, env: Env): Record<string, string> {
    const origin = request.headers.get("Origin") ?? "";
    const allow = pickAllowedOrigin(origin, env);
    return {
        "Access-Control-Allow-Origin": allow,
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Telegram-Init-Data",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin",
    };
}

/**
 * Для Mini App fallback на "*" остаётся приемлемым (HMAC initData в header — origin
 * не несёт security-нагрузки). Для admin/web origin echo требуется чтобы JWT-сессии
 * корректно работали из браузера через credentials-aware fetches.
 */
function pickAllowedOrigin(origin: string, env: Env): string {
    if (!origin) return "*";
    const raw = env.ADMIN_ALLOWED_ORIGINS ?? "";
    const list = raw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    const lower = origin.toLowerCase();
    if (list.includes(lower)) return origin;
    return "*";
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
            ...corsHeaders(request, env),
        },
    });
}
