/**
 * SPEC-022 (тех-долг 2.6): getEffectiveBalance / effectiveBalancePerAccount
 * против реального SQLite (node:sqlite мок D1). Money-critical: баланс ведра =
 * manual baseline + Σ событий строго после baseline.date и ≤ asOf (SPEC-011).
 * Покрываем выбор baseline, окно событий, все 5 типов событий + fee-JOIN,
 * исключение external/deleted.
 */
import { describe, it, expect } from "vitest";
import { getEffectiveBalance, effectiveBalancePerAccount } from "../src/snapshots";
import { createExpense } from "../src/db";
import { makeEnv, seed } from "./d1-mock";

describe("getEffectiveBalance", () => {
    it("нет baseline → 0 + все события", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [{ id: "eur-bank", currency: "EUR" }],
            incomes: [{ id: "i1", date: "2026-01-10", account_id: "eur-bank", amount: 1000, currency_code: "EUR" }],
            expenses: [{ id: "e1", date: "2026-01-15", account_id: "eur-bank", amount: 200, currency: "EUR" }],
        });
        const r = await getEffectiveBalance(env, "eur-bank");
        expect(r.balance).toBe(800);
        expect(r.manual_baseline).toBeNull();
        expect(r.events_count).toBe(2);
    });

    it("baseline + события после неё", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [{ id: "eur-bank", currency: "EUR" }],
            snapshots: [{ id: "s1", date: "2026-02-01", account_id: "eur-bank", amount: 5000 }],
            incomes: [{ id: "i1", date: "2026-02-05", account_id: "eur-bank", amount: 300, currency_code: "EUR" }],
            expenses: [{ id: "e1", date: "2026-02-10", account_id: "eur-bank", amount: 100, currency: "EUR" }],
        });
        const r = await getEffectiveBalance(env, "eur-bank");
        expect(r.balance).toBe(5200);
        expect(r.manual_baseline).toEqual({ id: "s1", date: "2026-02-01", amount: 5000 });
        expect(r.events_count).toBe(2);
    });

    it("tie-break внутри дня снапшота по created_at: ПОСЛЕ снапшота учтено, ДО — нет (SPEC-024 AC1/AC2)", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [{ id: "eur-cash", currency: "EUR" }],
            snapshots: [{ id: "s1", date: "2026-03-01", account_id: "eur-cash", amount: 90, created_at: "2026-03-01 10:00:00" }],
            expenses: [
                // трата ДО снапшота того же дня → уже учтена в 90, повторно не вычитается (AC2)
                { id: "e-before", date: "2026-03-01", account_id: "eur-cash", amount: 10, currency: "EUR", created_at: "2026-03-01 09:00:00" },
            ],
            incomes: [
                // доход ПОСЛЕ снапшота того же дня → учитывается (AC1)
                { id: "i-after", date: "2026-03-01", account_id: "eur-cash", amount: 50, currency_code: "EUR", created_at: "2026-03-01 11:00:00" },
                // доход следующего дня → учитывается (date > baseline.date)
                { id: "i-next", date: "2026-03-02", account_id: "eur-cash", amount: 5, currency_code: "EUR" },
            ],
        });
        const r = await getEffectiveBalance(env, "eur-cash");
        expect(r.balance).toBe(145);      // 90 (трата до снапшота уже внутри) + 50 (доход после) + 5 (след. день)
        expect(r.events_count).toBe(2);   // i-after + i-next; e-before в окно после снапшота не попал
    });

    it("событие в день baseline с created_at ДО снапшота — исключено", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [{ id: "eur-bank", currency: "EUR" }],
            snapshots: [{ id: "s1", date: "2026-03-01", account_id: "eur-bank", amount: 1000, created_at: "2026-03-01 23:00:00" }],
            incomes: [
                { id: "i-before", date: "2026-03-01", account_id: "eur-bank", amount: 500, currency_code: "EUR", created_at: "2026-03-01 08:00:00" },
                { id: "i-next", date: "2026-03-02", account_id: "eur-bank", amount: 200, currency_code: "EUR" },
            ],
        });
        const r = await getEffectiveBalance(env, "eur-bank");
        expect(r.balance).toBe(1200);     // 1000 + 200 (i-before до снапшота → внутри baseline)
        expect(r.events_count).toBe(1);
    });

    it("asOf-cutoff: будущие события и baseline после asOf исключены", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [{ id: "eur-bank", currency: "EUR" }],
            snapshots: [
                { id: "s1", date: "2026-01-01", account_id: "eur-bank", amount: 1000 },
                { id: "s2", date: "2026-09-01", account_id: "eur-bank", amount: 9999 }, // позже asOf — не baseline
            ],
            incomes: [{ id: "i1", date: "2026-06-01", account_id: "eur-bank", amount: 500, currency_code: "EUR" }],
        });
        const r = await getEffectiveBalance(env, "eur-bank", "2026-03-01");
        expect(r.balance).toBe(1000);
        expect(r.manual_baseline).toEqual({ id: "s1", date: "2026-01-01", amount: 1000 });
        expect(r.events_count).toBe(0);
    });

    it("последний baseline ≤ asOf выигрывает", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [{ id: "eur-bank", currency: "EUR" }],
            snapshots: [
                { id: "s1", date: "2026-01-01", account_id: "eur-bank", amount: 1000 },
                { id: "s2", date: "2026-02-01", account_id: "eur-bank", amount: 2000 },
            ],
        });
        expect((await getEffectiveBalance(env, "eur-bank", "2026-01-15")).balance).toBe(1000);
        expect((await getEffectiveBalance(env, "eur-bank", "2026-02-15")).balance).toBe(2000);
    });

    it("все 5 типов событий: income/expense/tx-out/goal_contribution (+ tx-in на соседе)", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [{ id: "a", currency: "EUR" }, { id: "b", currency: "EUR" }],
            snapshots: [{ id: "s1", date: "2026-01-01", account_id: "a", amount: 1000 }],
            incomes: [{ id: "i1", date: "2026-01-05", account_id: "a", amount: 500, currency_code: "EUR" }],
            expenses: [{ id: "e1", date: "2026-01-06", account_id: "a", amount: 200, currency: "EUR" }],
            transactions: [{
                id: "t1", type: "transfer", date: "2026-01-07",
                from_account_id: "a", from_amount: 100, from_currency: "EUR",
                to_account_id: "b", to_amount: 100, to_currency: "EUR",
            }],
            goal_contributions: [{ id: "g1", goal_id: "goal", date: "2026-01-08", account_id: "a", amount: 50, currency_code: "EUR" }],
        });
        const a = await getEffectiveBalance(env, "a");
        expect(a.balance).toBe(1250);          // 1000 +500 -200 -100 +50
        expect(a.events_count).toBe(4);        // income + expense + tx-out + gc (tx-in не на a)
        const b = await getEffectiveBalance(env, "b");
        expect(b.balance).toBe(100);           // +to_amount
        expect(b.events_count).toBe(1);
    });

    it("комиссия транзакции — отток из ведра-плательщика (fee JOIN)", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [{ id: "rub-bank", currency: "RUB" }, { id: "usdt", currency: "USDT" }],
            transactions: [{
                id: "t1", type: "exchange", date: "2026-04-10",
                from_account_id: "rub-bank", from_amount: 100000, from_currency: "RUB",
                to_account_id: "usdt", to_amount: 1200, to_currency: "USDT",
                fee_amount: 500, fee_currency: "RUB",   // = валюта from → платит rub-bank
            }],
        });
        const rub = await getEffectiveBalance(env, "rub-bank");
        expect(rub.balance).toBe(-100500);     // -100000 (from) -500 (fee)
        const usdt = await getEffectiveBalance(env, "usdt");
        expect(usdt.balance).toBe(1200);       // +to, комиссия НЕ на usdt (fee_currency≠его валюта)
    });

    it("soft-deleted baseline и события игнорируются", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [{ id: "eur-bank", currency: "EUR" }],
            snapshots: [{ id: "s1", date: "2026-01-01", account_id: "eur-bank", amount: 1000 }],
            incomes: [
                { id: "i-live", date: "2026-01-05", account_id: "eur-bank", amount: 500, currency_code: "EUR" },
                { id: "i-del", date: "2026-01-06", account_id: "eur-bank", amount: 999, currency_code: "EUR", deleted_at: "2026-01-07 00:00:00" },
            ],
        });
        const r = await getEffectiveBalance(env, "eur-bank");
        expect(r.balance).toBe(1500);          // 1000 + 500 (удалённый доход не считается)
        expect(r.events_count).toBe(1);
    });

    // ── Граничные кейсы (немутируемость baseline-фильтра) ──────────────────
    it("baseline на дату == asOf включается (граница date <= asOf)", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [{ id: "eur-bank", currency: "EUR" }],
            snapshots: [{ id: "s1", date: "2026-02-15", account_id: "eur-bank", amount: 3000 }],
        });
        // asOf ровно на дату снапшота — baseline ДОЛЖЕН выбраться (ловит date<? мутацию)
        const r = await getEffectiveBalance(env, "eur-bank", "2026-02-15");
        expect(r.balance).toBe(3000);
        expect(r.manual_baseline).toEqual({ id: "s1", date: "2026-02-15", amount: 3000 });
    });

    it("комиссия в третьей валюте не атрибутируется никому", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [{ id: "rub-bank", currency: "RUB" }, { id: "usdt", currency: "USDT" }],
            transactions: [{
                id: "t1", type: "exchange", date: "2026-04-10",
                from_account_id: "rub-bank", from_amount: 100000, from_currency: "RUB",
                to_account_id: "usdt", to_amount: 1200, to_currency: "USDT",
                fee_amount: 5, fee_currency: "EUR",   // ни from(RUB), ни to(USDT) → не списывается (data-model.md)
            }],
        });
        expect((await getEffectiveBalance(env, "rub-bank")).balance).toBe(-100000); // fee EUR НЕ списан
        expect((await getEffectiveBalance(env, "usdt")).balance).toBe(1200);
    });

    it("soft-deleted транзакция игнорируется (tx-out/tx-in)", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [{ id: "a", currency: "EUR" }, { id: "b", currency: "EUR" }],
            transactions: [{
                id: "t1", type: "transfer", date: "2026-01-07",
                from_account_id: "a", from_amount: 100, from_currency: "EUR",
                to_account_id: "b", to_amount: 100, to_currency: "EUR",
                deleted_at: "2026-01-08 00:00:00",
            }],
        });
        expect((await getEffectiveBalance(env, "a")).balance).toBe(0);
        expect((await getEffectiveBalance(env, "b")).balance).toBe(0);
    });

    it("две snapshots на одну дату: baseline = поздний created_at", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [{ id: "eur-bank", currency: "EUR" }],
            snapshots: [
                { id: "s-early", date: "2026-02-01", account_id: "eur-bank", amount: 1000, created_at: "2026-02-01 08:00:00" },
                { id: "s-late", date: "2026-02-01", account_id: "eur-bank", amount: 2000, created_at: "2026-02-01 20:00:00" },
            ],
        });
        const r = await getEffectiveBalance(env, "eur-bank");
        expect(r.balance).toBe(2000);                       // ORDER BY date DESC, created_at DESC
        expect(r.manual_baseline?.id).toBe("s-late");
    });
});

