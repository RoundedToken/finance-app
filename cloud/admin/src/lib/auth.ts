/**
 * JWT session management (ADR-012). Token живёт в localStorage, передаётся как Bearer.
 */

const TOKEN_KEY = "finances.admin.session";

export function getToken(): string | null {
    try {
        return localStorage.getItem(TOKEN_KEY);
    } catch {
        return null;
    }
}

export function setToken(token: string): void {
    try {
        localStorage.setItem(TOKEN_KEY, token);
    } catch (e) {
        console.error("Failed to store session token", e);
    }
}

export function clearToken(): void {
    try {
        localStorage.removeItem(TOKEN_KEY);
    } catch {
        // ignore
    }
}

/** На загрузке: если в URL fragment есть #token=..., вытащить и сохранить. */
export function consumeFragmentToken(): boolean {
    if (typeof window === "undefined" || !window.location.hash) return false;
    const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
    const params = new URLSearchParams(hash);
    const token = params.get("token");
    if (!token) return false;
    setToken(token);
    // Убираем токен из URL чтобы не висел в истории.
    const clean = window.location.pathname + window.location.search;
    window.history.replaceState({}, "", clean);
    return true;
}

export interface JwtClaims {
    sub: string;
    iat: number;
    exp: number;
    iss?: string;
}

export function decodeClaims(token: string): JwtClaims | null {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    try {
        const pad = parts[1].length % 4 === 0 ? 0 : 4 - (parts[1].length % 4);
        const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
        return JSON.parse(atob(b64));
    } catch {
        return null;
    }
}

export function isExpired(token: string | null): boolean {
    if (!token) return true;
    const c = decodeClaims(token);
    if (!c) return true;
    return c.exp * 1000 <= Date.now();
}
