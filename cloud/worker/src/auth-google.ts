/**
 * Google OAuth 2.0 flow для Web Admin (ADR-012).
 *
 * Поток:
 *   1. SPA → GET /v1/auth/google/start?return_to=<spa-url>
 *      Worker ставит state-cookie, редиректит на Google consent screen.
 *   2. Google → GET /v1/auth/google/callback?code=...&state=...
 *      Worker проверяет state, exchange code → id_token, проверяет email в allowlist,
 *      выдаёт JWT, редиректит на <return_to>#token=<jwt>.
 *   3. SPA достаёт token из URL fragment, складывает в localStorage.
 */

import type { Env } from "./types";
import { randomState, signJwt, verifyJwt } from "./jwt";
import { jsonResponse } from "./cors";

// SEC-08 (волна 2 аудита): 30 дней в localStorage без отзыва — слишком широкое окно
// для украденного XSS'ом токена. 72ч + автопродление активной сессии через
// /v1/web/session/refresh (клиент дергает при exp < TTL/2) — активный пользователь
// не разлогинивается, украденный токен умирает максимум за 72ч. Пересмотр ADR-012.
export const SESSION_TTL_SECONDS = 60 * 60 * 72;        // 72 часа
const STATE_TTL_SECONDS = 600;                          // 10 минут на сам OAuth flow
const STATE_COOKIE = "google_oauth_state";
const RETURN_COOKIE = "google_oauth_return";
const SCOPES = "openid email";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export async function handleGoogleStart(request: Request, env: Env): Promise<Response> {
    if (!env.GOOGLE_CLIENT_ID) return text("GOOGLE_CLIENT_ID not configured", 500);
    if (!env.GOOGLE_REDIRECT_URI) return text("GOOGLE_REDIRECT_URI not configured", 500);

    const url = new URL(request.url);
    const returnTo = url.searchParams.get("return_to") ?? "";
    if (!isAllowedReturnTo(returnTo, env)) return text("invalid return_to", 400);

    const state = randomState();
    const authUrl = new URL(GOOGLE_AUTH_URL);
    authUrl.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", env.GOOGLE_REDIRECT_URI);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", SCOPES);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("access_type", "online");
    authUrl.searchParams.set("prompt", "select_account");

    const headers = new Headers({ Location: authUrl.toString() });
    headers.append("Set-Cookie", cookie(STATE_COOKIE, state, STATE_TTL_SECONDS));
    headers.append("Set-Cookie", cookie(RETURN_COOKIE, returnTo, STATE_TTL_SECONDS));
    return new Response(null, { status: 302, headers });
}

export async function handleGoogleCallback(request: Request, env: Env): Promise<Response> {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
        return text("Google OAuth not configured", 500);
    }
    if (!env.ADMIN_JWT_SECRET) return text("ADMIN_JWT_SECRET not configured", 500);

    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) return text("missing code/state", 400);

    const cookies = parseCookies(request.headers.get("Cookie") ?? "");
    const expectedState = cookies[STATE_COOKIE];
    if (!expectedState || expectedState !== state) return text("bad state", 400);
    const returnTo = cookies[RETURN_COOKIE] || env.ADMIN_DEFAULT_RETURN_URL || "";
    if (!isAllowedReturnTo(returnTo, env)) return text("invalid return_to (cookie)", 400);

    // Exchange code → tokens.
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            code,
            client_id: env.GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET,
            redirect_uri: env.GOOGLE_REDIRECT_URI,
            grant_type: "authorization_code",
        }).toString(),
    });
    if (!tokenRes.ok) {
        const t = await tokenRes.text().catch(() => "");
        console.error("google token exchange failed", tokenRes.status, t);
        return text(`token exchange failed: ${tokenRes.status}`, 502);
    }
    const tokenData = await tokenRes.json<{ id_token?: string }>();
    if (!tokenData.id_token) return text("no id_token in response", 502);

    const claims = decodeIdToken(tokenData.id_token);
    if (!claims) return text("bad id_token", 502);
    if (claims.aud !== env.GOOGLE_CLIENT_ID) return text("aud mismatch", 401);
    // Fail-closed: принимаем только явный true. Если поле отсутствует — отклоняем.
    // Google в текущей версии всегда возвращает email_verified, но не полагаемся на это.
    if (claims.email_verified !== true) return text("email not verified", 403);
    if (!claims.email) return text("no email in id_token", 403);

    const email = String(claims.email).toLowerCase();
    if (!isAllowedEmail(email, env)) {
        console.warn("admin login denied for email", email);
        return text("forbidden", 403);
    }

    const token = await signJwt({ sub: email }, env.ADMIN_JWT_SECRET, SESSION_TTL_SECONDS);

    // Чистим state-cookies + редиректим с fragment-токеном.
    const redirect = appendFragment(returnTo, `token=${encodeURIComponent(token)}`);
    const headers = new Headers({ Location: redirect });
    headers.append("Set-Cookie", clearCookie(STATE_COOKIE));
    headers.append("Set-Cookie", clearCookie(RETURN_COOKIE));
    return new Response(null, { status: 302, headers });
}