describe("effectiveBalancePerAccount", () => {
    it("мапа по не-external/не-deleted вёдрам; is_active НЕ фильтруется", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [
                { id: "eur-bank", currency: "EUR", form: "digital", sort_order: 10 },
                { id: "closed", currency: "EUR", form: "digital", is_active: 0, sort_order: 15 }, // is_active=0, но не external → ВКЛЮЧЕН (listBuckets не фильтрует is_active)
                { id: "ext", currency: "EUR", form: "external", sort_order: 20 },                  // исключить (external)
                { id: "gone", currency: "EUR", form: "digital", sort_order: 30, deleted_at: "2026-01-01 00:00:00" }, // исключить (deleted)
            ],
            snapshots: [{ id: "s1", date: "2026-01-01", account_id: "eur-bank", amount: 1234 }],
        });
        const map = await effectiveBalancePerAccount(env, "2026-05-15");
        expect(Object.keys(map).sort()).toEqual(["closed", "eur-bank"]); // closed присутствует несмотря на is_active=0
        expect(map["eur-bank"].balance).toBe(1234);
        expect(map["closed"].balance).toBe(0);
    });
});

describe("createExpense · серверный created_at (SPEC-024 AC6)", () => {
    it("ставит серверный created_at каноничного формата, игнорирует клиентский ISO", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, { accounts: [{ id: "eur-cash", currency: "EUR" }] });
        const res = await createExpense(env, "u1", {
            id: "e1", date: "2026-06-01", account_id: "eur-cash", amount: 10, currency: "EUR",
            created_at: "2099-01-01T00:00:00.000Z",   // клиентский — должен быть проигнорирован
        });
        expect(res).toMatchObject({ ok: true, inserted: true });
        const row = await env.DB.prepare("SELECT created_at FROM expenses WHERE id = ?")
            .bind("e1").first<{ created_at: string }>();
        // канон 'YYYY-MM-DD HH:MM:SS' (без 'T'/'Z'/мс) и НЕ клиентский 2099
        expect(row!.created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
        expect(row!.created_at.startsWith("2099")).toBe(false);
    });
});
