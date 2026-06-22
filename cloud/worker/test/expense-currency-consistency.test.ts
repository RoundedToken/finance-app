/**
 * SPEC-032: согласованность валюта↔счёт при создании/правке траты. Трата со счётом
 * обязана быть в native-валюте ведра (баланс вычитается в ней, SPEC-011). Сервер
 * отклоняет немаркированное рассогласование; осознанный override (allow_currency_mismatch)
 * проходит; трата без счёта не проверяется.
 */
import { describe, it, expect } from "vitest";
import { createExpense, updateExpense } from "../src/db";
import { makeEnv, seed } from "./d1-mock";

function envWithAccounts() {
    const { env, d1 } = makeEnv();
    seed(d1, {
        accounts: [
            { id: "rsd-bank", currency: "RSD", name: "RSD · банк" },
            { id: "rub-bank", currency: "RUB", name: "RUB · банк" },
        ],
    });
    return { env, d1 };
}

describe("createExpense — валюта↔счёт (SPEC-032)", () => {
    it("match: валюта = валюте счёта → ok, вставлено", async () => {
        const { env } = envWithAccounts();
        const r = await createExpense(env, "u", { id: "e1", date: "2026-06-07", account_id: "rsd-bank", amount: 100, currency: "RSD" });
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.inserted).toBe(true);
    });

    it("mismatch без флага: RSD на RUB-счёте → отклонено (ok:false, понятный текст)", async () => {
        const { env } = envWithAccounts();
        const r = await createExpense(env, "u", { id: "e2", date: "2026-06-07", account_id: "rub-bank", amount: 999, currency: "RSD" });
        expect(r.ok).toBe(false);
        if (!r.ok) {
            expect(r.error).toContain("не совпадает");
            expect(r.error).toContain("RSD");
            expect(r.error).toContain("RUB");
            expect(r.error).toContain("RUB · банк");
        }
    });

    it("mismatch с осознанным override → ok", async () => {
        const { env } = envWithAccounts();
        const r = await createExpense(env, "u", { id: "e3", date: "2026-06-07", account_id: "rub-bank", amount: 999, currency: "RSD", allow_currency_mismatch: true });
        expect(r.ok).toBe(true);
    });

    it("без счёта (account_id=null): валюта свободна, проверки нет", async () => {
        const { env } = envWithAccounts();
        const r = await createExpense(env, "u", { id: "e4", date: "2026-06-07", account_id: null, amount: 50, currency: "EUR" });
        expect(r.ok).toBe(true);
    });

    it("несуществующее ведро не блокирует (первичный flow): ok", async () => {
        const { env } = envWithAccounts();
        const r = await createExpense(env, "u", { id: "e5", date: "2026-06-07", account_id: "ghost", amount: 10, currency: "EUR" });
        expect(r.ok).toBe(true);
    });
});

describe("updateExpense — валюта↔счёт (SPEC-032)", () => {
    function envWithExpense() {
        const { env, d1 } = envWithAccounts();
        seed(d1, { expenses: [{ id: "x1", date: "2026-06-07", account_id: "rsd-bank", amount: 100, currency: "RSD", user_id: "u" }] });
        return { env, d1 };
    }

    it("смена счёта на разно-валютный без флага → отклонено", async () => {
        const { env } = envWithExpense();
        const r = await updateExpense(env, "x1", "u", { account_id: "rub-bank" });   // currency остаётся RSD
        expect(r.ok).toBe(false);
    });

    it("смена счёта на разно-валютный с override → ok", async () => {
        const { env } = envWithExpense();
        const r = await updateExpense(env, "x1", "u", { account_id: "rub-bank", allow_currency_mismatch: true });
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.updated).toBe(true);
    });

    it("смена только валюты в рассогласование с текущим счётом без флага → отклонено", async () => {
        const { env } = envWithExpense();
        const r = await updateExpense(env, "x1", "u", { currency: "EUR" });   // счёт остаётся rsd-bank (RSD)
        expect(r.ok).toBe(false);
    });

    it("патч не трогающий валюту/счёт (например note) при согласованной записи → ok", async () => {
        const { env } = envWithExpense();
        const r = await updateExpense(env, "x1", "u", { note: "обновил" });
        expect(r.ok).toBe(true);
    });
});