// SPEC-039: handleAdminMe удалён — /v1/web/me заинлайнен в единый префикс-guard
// роутера (index.ts), который и так держит проверенную сессию (session.email).

/** Middleware-style helper. Возвращает либо успех с email, либо готовый 401-Response. */
export async function requireAdminSession(
    request: Request,
    env: Env,
): Promise<{ ok: true; email: string } | { ok: false; response: Response }> {
    if (!env.ADMIN_JWT_SECRET) {
        return { ok: false, response: jsonResponse({ error: "server misconfigured" }, 500, request, env) };
    }
    const auth = request.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return { ok: false, response: jsonResponse({ error: "unauthorized" }, 401, request, env) };
    const token = auth.slice(7);
    const v = await verifyJwt(token, env.ADMIN_JWT_SECRET);
    if (!v.ok || !v.payload) return { ok: false, response: jsonResponse({ error: "unauthorized", reason: v.reason }, 401, request, env) };
    const email = v.payload.sub.toLowerCase();
    if (!isAllowedEmail(email, env)) return { ok: false, response: jsonResponse({ error: "forbidden" }, 403, request, env) };
    return { ok: true, email };
}

function isAllowedEmail(email: string, env: Env): boolean {
    const raw = env.ADMIN_ALLOWED_EMAILS ?? "";
    const list = raw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    return list.includes(email);
}

function isAllowedReturnTo(returnTo: string, env: Env): boolean {
    if (!returnTo) return false;
    let url: URL;
    try { url = new URL(returnTo); } catch { return false; }
    if (url.protocol !== "https:") return false;
    const raw = env.ADMIN_ALLOWED_ORIGINS ?? "";
    const list = raw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    return list.includes(url.origin.toLowerCase());
}

function decodeIdToken(idToken: string): Record<string, any> | null {
    const parts = idToken.split(".");
    if (parts.length !== 3) return null;
    try {
        const pad = parts[1].length % 4 === 0 ? 0 : 4 - (parts[1].length % 4);
        const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
        return JSON.parse(atob(b64));
    } catch {
        return null;
    }
}

function appendFragment(url: string, fragment: string): string {
    const sep = url.includes("#") ? "&" : "#";
    return `${url}${sep}${fragment}`;
}

function cookie(name: string, value: string, maxAge: number): string {
    return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function clearCookie(name: string): string {
    return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function parseCookies(header: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const part of header.split(";")) {
        const i = part.indexOf("=");
        if (i === -1) continue;
        const k = part.slice(0, i).trim();
        const v = part.slice(i + 1).trim();
        if (k) out[k] = v;
    }
    return out;
}

function text(s: string, status = 200): Response {
    return new Response(s, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
