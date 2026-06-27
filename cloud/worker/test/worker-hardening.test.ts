/**
 * SPEC-038 — worker hardening: parseLimit, bulk-rates cap/skip, budget limit cap,
 * bootstrap rates-dedup (loadRatesIndex 1× вместо 3×).
 */
import { describe, it, expect } from "vitest";
import worker, { parseLimit, MAX_BULK_RATES } from "../src/index";
import { getBootstrapData } from "../src/db";
import { budgetCreateSchema, budgetUpdateSchema } from "../src/schemas";
import { makeEnv } from "./d1-mock";

const RATES_SCAN_SQL = "SELECT date, quote, rate FROM rates WHERE base = 'EUR'";

describe("parseLimit (AC1)", () => {
    it("NaN/мусор → дефолт", () => {
        expect(parseLimit("abc", 500, 20000)).toBe(500);
        expect(parseLimit("", 500, 20000)).toBe(500);
        expect(parseLimit(null, 500, 20000)).toBe(500);
    });
    it("≤0 → дефолт", () => {
        expect(parseLimit("-1", 1000, 20000)).toBe(1000);
        expect(parseLimit("0", 1000, 20000)).toBe(1000);
    });
    it("слишком большой → клампится к max", () => {
        expect(parseLimit("99999999", 500, 20000)).toBe(20000);
    });
    it("валидный → сам себя (floor)", () => {
        expect(parseLimit("250", 500, 20000)).toBe(250);
        expect(parseLimit("250.7", 500, 20000)).toBe(250);
    });
});

describe("budget limit_eur cap (AC4)", () => {
    it("разумный лимит проходит", () => {
        expect(budgetCreateSchema.safeParse({ category_id: "food", limit_eur: 500 }).success).toBe(true);
        expect(budgetUpdateSchema.safeParse({ limit_eur: 1_000_000 }).success).toBe(true);
    });
    it("fat-finger (лишние нули) отвергается", () => {
        expect(budgetCreateSchema.safeParse({ category_id: "food", limit_eur: 300_000_000 }).success).toBe(false);
        expect(budgetUpdateSchema.safeParse({ limit_eur: 2_000_000 }).success).toBe(false);
    });
    it("неположительный отвергается", () => {
        expect(budgetUpdateSchema.safeParse({ limit_eur: -5 }).success).toBe(false);
        expect(budgetUpdateSchema.safeParse({ limit_eur: 0 }).success).toBe(false);
    });
});

describe("bulk-rates cap + skip (AC3)", () => {
    const mkEnv = () => { const { env } = makeEnv(); env.SYNC_TOKEN = "tok"; return env; };
    const req = (rates: unknown) =>
        new Request("https://x/v1/admin/bulk-rates", {
            method: "POST",
            headers: { Authorization: "Bearer tok", "content-type": "application/json" },
            body: JSON.stringify({ rates }),
        });

    it("payload > MAX_BULK_RATES → 400", async () => {
        const env = mkEnv();
        const tooMany = Array.from({ length: MAX_BULK_RATES + 1 }, () => ({ date: "2025-01-01", quote: "USD", rate: 1.1 }));
        const r = await worker.fetch(req(tooMany), env);
        expect(r.status).toBe(400);
    });

    it("невалидные элементы пропускаются, валидные вставляются", async () => {
        const env = mkEnv();
        const mixed = [
            { date: "2025-01-01", quote: "USD", rate: 1.1 },   // ok
            { date: "2025-01-01", quote: "", rate: 1 },        // пустой quote
            { quote: "RUB", rate: 90 },                        // нет date
            { date: "2025-01-02", quote: "RUB", rate: "x" },   // нерациональный rate
            { date: "2025-01-02", quote: "RSD", rate: -5 },    // rate ≤ 0
            { date: "not-a-date", quote: "TRY", rate: 30 },    // мусорный формат date
        ];
        const r = await worker.fetch(req(mixed), env);
        expect(r.status).toBe(200);
        const j = await r.json() as { inserted: number; attempted: number; skipped: number };
        expect(j.attempted).toBe(1);
        expect(j.skipped).toBe(5);
        expect(j.inserted).toBe(1);
    });

    it("неверный токен → 401", async () => {
        const env = mkEnv();
        const bad = new Request("https://x/v1/admin/bulk-rates", {
            method: "POST", headers: { Authorization: "Bearer nope" }, body: JSON.stringify({ rates: [] }),
        });
        const r = await worker.fetch(bad, env);
        expect(r.status).toBe(401);
    });
});

describe("bootstrap rates-dedup (AC5/AC7)", () => {
    it("getBootstrapData грузит RatesIndex ровно 1× (было 3×)", async () => {
        const { env, d1 } = makeEnv();
        let scans = 0;
        const orig = d1.prepare.bind(d1);
        (env.DB as { prepare: (sql: string) => unknown }).prepare = (sql: string) => {
            if (sql === RATES_SCAN_SQL) scans++;
            return orig(sql);
        };
        await getBootstrapData(env);
        expect(scans).toBe(1);
    });

    it("references (без трат/бюджетов) не грузит RatesIndex вовсе", async () => {
        const { env, d1 } = makeEnv();
        let scans = 0;
        const orig = d1.prepare.bind(d1);
        (env.DB as { prepare: (sql: string) => unknown }).prepare = (sql: string) => {
            if (sql === RATES_SCAN_SQL) scans++;
            return orig(sql);
        };
        await getBootstrapData(env, { withExpenses: false, withBudgets: false });
        expect(scans).toBe(0);
    });
});
