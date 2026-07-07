/**
 * SPEC-042 — волна 1 аудита 2026-07, серверные P1-фиксы:
 *  WRK-01  PUT expense: явный null отвязывает account_id/category_id (hasOwnProperty, не COALESCE)
 *  FIN-01  смена счёта в edit incomes/contributions/snapshots не ревальвирует сумму молча
 *  WRK-02  сброс archetype_override/floor_eur на «авто» реально очищает (UPSERT без COALESCE)
 *  SPC-01  инвест-ведро не принимает траты (server-side guard)
 *  SEC-04  /tg отклоняет апдейты без валидного X-Telegram-Bot-Api-Secret-Token
 */
import { describe, it, expect } from "vitest";
import worker from "../src/index";
import { createExpense, updateExpense } from "../src/db";
import { updateIncome } from "../src/incomes";
import { updateContribution } from "../src/goals";
import { updateSnapshot } from "../src/snapshots";
import { upsertBudgetSettings } from "../src/rbar";
import { makeEnv, seed } from "./d1-mock";

function makeWorld() {
    const { env, d1 } = makeEnv();
    seed(d1, {
        accounts: [
            { id: "rsd-bank", currency: "RSD" },
            { id: "rub-bank", currency: "RUB" },
            { id: "rub-bank2", currency: "RUB" },
            { id: "eth", currency: "ETH", is_investment: 1 },
        ],
        categories: [{ id: "food" }, { id: "fun" }],
        income_categories: [{ id: "ic" }],
    });
    return { env, d1 };
}

describe("WRK-01 — PUT expense: null отвязывает, отсутствие поля не трогает", () => {
    function withExpense() {
        const w = makeWorld();
        seed(w.d1, { expenses: [{ id: "x1", date: "2026-06-07", account_id: "rsd-bank", category_id: "food", amount: 100, currency: "RSD", user_id: "u" }] });
        return w;
    }

    it("{account_id: null} отвязывает счёт («без счёта»)", async () => {
        const { env, d1 } = withExpense();
        const r = await updateExpense(env, "x1", "u", { account_id: null });
        expect(r.ok).toBe(true);
        const row = d1.db.prepare("SELECT account_id, category_id FROM expenses WHERE id='x1'").get() as any;
        expect(row.account_id).toBeNull();
        expect(row.category_id).toBe("food");   // не тронуто
    });

    it("{category_id: null} очищает категорию", async () => {
        const { env, d1 } = withExpense();
        const r = await updateExpense(env, "x1", "u", { category_id: null });
        expect(r.ok).toBe(true);
        const row = d1.db.prepare("SELECT account_id, category_id FROM expenses WHERE id='x1'").get() as any;
        expect(row.category_id).toBeNull();
        expect(row.account_id).toBe("rsd-bank");
    });

    it("PATCH без account_id/category_id оставляет привязки как есть", async () => {
        const { env, d1 } = withExpense();
        await updateExpense(env, "x1", "u", { note: "n" });
        const row = d1.db.prepare("SELECT account_id, category_id, note FROM expenses WHERE id='x1'").get() as any;
        expect(row.account_id).toBe("rsd-bank");
        expect(row.category_id).toBe("food");
        expect(row.note).toBe("n");
    });

    it("смена категории значением работает как раньше", async () => {
        const { env, d1 } = withExpense();
        await updateExpense(env, "x1", "u", { category_id: "fun" });
        expect((d1.db.prepare("SELECT category_id FROM expenses WHERE id='x1'").get() as any).category_id).toBe("fun");
    });
});

describe("SPC-01 — инвест-ведро не принимает траты", () => {
    it("createExpense на инвест-ведро → отклонено", async () => {
        const { env } = makeWorld();
        const r = await createExpense(env, "u", { id: "e1", date: "2026-06-07", account_id: "eth", amount: 1, currency: "ETH" });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toContain("инвест");
    });

    it("updateExpense со сменой счёта на инвест-ведро → отклонено", async () => {
        const { env, d1 } = makeWorld();
        seed(d1, { expenses: [{ id: "x1", date: "2026-06-07", account_id: "rsd-bank", amount: 100, currency: "RSD", user_id: "u" }] });
        const r = await updateExpense(env, "x1", "u", { account_id: "eth", currency: "ETH" });
        expect(r.ok).toBe(false);
    });
});

