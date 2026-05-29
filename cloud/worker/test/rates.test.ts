import { describe, it, expect } from "vitest";
import { RatesIndex } from "../src/rates";

/** Хелпер: индекс EUR→quote из пар [quote, date, rate]. */
function idx(points: Array<[string, string, number]>): RatesIndex {
    const r = new RatesIndex();
    for (const [q, d, rate] of points) r.add(q, d, rate);
    r.finalize();
    return r;
}

describe("RatesIndex.rateAt (date-aware, ближайший ≤ target)", () => {
    const r = idx([
        ["USD", "2024-01-01", 1.10],
        ["USD", "2024-06-01", 1.08],
        ["USD", "2025-01-01", 1.05],
    ]);

    it("EUR всегда = 1", () => {
        expect(r.rateAt("EUR", "2024-03-03")).toBe(1);
    });
    it("точная дата", () => {
        expect(r.rateAt("USD", "2024-06-01")).toBe(1.08);
    });
    it("между датами — берёт последний известный (date ≤ target)", () => {
        expect(r.rateAt("USD", "2024-03-15")).toBe(1.10);
        expect(r.rateAt("USD", "2024-12-31")).toBe(1.08);
        expect(r.rateAt("USD", "2030-01-01")).toBe(1.05);   // устаревший → последний, не 0
    });
    it("дата раньше первой котировки → null", () => {
        expect(r.rateAt("USD", "2023-01-01")).toBeNull();
    });
    it("неизвестная валюта → null", () => {
        expect(r.rateAt("XXX", "2024-06-01")).toBeNull();
    });
});

describe("RatesIndex.toEurAt", () => {
    const r = idx([["RUB", "2024-01-01", 100], ["USD", "2024-01-01", 1.25]]);

    it("делит на курс (1 EUR = rate × quote)", () => {
        expect(r.toEurAt(1000, "RUB", "2024-05-01")).toBe(10);   // 1000 RUB / 100
        expect(r.toEurAt(100, "USD", "2024-05-01")).toBe(80);    // 100 USD / 1.25
    });
    it("EUR → сам себя", () => {
        expect(r.toEurAt(42, "EUR", "2024-05-01")).toBe(42);
    });
    it("нет курса (валюта/дата) → null, не 0", () => {
        expect(r.toEurAt(1000, "RUB", "2023-01-01")).toBeNull();
        expect(r.toEurAt(1000, "TRY", "2024-05-01")).toBeNull();
    });
});

describe("RatesIndex.convertAt (from → to через EUR)", () => {
    const r = idx([["USD", "2024-01-01", 1.25], ["RUB", "2024-01-01", 100]]);

    it("одинаковые валюты → без конверсии", () => {
        expect(r.convertAt(50, "USD", "USD", "2024-05-01")).toBe(50);
    });
    it("to == EUR → как toEurAt", () => {
        expect(r.convertAt(100, "USD", "EUR", "2024-05-01")).toBe(80);
    });
    it("from == EUR → умножает на курс to", () => {
        expect(r.convertAt(10, "EUR", "RUB", "2024-05-01")).toBe(1000);
    });
    it("USD → RUB через EUR", () => {
        // 100 USD → 80 EUR → 8000 RUB
        expect(r.convertAt(100, "USD", "RUB", "2024-05-01")).toBe(8000);
    });
    it("любой отсутствующий курс → null", () => {
        expect(r.convertAt(100, "USD", "TRY", "2024-05-01")).toBeNull();
        expect(r.convertAt(100, "XXX", "RUB", "2024-05-01")).toBeNull();
    });
});

describe("RatesIndex.latestDate", () => {
    it("максимальная дата по всем валютам", () => {
        const r = idx([["USD", "2024-01-01", 1.1], ["RUB", "2025-03-03", 95]]);
        expect(r.latestDate()).toBe("2025-03-03");
    });
    it("пустой индекс → null", () => {
        expect(new RatesIndex().latestDate()).toBeNull();
    });
});
