/**
 * SPEC-043 — волна 2 аудита (кластеры 1+3+4): null-семантика PUT, валидация периметра,
 * legacy-код. WRK-03/04/05/06/07/13/14/15/17/19, DB-03.
 */
import { describe, it, expect } from "vitest";
import worker from "../src/index";
import { createExpense, updateExpense } from "../src/db";
import { updateSnapshot } from "../src/snapshots";
import { updateGoal } from "../src/goals";
import { createTransaction, updateTransaction } from "../src/transactions";
import { parseLatestCsv } from "../src/rates";
import { escapeHtml } from "../src/bot";
import { expenseCreateSchema, snapshotCreateSchema, isRealIsoDate } from "../src/schemas";
import { makeEnv, seed } from "./d1-mock";

function makeWorld() {
    const { env, d1 } = makeEnv();
    seed(d1, {
        accounts: [
            { id: "rsd-bank", currency: "RSD" },
            { id: "eur-bank", currency: "EUR" },
            { id: "eur-cash", currency: "EUR" },
        ],
        currencies: [{ code: "RSD", name: "Dinar" }, { code: "EUR", name: "Euro" }],
        categories: [{ id: "food" }],
        snapshots: [{ id: "base1", date: "2026-06-01", account_id: "rsd-bank", amount: 1000 }],
    });
    return { env, d1 };
}

describe("WRK-03/WRK-17 — Zod: Infinity и несуществующие даты режутся на границе", () => {
    it("amount: Infinity (JSON 1e309) → reject; нормальная сумма → ok", () => {
        const base = { id: "e", date: "2026-06-07", currency: "EUR" };
        expect(expenseCreateSchema.safeParse({ ...base, amount: Infinity }).success).toBe(false);
        expect(expenseCreateSchema.safeParse({ ...base, amount: 1e13 }).success).toBe(false);   // > cap
        expect(expenseCreateSchema.safeParse({ ...base, amount: 10.5 }).success).toBe(true);
        expect(snapshotCreateSchema.safeParse({ date: "2026-06-07", account_id: "a", amount: -1e309 }).success).toBe(false);
        expect(snapshotCreateSchema.safeParse({ date: "2026-06-07", account_id: "a", amount: -500 }).success).toBe(true);
    });

    it("дата: 2026-13-99 / 2026-02-30 → reject; високосный 2024-02-29 → ok", () => {
        expect(isRealIsoDate("2026-13-99")).toBe(false);
        expect(isRealIsoDate("2026-02-30")).toBe(false);
        expect(isRealIsoDate("2024-02-29")).toBe(true);
        expect(isRealIsoDate("2026-07-07")).toBe(true);
        const base = { id: "e", amount: 1, currency: "EUR" };
        expect(expenseCreateSchema.safeParse({ ...base, date: "2026-13-99" }).success).toBe(false);
    });
});

describe("WRK-05 — updateSnapshot: PUT без note заметку не трогает", () => {
    it("{amount} сохраняет note; {note: null} стирает", async () => {
        const { env, d1 } = makeWorld();
        seed(d1, { snapshots: [{ id: "s1", date: "2026-06-05", account_id: "rsd-bank", amount: 500, note: "зарплата" }] });
        await updateSnapshot(env, "s1", { amount: 600 });
        expect((d1.db.prepare("SELECT note, amount FROM snapshots WHERE id='s1'").get() as any).note).toBe("зарплата");
        await updateSnapshot(env, "s1", { note: null });
        expect((d1.db.prepare("SELECT note FROM snapshots WHERE id='s1'").get() as any).note).toBeNull();
    });
});

describe("WRK-06 — updateGoal: частичный PUT валидируется по merged из БД", () => {
    it("{note} на цель с давно заданной target_currency → ok (раньше ложный 400)", async () => {
        const { env, d1 } = makeWorld();
        seed(d1, { goals: [{ id: "g1", name: "Цель", target_currency: "EUR", target_amount: 1000 }] });
        const r = await updateGoal(env, "g1", { note: "x" });
        expect(r.ok).toBe(true);
        expect((d1.db.prepare("SELECT note, target_currency FROM goals WHERE id='g1'").get() as any).target_currency).toBe("EUR");
    });

    it("несуществующая цель → goal not found", async () => {
        const { env } = makeWorld();
        expect((await updateGoal(env, "ghost", { note: "x" })).ok).toBe(false);
    });

    it("явный target_currency: null в PATCH → 400 (обязателен по SPEC-007)", async () => {
        const { env, d1 } = makeWorld();
        seed(d1, { goals: [{ id: "g1", name: "Цель", target_currency: "EUR" }] });
        expect((await updateGoal(env, "g1", { target_currency: null })).ok).toBe(false);
    });
});

describe("WRK-07 — updateExpense: overdraft-гард на правке суммы", () => {
    it("создал 100, исправил на 2000 при балансе 1000 → 400; в пределах (с откатом старой) → ok", async () => {
        const { env } = makeWorld();
        await createExpense(env, "u", { id: "e1", date: "2026-06-07", account_id: "rsd-bank", amount: 100, currency: "RSD" });
        const over = await updateExpense(env, "e1", "u", { amount: 2000 });
        expect(over.ok).toBe(false);
        if (!over.ok) expect(over.error).toContain("недостаточно");
        // 1000 доступно, старая трата 100 откатывается → до 1000 можно
        const fit = await updateExpense(env, "e1", "u", { amount: 950 });
        expect(fit.ok).toBe(true);
    });

    it("правка note не трогает гарды (нет лишнего SELECT-пути)", async () => {
        const { env } = makeWorld();
        await createExpense(env, "u", { id: "e1", date: "2026-06-07", account_id: "rsd-bank", amount: 100, currency: "RSD" });
        expect((await updateExpense(env, "e1", "u", { note: "n" })).ok).toBe(true);
    });
});