describe("FIN-01 — смена счёта не ревальвирует сумму молча", () => {
    it("income: счёт другой валюты без amount → 400-ошибка; с amount → ok и валюта пере-дерivedена", async () => {
        const { env, d1 } = makeWorld();
        seed(d1, { incomes: [{ id: "i1", date: "2026-06-07", account_id: "rub-bank", amount: 100000, currency_code: "RUB" }] });
        const bad = await updateIncome(env, "i1", { account_id: "rsd-bank" });
        expect(bad.ok).toBe(false);
        const good = await updateIncome(env, "i1", { account_id: "rsd-bank", amount: 117000 });
        expect(good.ok).toBe(true);
        const row = d1.db.prepare("SELECT amount, currency_code FROM incomes WHERE id='i1'").get() as any;
        expect(row.currency_code).toBe("RSD");
        expect(row.amount).toBe(117000);
    });

    it("income: счёт ТОЙ ЖЕ валюты без amount → ok (валюта не меняется)", async () => {
        const { env } = makeWorld();
        seed(makeWorld().d1, {});   // no-op, мир уже собран выше
        const { env: env2, d1: d2 } = makeWorld();
        seed(d2, { incomes: [{ id: "i1", date: "2026-06-07", account_id: "rub-bank", amount: 500, currency_code: "RUB" }] });
        const r = await updateIncome(env2, "i1", { account_id: "rub-bank2" });
        expect(r.ok).toBe(true);
        void env;
    });

    it("contribution: счёт другой валюты без amount → отклонено, с amount → ok", async () => {
        const { env, d1 } = makeWorld();
        seed(d1, {
            goals: [{ id: "g1", name: "Цель" }],
            goal_contributions: [{ id: "c1", goal_id: "g1", date: "2026-06-07", amount: 100000, currency_code: "RUB", account_id: "rub-bank" }],
        });
        expect((await updateContribution(env, "c1", { account_id: "rsd-bank" })).ok).toBe(false);
        const ok = await updateContribution(env, "c1", { account_id: "rsd-bank", amount: 117000 });
        expect(ok.ok).toBe(true);
        expect((d1.db.prepare("SELECT currency_code FROM goal_contributions WHERE id='c1'").get() as any).currency_code).toBe("RSD");
    });

    it("snapshot: перенос на ведро другой валюты без amount → отклонено; с amount → ok; та же валюта → ok", async () => {
        const { env, d1 } = makeWorld();
        seed(d1, { snapshots: [{ id: "s1", date: "2026-06-07", account_id: "rub-bank", amount: 150000 }] });
        const bad = await updateSnapshot(env, "s1", { account_id: "rsd-bank" });
        expect(bad.ok).toBe(false);
        const sameCcy = await updateSnapshot(env, "s1", { account_id: "rub-bank2" });
        expect(sameCcy.ok).toBe(true);
        const withAmount = await updateSnapshot(env, "s1", { account_id: "rsd-bank", amount: 175000 });
        expect(withAmount.ok).toBe(true);
        expect((d1.db.prepare("SELECT account_id, amount FROM snapshots WHERE id='s1'").get() as any).amount).toBe(175000);
    });
});

describe("WRK-02 — budget_settings: явный null очищает override/floor", () => {
    it("сброс archetype_override на «авто» реально пишет NULL", async () => {
        const { env, d1 } = makeWorld();
        await upsertBudgetSettings(env, "food", { archetype_override: "lumpy" });
        expect((d1.db.prepare("SELECT archetype_override FROM budget_settings WHERE category_id='food'").get() as any).archetype_override).toBe("lumpy");
        const r = await upsertBudgetSettings(env, "food", { archetype_override: null });
        expect(r.ok).toBe(true);
        expect((d1.db.prepare("SELECT archetype_override FROM budget_settings WHERE category_id='food'").get() as any).archetype_override).toBeNull();
    });

    it("сброс floor_eur → NULL; непереданные поля не трогаются", async () => {
        const { env, d1 } = makeWorld();
        await upsertBudgetSettings(env, "food", { archetype_override: "fixed", floor_eur: 50 });
        await upsertBudgetSettings(env, "food", { floor_eur: null });
        const row = d1.db.prepare("SELECT archetype_override, floor_eur, adaptive_enabled FROM budget_settings WHERE category_id='food'").get() as any;
        expect(row.floor_eur).toBeNull();
        expect(row.archetype_override).toBe("fixed");   // не передан → не тронут
        expect(row.adaptive_enabled).toBe(1);
    });
});

describe("MA-01/идемпотентность — ретрай createExpense с тем же id", () => {
    it("повтор с тем же id → inserted:false даже когда повтор не прошёл бы overdraft", async () => {
        const { env, d1 } = makeWorld();
        // baseline 150: первая трата 100 проходит, «вторая» такая же не прошла бы overdraft.
        seed(d1, { snapshots: [{ id: "s1", date: "2026-06-01", account_id: "rsd-bank", amount: 150 }] });
        const p = { id: "e1", date: "2026-06-07", account_id: "rsd-bank", amount: 100, currency: "RSD" };
        const r1 = await createExpense(env, "u", p);
        expect(r1.ok).toBe(true);
        const r2 = await createExpense(env, "u", p);
        expect(r2.ok).toBe(true);
        if (r2.ok) expect(r2.inserted).toBe(false);
        expect(d1.db.prepare("SELECT COUNT(*) c FROM expenses").get().c).toBe(1);
    });
});

describe("SEC-04 — /tg webhook secret", () => {
    const post = (headers?: Record<string, string>) =>
        new Request("https://x/tg", { method: "POST", body: "{}", headers: { "Content-Type": "application/json", ...headers } });

    it("секрет в env не задан → прежнее поведение (200)", async () => {
        const { env } = makeEnv();
        const r = await worker.fetch(post(), env);
        expect(r.status).toBe(200);
    });

    it("секрет задан, header отсутствует/неверный → 403", async () => {
        const { env } = makeEnv();
        env.TELEGRAM_WEBHOOK_SECRET = "s3cret";
        expect((await worker.fetch(post(), env)).status).toBe(403);
        expect((await worker.fetch(post({ "X-Telegram-Bot-Api-Secret-Token": "wrong" }), env)).status).toBe(403);
    });

    it("секрет задан, header верный → 200", async () => {
        const { env } = makeEnv();
        env.TELEGRAM_WEBHOOK_SECRET = "s3cret";
        const r = await worker.fetch(post({ "X-Telegram-Bot-Api-Secret-Token": "s3cret" }), env);
        expect(r.status).toBe(200);
    });
});
