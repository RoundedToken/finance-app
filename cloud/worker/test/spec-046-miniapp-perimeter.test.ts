/**
 * QA-04 (SPEC-046): e2e мутирующего периметра Mini App через worker.fetch.
 * До этого связка auth→Zod→handler→D1 на /v1/expenses проверялась только
 * вручную: guard-матрица покрывала /v1/web/*, а Mini App-периметр — нет.
 *
 * initData подписывается самостоятельно (helpers.makeInitData, фейковый bot
 * token) — оффлайн, реальный Telegram не нужен.
 */
import { describe, it, expect } from "vitest";
import worker from "../src/index";
import { makeEnv, seed } from "./d1-mock";
import { makeInitData, BOT_TOKEN } from "./helpers";

const NOW = () => Math.floor(Date.now() / 1000);

/** Мир: whitelisted user 42, ведро/категория для валидной траты. */
function makeWorld() {
    const { env, d1 } = makeEnv();
    env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
    seed(d1, {
        authorized_users: [{ telegram_id: "42", name: "tester", created_at: "2026-01-01 00:00:00" }],
        accounts: [{ id: "eur-bank", currency: "EUR" }],
        categories: [{ id: "food" }],
        currencies: [{ code: "EUR", name: "Euro" }],
    });
    return { env, d1 };
}

function req(path: string, method: string, initData: string | null, body?: unknown): Request {
    const headers: Record<string, string> = {};
    if (initData != null) headers["X-Telegram-Init-Data"] = initData;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    return new Request(`https://x${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

const EXPENSE = { date: "2026-06-10", amount: 12.5, currency: "EUR", account_id: "eur-bank", category_id: "food", note: "e2e" };

describe("POST /v1/expenses — периметр", () => {
    it("валидный initData + whitelisted user → 200, трата в D1 (created_at ставит сервер)", async () => {
        const { env, d1 } = makeWorld();
        const r = await worker.fetch(req("/v1/expenses", "POST", await makeInitData(NOW()), { id: "e1", ...EXPENSE }), env);
        expect(r.status).toBe(200);
        expect(await r.json()).toEqual({ ok: true, inserted: true });
        const row = d1.db.prepare("SELECT user_id, amount, currency, created_at FROM expenses WHERE id = 'e1'").get() as any;
        expect(row.user_id).toBe("42");
        expect(row.amount).toBe(12.5);
        expect(String(row.created_at)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);   // канон SPEC-024
    });

    it("невалидный hash → 401, запись не создаётся", async () => {
        const { env, d1 } = makeWorld();
        const good = await makeInitData(NOW());
        const bad = good.replace(/hash=[0-9a-f]{10}/, "hash=deadbeefde");
        const r = await worker.fetch(req("/v1/expenses", "POST", bad, { id: "e1", ...EXPENSE }), env);
        expect(r.status).toBe(401);
        expect(d1.db.prepare("SELECT COUNT(*) AS n FROM expenses").get()).toMatchObject({ n: 0 });
    });

    it("без initData вовсе → 401", async () => {
        const { env } = makeWorld();
        const r = await worker.fetch(req("/v1/expenses", "POST", null, { id: "e1", ...EXPENSE }), env);
        expect(r.status).toBe(401);
    });

    it("подписанный, но НЕ whitelisted user → 403 (ADR-009), запись не создаётся", async () => {
        const { env, d1 } = makeWorld();
        const r = await worker.fetch(req("/v1/expenses", "POST", await makeInitData(NOW(), 999), { id: "e1", ...EXPENSE }), env);
        expect(r.status).toBe(403);
        expect(d1.db.prepare("SELECT COUNT(*) AS n FROM expenses").get()).toMatchObject({ n: 0 });
    });

    it("Zod-ошибка (amount: -5) → 400 с zodMessage, wiring auth→Zod жив", async () => {
        const { env } = makeWorld();
        const r = await worker.fetch(req("/v1/expenses", "POST", await makeInitData(NOW()), { id: "e1", ...EXPENSE, amount: -5 }), env);
        expect(r.status).toBe(400);
        const j = await r.json() as { error: string };
        expect(j.error).toContain("amount");                    // путь поля из zodMessage
        expect(j.error).toContain("amount must be positive");   // текст схемы (SPEC-019)
    });
});

describe("PUT/DELETE /v1/expenses/:id — периметр", () => {
    /** UUID-форма — роут матчится по [0-9a-fA-F-]+. */
    const ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeffff";

    async function withExpense(env: any) {
        const r = await worker.fetch(req("/v1/expenses", "POST", await makeInitData(NOW()), { id: ID, ...EXPENSE }), env);
        expect(r.status).toBe(200);
    }

    it("PUT: валидный initData → 200 и правка; битый hash → 401; чужой user → 403", async () => {
        const { env, d1 } = makeWorld();
        await withExpense(env);

        const ok = await worker.fetch(req(`/v1/expenses/${ID}`, "PUT", await makeInitData(NOW()), { note: "edited" }), env);
        expect(ok.status).toBe(200);
        expect(await ok.json()).toEqual({ ok: true, updated: true });
        expect(d1.db.prepare(`SELECT note FROM expenses WHERE id = '${ID}'`).get()).toMatchObject({ note: "edited" });

        const good = await makeInitData(NOW());
        const bad = good.replace(/hash=[0-9a-f]{10}/, "hash=deadbeefde");
        expect((await worker.fetch(req(`/v1/expenses/${ID}`, "PUT", bad, { note: "x" }), env)).status).toBe(401);
        expect((await worker.fetch(req(`/v1/expenses/${ID}`, "PUT", await makeInitData(NOW(), 999), { note: "x" }), env)).status).toBe(403);
        // чужие попытки не прошли — note не изменился
        expect(d1.db.prepare(`SELECT note FROM expenses WHERE id = '${ID}'`).get()).toMatchObject({ note: "edited" });
    });

    it("PUT: Zod-ошибка (amount: -5) → 400 с zodMessage", async () => {
        const { env } = makeWorld();
        await withExpense(env);
        const r = await worker.fetch(req(`/v1/expenses/${ID}`, "PUT", await makeInitData(NOW()), { amount: -5 }), env);
        expect(r.status).toBe(400);
        expect(((await r.json()) as { error: string }).error).toContain("amount must be positive");
    });

    it("DELETE: битый hash → 401, чужой user → 403, валидный → 200 soft-delete", async () => {
        const { env, d1 } = makeWorld();
        await withExpense(env);

        const good = await makeInitData(NOW());
        const bad = good.replace(/hash=[0-9a-f]{10}/, "hash=deadbeefde");
        expect((await worker.fetch(req(`/v1/expenses/${ID}`, "DELETE", bad), env)).status).toBe(401);
        expect((await worker.fetch(req(`/v1/expenses/${ID}`, "DELETE", await makeInitData(NOW(), 999)), env)).status).toBe(403);
        expect(d1.db.prepare(`SELECT deleted_at FROM expenses WHERE id = '${ID}'`).get()).toMatchObject({ deleted_at: null });

        const ok = await worker.fetch(req(`/v1/expenses/${ID}`, "DELETE", await makeInitData(NOW())), env);
        expect(ok.status).toBe(200);
        expect(await ok.json()).toEqual({ ok: true, deleted: true });
        const row = d1.db.prepare(`SELECT deleted_at FROM expenses WHERE id = '${ID}'`).get() as any;
        expect(row.deleted_at).not.toBeNull();   // soft-delete, не hard
    });
});
