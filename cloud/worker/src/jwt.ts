/**
 * Минимальный JWT HS256 без зависимостей. Web Crypto API.
 * Используется только для сессий Web Admin (ADR-012).
 */
import { timingSafeEqualStr } from "./auth";

export interface JwtPayload {
    sub: string;       // email
    iat: number;       // unix seconds
    exp: number;       // unix seconds
    iss?: string;
}

const HEADER = { alg: "HS256", typ: "JWT" };
const ISS = "finances-worker";

export async function signJwt(payload: Omit<JwtPayload, "iat" | "exp" | "iss">, secret: string, ttlSeconds: number): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const full: JwtPayload = { ...payload, iat: now, exp: now + ttlSeconds, iss: ISS };
    const head = b64urlEncode(new TextEncoder().encode(JSON.stringify(HEADER)));
    const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(full)));
    const data = `${head}.${body}`;
    const sig = await hmacSign(secret, data);
    return `${data}.${sig}`;
}

export interface JwtVerifyResult {
    ok: boolean;
    payload?: JwtPayload;
    reason?: string;
}

export async function verifyJwt(token: string, secret: string): Promise<JwtVerifyResult> {
    if (!token) return { ok: false, reason: "empty" };
    const parts = token.split(".");
    if (parts.length !== 3) return { ok: false, reason: "bad shape" };
    const [head, body, sig] = parts;
    const expected = await hmacSign(secret, `${head}.${body}`);
    if (!timingSafeEqualStr(expected, sig)) return { ok: false, reason: "bad signature" };   // SEC-07
    let payload: JwtPayload;
    try {
        payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
    } catch {
        return { ok: false, reason: "bad payload" };
    }
    if (payload.iss !== ISS) return { ok: false, reason: "bad iss" };
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now) return { ok: false, reason: "expired" };
    if (!payload.sub) return { ok: false, reason: "no sub" };
    return { ok: true, payload };
}

async function hmacSign(secret: string, data: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
    return b64urlEncode(new Uint8Array(sig));
}

function b64urlEncode(buf: Uint8Array): string {
    let bin = "";
    for (const b of buf) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
    const pad = s.length % 4 === 0 ? 0 : 4 - (s.length % 4);
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

export function randomState(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return b64urlEncode(bytes);
}
