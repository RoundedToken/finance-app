import { initData } from "@/lib/telegram";

// Тот же Worker, что и у админки. Hardcode допустим: URL виден в Network у
// любого пользователя, security-нагрузки не несёт (см. docs/security.md §82).
const WORKER_BASE = "https://finances-worker.<owner>.workers.dev";

export async function api<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
    const headers = new Headers(opts.headers);
    headers.set("Accept", "application/json");
    if (opts.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const d = initData();
    if (d) headers.set("X-Telegram-Init-Data", d);

    const r = await fetch(WORKER_BASE + path, { ...opts, headers });
    const text = await r.text();
    const body = text ? safeJson(text) : null;
    if (!r.ok) {
        const msg = (body as { error?: string } | null)?.error ?? `HTTP ${r.status}`;
        throw new Error(String(msg));
    }
    return body as T;
}

function safeJson(s: string): unknown {
    try { return JSON.parse(s); } catch { return s; }
}
