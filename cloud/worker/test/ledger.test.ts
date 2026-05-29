import { describe, it, expect } from "vitest";
import { roundMoney, reconstructBalance, feePayerBucket } from "../src/ledger";

describe("roundMoney", () => {
    it("убирает классический float-дребезг 0.1+0.2", () => {
        expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    });
    it("сохраняет 2 знака фиата и 8 знаков крипты", () => {
        expect(roundMoney(1234.56)).toBe(1234.56);
        expect(roundMoney(0.00000001)).toBe(0.00000001);
    });
    it("гасит накопленную ошибку суммирования", () => {
        let s = 0;
        for (let i = 0; i < 10; i++) s += 0.1;   // 0.9999999999999999
        expect(roundMoney(s)).toBe(1);
    });
});

describe("reconstructBalance (SPEC-011, семантика «конец дня»)", () => {
    it("baseline + события строго ПОСЛЕ даты baseline", () => {
        const events = [
            { date: "2026-01-09", delta: +20 },  // до baseline → исключить
            { date: "2026-01-10", delta: +50 },  // день baseline → исключить (конец дня)
            { date: "2026-01-11", delta: -30 },  // после → учесть
            { date: "2026-02-20", delta: -5 },   // после asOf → исключить
        ];
        expect(reconstructBalance(100, "2026-01-10", events, "2026-01-31")).toBe(70);
    });

    it("без baseline (date 0000-01-01) — суммирует с нуля все события ≤ asOf", () => {
        const events = [
            { date: "2024-01-01", delta: +100 },
            { date: "2024-02-01", delta: -30 },   // после asOf
        ];
        expect(reconstructBalance(0, "0000-01-01", events, "2024-01-15")).toBe(100);
    });

    it("событие ровно в asOf — включается", () => {
        expect(reconstructBalance(0, "0000-01-01", [{ date: "2024-05-10", delta: 42 }], "2024-05-10")).toBe(42);
    });

    it("округляет результат (ADR-015)", () => {
        const events = [{ date: "2024-01-02", delta: 0.1 }, { date: "2024-01-03", delta: 0.2 }];
        expect(reconstructBalance(0, "0000-01-01", events, "2024-12-31")).toBe(0.3);
    });

    it("порядок событий не важен", () => {
        const a = [{ date: "2024-03-02", delta: 5 }, { date: "2024-03-01", delta: 10 }];
        const b = [{ date: "2024-03-01", delta: 10 }, { date: "2024-03-02", delta: 5 }];
        expect(reconstructBalance(0, "0000-01-01", a, "2024-12-31"))
            .toBe(reconstructBalance(0, "0000-01-01", b, "2024-12-31"));
    });
});

describe("feePayerBucket (L2)", () => {
    const base = { from_account_id: "eur-cash", to_account_id: "usdt", from_currency: "EUR", to_currency: "USDT" };

    it("fee в валюте from → платит from", () => {
        expect(feePayerBucket({ ...base, fee_currency: "EUR", fee_amount: 2 })).toBe("eur-cash");
    });
    it("fee в валюте to → платит to", () => {
        expect(feePayerBucket({ ...base, fee_currency: "USDT", fee_amount: 1 })).toBe("usdt");
    });
    it("fee в третьей валюте → не атрибутируется", () => {
        expect(feePayerBucket({ ...base, fee_currency: "RUB", fee_amount: 5 })).toBeNull();
    });
    it("transfer (одна валюта) → приоритет from, нет двойного списания", () => {
        expect(feePayerBucket({
            from_account_id: "rsd-bank", to_account_id: "rsd-cash",
            from_currency: "RSD", to_currency: "RSD", fee_currency: "RSD", fee_amount: 10,
        })).toBe("rsd-bank");
    });
    it("нет fee / нулевая / без валюты → null", () => {
        expect(feePayerBucket({ ...base, fee_currency: null, fee_amount: null })).toBeNull();
        expect(feePayerBucket({ ...base, fee_currency: "EUR", fee_amount: 0 })).toBeNull();
        expect(feePayerBucket({ ...base, fee_currency: null, fee_amount: 3 })).toBeNull();
    });
});
