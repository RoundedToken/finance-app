/**
 * QA-01 (SPEC-042): CRUD transactions.ts через реальный SQL-путь — до этого модуль
 * не покрывался вовсе (тесты ledger/effective-balance сеяли строки напрямую).
 * Паттерн: D1-мок + сверка через getEffectiveBalance обоих вёдер (деньги — не строки).
 */
import { describe, it, expect } from "vitest";
import { createTransaction, updateTransaction, deleteTransaction, listTransactions } from "../src/transactions";
import { getEffectiveBalance } from "../src/snapshots";
import { makeEnv, seed } from "./d1-mock";

const D = "2026-06-10";       // дата операций (после baseline)
const CANON = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;   // канон created_at (SPEC-024)

function makeWorld() {
    const { env, d1 } = makeEnv();
    seed(d1, {
        accounts: [
            { id: "rub-bank", currency: "RUB" },
            { id: "eur-bank", currency: "EUR" },
            { id: "eur-cash", currency: "EUR" },
            { id: "usdt", currency: "USDT" },
        ],
        currencies: [
            { code: "RUB", name: "Ruble" },
            { code: "EUR", name: "Euro" },
            { code: "USDT", name: "Tether" },
        ],
        snapshots: [
            { id: "s1", date: "2026-06-01", account_id: "rub-bank", amount: 100000 },
            { id: "s2", date: "2026-06-01", account_id: "eur-bank", amount: 1000 },
            { id: "s3", date: "2026-06-01", account_id: "eur-cash", amount: 500 },
        ],
    });
    return { env, d1 };
}

const bal = async (env: any, id: string) => (await getEffectiveBalance(env, id, "2026-06-30")).balance;

describe("createTransaction — exchange/transfer (SPEC-012)", () => {
    it("exchange RUB→EUR: вставка, деривация валют из вёдер, канонический created_at, балансы обоих вёдер", async () => {
        const { env, d1 } = makeWorld();
        const r = await createTransaction(env, { id: "t1", type: "exchange", date: D, from_account_id: "rub-bank", to_account_id: "eur-bank", from_amount: 90000, to_amount: 900 });
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.inserted).toBe(true);
        const row = d1.db.prepare("SELECT * FROM transactions WHERE id = 't1'").get() as any;
        expect(row.from_currency).toBe("RUB");
        expect(row.to_currency).toBe("EUR");
        expect(row.chain_id).toBeNull();       // SPEC-012: спящие колонки всегда NULL
        expect(row.goal_id).toBeNull();
        expect(String(row.created_at)).toMatch(CANON);   // tie-break SPEC-024 держится на каноне
        expect(await bal(env, "rub-bank")).toBe(10000);
        expect(await bal(env, "eur-bank")).toBe(1900);
    });

    it("идемпотентность: повторный create с тем же id → inserted:false, баланс не задвоен", async () => {
        const { env } = makeWorld();
        const p = { id: "t1", type: "exchange" as const, date: D, from_account_id: "rub-bank", to_account_id: "eur-bank", from_amount: 90000, to_amount: 900 };
        await createTransaction(env, p);
        const r2 = await createTransaction(env, p);
        expect(r2.ok).toBe(true);
        if (r2.ok) expect(r2.inserted).toBe(false);
        expect(await bal(env, "rub-bank")).toBe(10000);
    });

    it("transfer EUR→EUR: балансы двигаются симметрично", async () => {
        const { env } = makeWorld();
        const r = await createTransaction(env, { type: "transfer", date: D, from_account_id: "eur-bank", to_account_id: "eur-cash", from_amount: 200, to_amount: 200 });
        expect(r.ok).toBe(true);
        expect(await bal(env, "eur-bank")).toBe(800);
        expect(await bal(env, "eur-cash")).toBe(700);
    });

    it("валидация: transfer разных валют / exchange одной валюты / from==to / неположительные суммы → ошибка", async () => {
        const { env } = makeWorld();
        expect((await createTransaction(env, { type: "transfer", date: D, from_account_id: "rub-bank", to_account_id: "eur-bank", from_amount: 10, to_amount: 10 })).ok).toBe(false);
        expect((await createTransaction(env, { type: "exchange", date: D, from_account_id: "eur-bank", to_account_id: "eur-cash", from_amount: 10, to_amount: 10 })).ok).toBe(false);
        expect((await createTransaction(env, { type: "transfer", date: D, from_account_id: "eur-bank", to_account_id: "eur-bank", from_amount: 10, to_amount: 10 })).ok).toBe(false);
        expect((await createTransaction(env, { type: "exchange", date: D, from_account_id: "rub-bank", to_account_id: "eur-bank", from_amount: 0, to_amount: 5 })).ok).toBe(false);
        expect((await createTransaction(env, { type: "exchange", date: D, from_account_id: "ghost", to_account_id: "eur-bank", from_amount: 5, to_amount: 5 })).ok).toBe(false);
    });

    it("overdraft: from_amount больше доступного → отклонено с внятным текстом", async () => {
        const { env } = makeWorld();
        const r = await createTransaction(env, { type: "exchange", date: D, from_account_id: "eur-bank", to_account_id: "rub-bank", from_amount: 5000, to_amount: 400000 });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toContain("недостаточно");
    });

    it("fee в валюте from: дополнительно уменьшает from-ведро", async () => {
        const { env } = makeWorld();
        const r = await createTransaction(env, { type: "exchange", date: D, from_account_id: "rub-bank", to_account_id: "eur-bank", from_amount: 90000, to_amount: 900, fee_amount: 500, fee_currency: "RUB" });
        expect(r.ok).toBe(true);
        expect(await bal(env, "rub-bank")).toBe(9500);   // 100000 − 90000 − 500
        expect(await bal(env, "eur-bank")).toBe(1900);   // fee не с этого ведра
    });

    it("fee в валюте to (≠ from): уменьшает to-ведро", async () => {
        const { env } = makeWorld();
        const r = await createTransaction(env, { type: "exchange", date: D, from_account_id: "rub-bank", to_account_id: "eur-bank", from_amount: 90000, to_amount: 900, fee_amount: 10, fee_currency: "EUR" });
        expect(r.ok).toBe(true);
        expect(await bal(env, "rub-bank")).toBe(10000);
        expect(await bal(env, "eur-bank")).toBe(1890);   // 1000 + 900 − 10
    });

    it("fee в третьей валюте: балансы from/to не трогает (платящее ведро — не из пары)", async () => {
        const { env } = makeWorld();
        const r = await createTransaction(env, { type: "exchange", date: D, from_account_id: "rub-bank", to_account_id: "eur-bank", from_amount: 90000, to_amount: 900, fee_amount: 1, fee_currency: "USDT" });
        expect(r.ok).toBe(true);
        expect(await bal(env, "rub-bank")).toBe(10000);
        expect(await bal(env, "eur-bank")).toBe(1900);
    });

    it("fee без fee_currency → ошибка валидации", async () => {
        const { env } = makeWorld();
        const r = await createTransaction(env, { type: "exchange", date: D, from_account_id: "rub-bank", to_account_id: "eur-bank", from_amount: 1000, to_amount: 10, fee_amount: 5 });
        expect(r.ok).toBe(false);
    });
});

