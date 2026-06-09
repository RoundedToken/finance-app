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

describe("RatesIndex tick-aware rateAt (SPEC-028: свежесть по времени фетча)", () => {
    function idxWithTick(): RatesIndex {
        const r = new RatesIndex();
        r.add("ETH", "2026-06-05", 1 / 1500);              // дневной historical
        r.add("ETH", "2026-06-07", 1 / 1400);              // последний дневной (закрытие)
        r.addTick("ETH", "2026-06-09 12:00:00", 1 / 1450); // свежий внутридневной тик
        r.finalize();
        return r;
    }

    it("today (≥ последней дневной даты) → свежий тик, не дневное закрытие", () => {
        expect(idxWithTick().rateAt("ETH", "2026-06-09")).toBeCloseTo(1 / 1450, 10);
    });
    it("дата == последней дневной → тик (граница >=)", () => {
        expect(idxWithTick().rateAt("ETH", "2026-06-07")).toBeCloseTo(1 / 1450, 10);
    });
    it("прошлая дата (< последней дневной) → дневной historical, тик не влияет", () => {
        const r = idxWithTick();
        expect(r.rateAt("ETH", "2026-06-06")).toBeCloseTo(1 / 1500, 10);  // 06-05 ≤ 06-06
        expect(r.rateAt("ETH", "2026-06-05")).toBeCloseTo(1 / 1500, 10);
    });
    it("нет тика → обычный дневной (E2 fallback)", () => {
        const r = new RatesIndex();
        r.add("ETH", "2026-06-07", 1 / 1400);
        r.finalize();
        expect(r.rateAt("ETH", "2026-06-09")).toBeCloseTo(1 / 1400, 10);
    });
    it("только тик, нет дневных → тик", () => {
        const r = new RatesIndex();
        r.addTick("ETH", "2026-06-09 12:00:00", 1 / 1450);
        r.finalize();
        expect(r.rateAt("ETH", "2026-06-09")).toBeCloseTo(1 / 1450, 10);
    });
    it("addTick держит последний по fetched_at (порядок вставки неважен)", () => {
        const r = new RatesIndex();
        r.add("ETH", "2026-06-07", 1 / 1400);
        r.addTick("ETH", "2026-06-09 06:00:00", 1 / 1500);
        r.addTick("ETH", "2026-06-09 18:00:00", 1 / 1460);   // новее → побеждает
        r.addTick("ETH", "2026-06-09 12:00:00", 1 / 1480);   // старее → игнор
        r.finalize();
        expect(r.rateAt("ETH", "2026-06-09")).toBeCloseTo(1 / 1460, 10);
    });
    it("фиат тиков не имеет → дневной даже на today (не затронут крипто-тиком)", () => {
        const r = new RatesIndex();
        r.add("USD", "2026-06-07", 1.08);
        r.addTick("ETH", "2026-06-09 12:00:00", 1 / 1450);
        r.finalize();
        expect(r.rateAt("USD", "2026-06-09")).toBe(1.08);
    });
    it("toEurAt стоимости 'сейчас' идёт по тику (mark-to-market)", () => {
        // 2 ETH сейчас → 2 × 1450 = 2900 EUR (тик), а не 2 × 1400 (дневное закрытие)
        expect(idxWithTick().toEurAt(2, "ETH", "2026-06-09")).toBeCloseTo(2900, 6);
    });
});
