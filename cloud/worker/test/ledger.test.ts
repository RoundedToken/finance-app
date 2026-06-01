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

describe("reconstructBalance (SPEC-011/024, tie-break по created_at внутри дня)", () => {
    const BASE_CA = "2026-01-10 12:00:00";   // created_at снапшота-baseline

    it("дата — главный ключ; created_at решает ТОЛЬКО ничью при равной дате", () => {
        const events = [
            { date: "2026-01-09", createdAt: "2026-01-09 23:59:00", delta: +20 },  // до даты baseline → исключить (даже если created позже)
            { date: "2026-01-10", createdAt: "2026-01-10 08:00:00", delta: +50 },  // день baseline, ДО снапшота → исключить (уже в снапшоте)
            { date: "2026-01-10", createdAt: "2026-01-10 18:00:00", delta: +7 },   // день baseline, ПОСЛЕ снапшота → учесть
            { date: "2026-01-11", createdAt: "2026-01-11 09:00:00", delta: -30 },  // после даты → учесть
            { date: "2026-02-20", createdAt: "2026-02-20 09:00:00", delta: -5 },   // после asOf → исключить
        ];
        expect(reconstructBalance(100, "2026-01-10", BASE_CA, events, "2026-01-31")).toBe(77);  // 100 +7 −30
    });

    it("created_at == created_at снапшота → не учитывается (строгое >)", () => {
        const events = [{ date: "2026-01-10", createdAt: BASE_CA, delta: +50 }];
        expect(reconstructBalance(100, "2026-01-10", BASE_CA, events, "2026-12-31")).toBe(100);
    });

    it("без baseline (date 0000-01-01, created_at '') — суммирует с нуля все события ≤ asOf", () => {
        const events = [
            { date: "2024-01-01", createdAt: "2024-01-01 10:00:00", delta: +100 },
            { date: "2024-02-01", createdAt: "2024-02-01 10:00:00", delta: -30 },   // после asOf
        ];
        expect(reconstructBalance(0, "0000-01-01", "", events, "2024-01-15")).toBe(100);
    });

    it("событие ровно в asOf — включается", () => {
        expect(reconstructBalance(0, "0000-01-01", "", [{ date: "2024-05-10", createdAt: "2024-05-10 10:00:00", delta: 42 }], "2024-05-10")).toBe(42);
    });

    it("округляет результат (ADR-015)", () => {
        const events = [
            { date: "2024-01-02", createdAt: "2024-01-02 10:00:00", delta: 0.1 },
            { date: "2024-01-03", createdAt: "2024-01-03 10:00:00", delta: 0.2 },
        ];
        expect(reconstructBalance(0, "0000-01-01", "", events, "2024-12-31")).toBe(0.3);
    });

    it("порядок событий в массиве не важен (сумма коммутативна)", () => {
        const a = [
            { date: "2024-03-02", createdAt: "2024-03-02 10:00:00", delta: 5 },
            { date: "2024-03-01", createdAt: "2024-03-01 10:00:00", delta: 10 },
        ];
        const b = [...a].reverse();
        expect(reconstructBalance(0, "0000-01-01", "", a, "2024-12-31"))
            .toBe(reconstructBalance(0, "0000-01-01", "", b, "2024-12-31"));
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
