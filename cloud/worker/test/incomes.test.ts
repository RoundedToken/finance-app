/**
 * QA-07 (SPEC-046): CRUD incomes.ts через реальный SQL-путь — до этого модуль
 * не исполнялся ни одним тестом (доход — второй по значимости денежный поток,
 * участвует в savings_rate/дашборде). Паттерн — test/transactions.test.ts.
 */
import { describe, it, expect } from "vitest";
import { createIncome, updateIncome, deleteIncome, listIncomes } from "../src/incomes";
import { makeEnv, seed } from "./d1-mock";

const CANON = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;   // канон created_at (SPEC-024)

function makeWorld() {
    const { env, d1 } = makeEnv();
    seed(d1, {
        accounts: [
            { id: "rub-bank", currency: "RUB" },
            { id: "eur-bank", currency: "EUR" },
        ],
        income_categories: [{ id: "salary" }, { id: "gift" }],
        goals: [{ id: "g1", name: "Цель" }],
        rates: [{ date: "2026-06-01", quote: "RUB", rate: 100 }],   // 1 EUR = 100 RUB
    });
    return { env, d1 };
}

describe("createIncome", () => {
    it("валюта ДЕРИВИТСЯ из ведра (клиент её не передаёт), канонический created_at", async () => {
        const { env, d1 } = makeWorld();
        const r = await createIncome(env, { id: "i1", date: "2026-06-10", account_id: "rub-bank", amount: 50000, category_id: "salary" });
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.inserted).toBe(true);
        const row = d1.db.prepare("SELECT * FROM incomes WHERE id = 'i1'").get() as any;
        expect(row.currency_code).toBe("RUB");    // из accounts.currency, не из payload
        expect(row.amount).toBe(50000);
        expect(String(row.created_at)).toMatch(CANON);
    });

    it("идемпотентность: повторный create с тем же id → inserted:false, строка одна", async () => {
        const { env, d1 } = makeWorld();
        const p = { id: "i1", date: "2026-06-10", account_id: "rub-bank", amount: 100, category_id: "salary" };
        await createIncome(env, p);
        const r2 = await createIncome(env, { ...p, amount: 999 });
        expect(r2.ok).toBe(true);
        if (r2.ok) expect(r2.inserted).toBe(false);
        const row = d1.db.prepare("SELECT amount FROM incomes WHERE id = 'i1'").get() as any;
        expect(row.amount).toBe(100);             // INSERT OR IGNORE — первая версия цела
    });

    it("несуществующий account_id / category_id / goal_id → ошибка (handler мапит в 400)", async () => {
        const { env } = makeWorld();
        const base = { date: "2026-06-10", amount: 100 };
        const badAcc = await createIncome(env, { ...base, account_id: "ghost", category_id: "salary" });
        expect(badAcc).toEqual({ ok: false, error: "unknown account_id" });
        const badCat = await createIncome(env, { ...base, account_id: "rub-bank", category_id: "ghost" });
        expect(badCat).toEqual({ ok: false, error: "unknown category_id" });
        const badGoal = await createIncome(env, { ...base, account_id: "rub-bank", category_id: "salary", goal_id: "ghost" });
        expect(badGoal).toEqual({ ok: false, error: "unknown goal_id" });
    });

    it("валидный goal_id проходит и пишется", async () => {
        const { env, d1 } = makeWorld();
        const r = await createIncome(env, { id: "i1", date: "2026-06-10", account_id: "rub-bank", amount: 100, category_id: "salary", goal_id: "g1" });
        expect(r.ok).toBe(true);
        expect((d1.db.prepare("SELECT goal_id FROM incomes WHERE id = 'i1'").get() as any).goal_id).toBe("g1");
    });
});

describe("updateIncome", () => {
    it("смена счёта на другую валюту БЕЗ amount → отклонена (FIN-01: сумма молча сменила бы валюту)", async () => {
        const { env } = makeWorld();
        await createIncome(env, { id: "i1", date: "2026-06-10", account_id: "rub-bank", amount: 50000, category_id: "salary" });
        const r = await updateIncome(env, "i1", { account_id: "eur-bank" });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toContain("укажи amount");
    });

    it("смена счёта С amount тем же PATCH → ok, currency_code пере-деривится", async () => {
        const { env, d1 } = makeWorld();
        await createIncome(env, { id: "i1", date: "2026-06-10", account_id: "rub-bank", amount: 50000, category_id: "salary" });
        const r = await updateIncome(env, "i1", { account_id: "eur-bank", amount: 500 });
        expect(r.ok).toBe(true);
        const row = d1.db.prepare("SELECT account_id, currency_code, amount FROM incomes WHERE id = 'i1'").get() as any;
        expect(row).toMatchObject({ account_id: "eur-bank", currency_code: "EUR", amount: 500 });
    });

    it("PATCH необязательных полей: note ставится/стирается через hasOwnProperty-семантику", async () => {
        const { env, d1 } = makeWorld();
        await createIncome(env, { id: "i1", date: "2026-06-10", account_id: "rub-bank", amount: 100, category_id: "salary", note: "аванс" });
        await updateIncome(env, "i1", { amount: 200 });   // note не передан → не тронут
        expect((d1.db.prepare("SELECT note FROM incomes WHERE id = 'i1'").get() as any).note).toBe("аванс");
        await updateIncome(env, "i1", { note: null });    // явный null → стереть
        expect((d1.db.prepare("SELECT note FROM incomes WHERE id = 'i1'").get() as any).note).toBeNull();
    });

    it("несуществующий/удалённый id → updated:false", async () => {
        const { env } = makeWorld();
        const r = await updateIncome(env, "ghost", { amount: 1 });
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.updated).toBe(false);
    });
});

describe("deleteIncome — soft", () => {
    it("deleted_at ставится, из list исчезает, строка в D1 остаётся; повторный delete → false", async () => {
        const { env, d1 } = makeWorld();
        await createIncome(env, { id: "i1", date: "2026-06-10", account_id: "rub-bank", amount: 50000, category_id: "salary" });
        const r = await deleteIncome(env, "i1");
        expect(r.deleted).toBe(true);
        const row = d1.db.prepare("SELECT deleted_at FROM incomes WHERE id = 'i1'").get() as any;
        expect(row.deleted_at).not.toBeNull();                       // soft, не hard
        expect(await listIncomes(env, {})).toHaveLength(0);
        expect((await deleteIncome(env, "i1")).deleted).toBe(false); // уже удалён
    });
});

describe("listIncomes — amount_eur date-aware", () => {
    it("EUR-эквивалент по курсу на дату дохода; без курса → null, не 0", async () => {
        const { env } = makeWorld();
        await createIncome(env, { id: "i1", date: "2026-06-10", account_id: "rub-bank", amount: 50000, category_id: "salary" });
        await createIncome(env, { id: "i2", date: "2020-01-01", account_id: "rub-bank", amount: 1000, category_id: "gift" });   // до первого курса
        const rows = await listIncomes(env, {});
        const byId = new Map(rows.map((r: any) => [r.id, r]));
        expect(byId.get("i1").amount_eur).toBe(500);    // 50000 RUB / 100
        expect(byId.get("i2").amount_eur).toBeNull();   // курса на 2020 нет
    });
});
