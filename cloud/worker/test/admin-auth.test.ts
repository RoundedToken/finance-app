/**
 * SPEC-039 — admin auth invariant: единый guard на префиксе /v1/web/*.
 * Через worker.fetch: проверяем матрицу auth-кодов + что ВСЕ /v1/web/* (включая
 * неизвестные пути) защищены, а другие каналы (SYNC_TOKEN, initData) не задеты.
 */
import { describe, it, expect } from "vitest";
import worker from "../src/index";
import { signJwt } from "../src/jwt";
import { makeEnv } from "./d1-mock";

const SECRET = "test-admin-secret";
const EMAIL = "owner@example.com";

function adminEnv() {
    const { env } = makeEnv();
    env.ADMIN_JWT_SECRET = SECRET;
    env.ADMIN_ALLOWED_EMAILS = EMAIL;
    env.SYNC_TOKEN = "sync-tok";
    return env;
}
const get = (path: string, token?: string) =>
    new Request(`https://x${path}`, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
const method = (path: string, m: string, token?: string) =>
    new Request(`https://x${path}`, { method: m, headers: token ? { Authorization: `Bearer ${token}` } : {} });

describe("admin auth invariant (SPEC-039)", () => {
    it("/v1/web/* без Bearer → 401 (AC2)", async () => {
        const env = adminEnv();
        for (const p of ["/v1/web/me", "/v1/web/expenses", "/v1/web/accounts", "/v1/web/dashboard", "/v1/web/goals", "/v1/web/budgets"]) {
            const r = await worker.fetch(get(p), env);
            expect(r.status, p).toBe(401);
        }
    });

    it("битый Bearer → 401 (AC2)", async () => {
        const r = await worker.fetch(get("/v1/web/me", "not-a-jwt"), adminEnv());
        expect(r.status).toBe(401);
    });

    it("валидный JWT (allowlist) → /v1/web/me 200 {ok,email} (AC3)", async () => {
        const env = adminEnv();
        const token = await signJwt({ sub: EMAIL }, SECRET, 3600);
        const r = await worker.fetch(get("/v1/web/me", token), env);
        expect(r.status).toBe(200);
        const j = await r.json() as { ok: boolean; email: string };
        expect(j.ok).toBe(true);
        expect(j.email).toBe(EMAIL);
    });

    it("валидный JWT проходит guard на /v1/web/expenses → не 401 (AC4)", async () => {
        const env = adminEnv();
        const token = await signJwt({ sub: EMAIL }, SECRET, 3600);
        const r = await worker.fetch(get("/v1/web/expenses", token), env);
        expect(r.status).toBe(200);   // guard пройден, handler отдал {expenses:[]}
    });

    it("не-allowlist email в валидном JWT → 403 (AC5)", async () => {
        const env = adminEnv();
        const token = await signJwt({ sub: "intruder@evil.com" }, SECRET, 3600);
        const r = await worker.fetch(get("/v1/web/me", token), env);
        expect(r.status).toBe(403);
    });

    it("ADMIN_JWT_SECRET не задан → 500 (misconfig, §6)", async () => {
        const { env } = makeEnv();   // без ADMIN_JWT_SECRET
        const r = await worker.fetch(get("/v1/web/me"), env);
        expect(r.status).toBe(500);
    });

    it("валидная сессия + неизвестный /v1/web/* путь → 404 ПОСЛЕ auth (E2)", async () => {
        const env = adminEnv();
        const token = await signJwt({ sub: EMAIL }, SECRET, 3600);
        const r = await worker.fetch(get("/v1/web/totally-unknown", token), env);
        expect(r.status).toBe(404);   // guard пройден, маршрут не найден → 404 (не раскрываем пути до auth)
    });

    it("мутирующие /v1/web/* (POST/PUT/DELETE) без Bearer → 401", async () => {
        const env = adminEnv();
        for (const [p, m] of [["/v1/web/budgets", "POST"], ["/v1/web/snapshots/abc", "PUT"], ["/v1/web/incomes/abc", "DELETE"]] as const) {
            const r = await worker.fetch(method(p, m), env);
            expect(r.status, `${m} ${p}`).toBe(401);
        }
    });

    it("инвариант: неизвестный /v1/web/* путь без Bearer → 401, НЕ 404 (R1/E1)", async () => {
        const r = await worker.fetch(get("/v1/web/totally-new-endpoint"), adminEnv());
        expect(r.status).toBe(401);   // guard на префиксе ловит даже несуществующий путь
    });

    it("регресс: /v1/admin/* (SYNC_TOKEN) не задет — 401 без токена (AC7)", async () => {
        const r = await worker.fetch(method("/v1/admin/bulk-rates", "POST"), adminEnv());
        expect(r.status).toBe(401);
    });

    it("регресс: /v1/bootstrap (initData) не задет admin-guard'ом — 401 без initData (AC7)", async () => {
        const r = await worker.fetch(get("/v1/bootstrap"), adminEnv());
        expect(r.status).toBe(401);
    });

    it("публичный /healthz не требует auth", async () => {
        const r = await worker.fetch(get("/healthz"), adminEnv());
        expect(r.status).toBe(200);
    });
});
