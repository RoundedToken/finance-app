/**
 * Fetch-обёртка с JWT auth и автоматическим logout при 401.
 */

import { getToken, clearToken } from "@/lib/auth";

const API_BASE = import.meta.env.VITE_API_BASE as string | undefined;
if (!API_BASE) {
    throw new Error(
        "VITE_API_BASE не задан. Поставь его в cloud/admin/.env (см. .env.example) перед сборкой.",
    );
}

export class ApiError extends Error {
    constructor(
        message: string,
        public status: number,
        public body?: unknown,
    ) {
        super(message);
        this.name = "ApiError";
    }
}

export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const token = getToken();
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const res = await fetch(`${API_BASE}${path}`, { ...init, headers });

    if (res.status === 401) {
        clearToken();
        if (!path.startsWith("/v1/auth/")) window.location.href = "/login";
        throw new ApiError("unauthorized", 401);
    }

    const text = await res.text();
    const body = text ? safeJson(text) : null;

    if (!res.ok) {
        const msg = (body as any)?.error ?? res.statusText ?? `HTTP ${res.status}`;
        throw new ApiError(String(msg), res.status, body);
    }
    return body as T;
}

function safeJson(s: string): unknown {
    try { return JSON.parse(s); } catch { return s; }
}

export function googleLoginUrl(returnTo: string): string {
    const params = new URLSearchParams({ return_to: returnTo });
    return `${API_BASE}/v1/auth/google/start?${params.toString()}`;
}