describe("updateTransaction", () => {
    async function withTx(env: any) {
        await createTransaction(env, { id: "t1", type: "exchange", date: D, from_account_id: "rub-bank", to_account_id: "eur-bank", from_amount: 90000, to_amount: 900, fee_amount: 500, fee_currency: "RUB" });
    }

    it("правка from_amount: overdraft считается с исключением старой версии tx", async () => {
        const { env } = makeWorld();
        await withTx(env);
        // 100000 доступно; старая tx (90000+500 fee) исключается из available → 99500 проходит.
        const r = await updateTransaction(env, "t1", { from_amount: 99000, to_amount: 990 });
        expect(r.ok).toBe(true);
        expect(await bal(env, "rub-bank")).toBe(500);    // 100000 − 99000 − 500 fee
        expect(await bal(env, "eur-bank")).toBe(1990);
    });

    it("fee_amount: null очищает fee (hasOwnProperty-паттерн), баланс восстанавливается", async () => {
        const { env } = makeWorld();
        await withTx(env);
        const r = await updateTransaction(env, "t1", { fee_amount: null, fee_currency: null });
        expect(r.ok).toBe(true);
        expect(await bal(env, "rub-bank")).toBe(10000);  // fee 500 больше не вычитается
    });

    it("PATCH без fee-полей fee не трогает", async () => {
        const { env } = makeWorld();
        await withTx(env);
        await updateTransaction(env, "t1", { note: "n" });
        expect(await bal(env, "rub-bank")).toBe(9500);
    });

    it("несуществующий id → not found", async () => {
        const { env } = makeWorld();
        const r = await updateTransaction(env, "ghost", { note: "x" });
        expect(r.ok).toBe(false);
    });

    it("структурная правка на невалидную пару (transfer разных валют) → отклонено", async () => {
        const { env } = makeWorld();
        await createTransaction(env, { id: "tt", type: "transfer", date: D, from_account_id: "eur-bank", to_account_id: "eur-cash", from_amount: 100, to_amount: 100 });
        const r = await updateTransaction(env, "tt", { to_account_id: "rub-bank" });
        expect(r.ok).toBe(false);
    });
});

describe("deleteTransaction", () => {
    it("soft-delete: балансы обоих вёдер возвращаются, из list исчезает", async () => {
        const { env } = makeWorld();
        await createTransaction(env, { id: "t1", type: "exchange", date: D, from_account_id: "rub-bank", to_account_id: "eur-bank", from_amount: 90000, to_amount: 900, fee_amount: 500, fee_currency: "RUB" });
        const r = await deleteTransaction(env, "t1");
        expect(r.deleted).toBe(true);
        expect(await bal(env, "rub-bank")).toBe(100000);
        expect(await bal(env, "eur-bank")).toBe(1000);
        expect(await listTransactions(env, {})).toHaveLength(0);
        expect((await deleteTransaction(env, "t1")).deleted).toBe(false);   // повторно — уже нет
    });
});