describe("DB-03 — exists-guard'ы справочников у expenses", () => {
    it("createExpense: unknown category_id → 400", async () => {
        const { env } = makeWorld();
        const r = await createExpense(env, "u", { id: "e1", date: "2026-06-07", account_id: null, category_id: "ghost", amount: 5, currency: "EUR" });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toContain("unknown category_id");
    });

    it("updateExpense: unknown account_id / category_id → 400", async () => {
        const { env, d1 } = makeWorld();
        seed(d1, { expenses: [{ id: "x1", date: "2026-06-07", account_id: "rsd-bank", amount: 10, currency: "RSD", user_id: "u" }] });
        expect((await updateExpense(env, "x1", "u", { account_id: "ghost", currency: "EUR" })).ok).toBe(false);
        expect((await updateExpense(env, "x1", "u", { category_id: "ghost" })).ok).toBe(false);
    });
});

describe("WRK-14 — updateTransaction: fee-патч проходит полную валидацию", () => {
    async function withTx(env: any) {
        await createTransaction(env, { id: "t1", type: "transfer", date: "2026-06-07", from_account_id: "eur-bank", to_account_id: "eur-cash", from_amount: 50, to_amount: 50 });
    }
    function withMoney() {
        const w = makeWorld();
        seed(w.d1, { snapshots: [{ id: "b2", date: "2026-06-01", account_id: "eur-bank", amount: 200 }] });
        return w;
    }

    it("{fee_currency: 'ZZZ'} → 400 unknown fee_currency (раньше сохранялось)", async () => {
        const { env } = withMoney();
        await withTx(env);
        const r = await updateTransaction(env, "t1", { fee_currency: "ZZZ" });
        expect(r.ok).toBe(false);
    });

    it("{fee_amount} без fee_currency в БД → 400 (create такую пару отклоняет)", async () => {
        const { env } = withMoney();
        await withTx(env);
        const r = await updateTransaction(env, "t1", { fee_amount: 10 });
        expect(r.ok).toBe(false);
    });

    it("валидная пара fee → ok, с overdraft-пересчётом", async () => {
        const { env } = withMoney();
        await withTx(env);
        const r = await updateTransaction(env, "t1", { fee_amount: 10, fee_currency: "EUR" });
        expect(r.ok).toBe(true);
        const over = await updateTransaction(env, "t1", { fee_amount: 100000, fee_currency: "EUR" });
        expect(over.ok).toBe(false);
    });
});

describe("WRK-04 — parseLatestCsv: мусорная дата валит фетч (а не MAX(date))", () => {
    it("локализованная дата / #N/A → throw; ISO → ok", () => {
        expect(() => parseLatestCsv("date,EURUSD\n25/05/2026,1.1")).toThrow(/bad date/);
        expect(() => parseLatestCsv("date,EURUSD\n#N/A,1.1")).toThrow(/bad date/);
        const ok = parseLatestCsv("date,EURUSD,EURRUB\n2026-07-07,1.1,90.5");
        expect(ok.date).toBe("2026-07-07");
        expect(ok.rates.USD).toBe(1.1);
    });
});

describe("WRK-13 — escapeHtml покрывает кавычки и амперсанд", () => {
    it("категория с HTML-метасимволами экранируется", () => {
        expect(escapeHtml(`<b>&"'`)).toBe("&lt;b&gt;&amp;&quot;&#39;");
    });
});

describe("WRK-15/WRK-19 — admin-периметр", () => {
    const post = (path: string, body: unknown) =>
        new Request(`https://x${path}`, { method: "POST", headers: { Authorization: "Bearer sync-tok", "Content-Type": "application/json" }, body: JSON.stringify(body) });

    it("/v1/admin/references удалён → 404", async () => {
        const { env } = makeWorld();
        env.SYNC_TOKEN = "sync-tok";
        const r = await worker.fetch(post("/v1/admin/references", { accounts: [] }), env);
        expect(r.status).toBe(404);
    });

    it("/v1/admin/migrate-expenses: мусорные элементы скипаются, валидные вставляются, ответ считает skipped", async () => {
        const { env, d1 } = makeWorld();
        env.SYNC_TOKEN = "sync-tok";
        const body = {
            expenses: [
                { id: "m1", date: "2026-06-01", amount: 10, currency: "EUR" },                    // валидный
                { date: "2026-06-01", amount: 10, currency: "EUR" },                              // без id
                { id: "m3", date: "2026-13-99", amount: 10, currency: "EUR" },                    // фейковая дата
                { id: "m4", date: "2026-06-01", amount: "10", currency: "EUR" },                  // amount строкой
                { id: "m5", date: "2026-06-01", amount: 10, currency: "EUR", created_at: 123 },   // created_at числом (раньше 500)
            ],
        };
        const r = await worker.fetch(post("/v1/admin/migrate-expenses", body), env);
        expect(r.status).toBe(200);
        const j = await r.json() as any;
        expect(j.inserted).toBe(1);
        expect(j.skipped_invalid).toBe(4);
        expect(j.skipped_overflow).toBe(0);
        expect((d1.db.prepare("SELECT COUNT(*) c FROM expenses").get() as any).c).toBe(1);
    });
});
