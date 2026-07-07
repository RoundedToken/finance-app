/**
 * SPEC-045 — волна 2 аудита, кластер 5 (auth-hardening):
 *  SEC-06  initData freshness (auth_date TTL 24ч)
 *  SEC-07  timing-safe сравнения (helper + отсутствие регрессий verify)
 *  SEC-08  session refresh endpoint (72ч TTL)
 */
import { describe, it, expect } from "vitest";
import worker from "../src/index";
import { validateInitData, timingSafeEqualStr } from "../src/auth";
import { signJwt, verifyJwt } from "../src/jwt";
import { makeEnv } from "./d1-mock";
// QA-04 (SPEC-046): makeInitData вынесен в helpers.ts — переиспользуется e2e-периметром.
import { makeInitData, BOT_TOKEN } from "./helpers";

describe("SEC-06 — initData freshness", () => {
    it("свежий auth_date → ok; старше 24ч → expired", async () => {
        const now = Math.floor(Date.now() / 1000);
        const fresh = await validateInitData(await makeInitData(now - 60), BOT_TOKEN);
        expect(fresh.ok).toBe(true);
        expect(fresh.user_id).toBe("42");

        const stale = await validateInitData(await makeInitData(now - 25 * 3600), BOT_TOKEN);
        expect(stale.ok).toBe(false);
        expect(stale.reason).toContain("expired");
    });

    it("auth_date = 0 (подписанный, но фейковый) → reject", async () => {
        const r = await validateInitData(await makeInitData(0), BOT_TOKEN);
        expect(r.ok).toBe(false);
    });

    it("подпись по-прежнему проверяется (битый hash → reject)", async () => {
        const now = Math.floor(Date.now() / 1000);
        const good = await makeInitData(now);
        const bad = good.replace(/hash=[0-9a-f]{10}/, "hash=deadbeefde");
        expect((await validateInitData(bad, BOT_TOKEN)).ok).toBe(false);
    });
});

describe("SEC-07 — timing-safe сравнение", () => {
    it("равные/неравные/разной длины", () => {
        expect(timingSafeEqualStr("abc", "abc")).toBe(true);
        expect(timingSafeEqualStr("abc", "abd")).toBe(false);
        expect(timingSafeEqualStr("abc", "abcd")).toBe(false);
        expect(timingSafeEqualStr("", "")).toBe(true);
    });

    it("verifyJwt не регрессировал (валидный/битый sig)", async () => {
        const t = await signJwt({ sub: "a@b.c" }, "s3cret", 3600);
        expect((await verifyJwt(t, "s3cret")).ok).toBe(true);
        expect((await verifyJwt(t + "x", "s3cret")).ok).toBe(false);
        expect((await verifyJwt(t, "other")).ok).toBe(false);
    });
});

describe("SEC-08 — session refresh", () => {
    it("POST /v1/web/session/refresh с валидным JWT → свежий токен (72ч), без — 401", async () => {
        const { env } = makeEnv();
        env.ADMIN_JWT_SECRET = "admin-secret";
        env.ADMIN_ALLOWED_EMAILS = "owner@example.com";
        const token = await signJwt({ sub: "owner@example.com" }, "admin-secret", 3600);

        const ok = await worker.fetch(new Request("https://x/v1/web/session/refresh", { method: "POST", headers: { Authorization: `Bearer ${token}` } }), env);
        expect(ok.status).toBe(200);
        const j = await ok.json() as { ok: boolean; token: string; ttl_seconds: number };
        expect(j.ttl_seconds).toBe(72 * 3600);
        expect((await verifyJwt(j.token, "admin-secret")).ok).toBe(true);

        const no = await worker.fetch(new Request("https://x/v1/web/session/refresh", { method: "POST" }), env);
        expect(no.status).toBe(401);
    });

    it("absolute cap: цепочка refresh'ей старше 30 дней от исходного входа → 401", async () => {
        const { env } = makeEnv();
        env.ADMIN_JWT_SECRET = "admin-secret";
        env.ADMIN_ALLOWED_EMAILS = "owner@example.com";
        const oldAuthTime = Math.floor(Date.now() / 1000) - 31 * 24 * 3600;
        const token = await signJwt({ sub: "owner@example.com", auth_time: oldAuthTime }, "admin-secret", 3600);
        const r = await worker.fetch(new Request("https://x/v1/web/session/refresh", { method: "POST", headers: { Authorization: `Bearer ${token}` } }), env);
        expect(r.status).toBe(401);
        // при этом обычные /v1/web/* с этим токеном ещё работают (истечёт сам через exp)
        const me = await worker.fetch(new Request("https://x/v1/web/me", { headers: { Authorization: `Bearer ${token}` } }), env);
        expect(me.status).toBe(200);
    });
});
