/**
 * QA-02 (SPEC-046): golden-тесты чистой математики экрана «Статистика» (SPEC-036).
 * До этого клиентская денежная агрегация Mini App не покрывалась ни одним автотестом.
 * Ожидаемые значения посчитаны вручную (разложение по слагаемым — в комментариях).
 */
import { describe, it, expect } from "vitest";
import type { Expense } from "@/api/types";
import {
    filterByPeriod, aggregate, buildPalette, periodRange, daysInclusive,
    avgPerDay, computeDelta, buildTrend, axisTickIndices, prevPeriod,
    drillItems, drillSumEur, periodPrefix, daysInMonth,
    CHART_PALETTE, CHART_TAIL, TOP_N, MONTHS_SHORT,
} from "./stats";

/** Фикстура траты: только значимые поля, остальное — валидные заглушки. */
function exp(
    id: string, date: string, amountEur: number | null, categoryId: string | null,
    createdAt = `${date} 12:00:00`,
): Expense {
    return {
        id, date, account_id: null, amount: amountEur ?? 1, currency: "EUR",
        amount_eur: amountEur, category_id: categoryId, note: null,
        source: "test", created_at: createdAt,
    };
}

// Golden-мир: июнь 2026 + границы (31 мая / 1 июля) + прошлый год + missing-rate.
const WORLD: Expense[] = [
    exp("e1", "2026-06-01", 10, "food"),          // первый день месяца — входит
    exp("e2", "2026-06-30", 5, "food"),           // последний день месяца — входит
    exp("e3", "2026-06-15", 20, "taxi"),
    exp("e4", "2026-06-15", 2.5, null),           // без категории
    exp("e5", "2026-05-31", 100, "food"),         // канун месяца — НЕ входит в июнь
    exp("e6", "2026-07-01", 200, "food"),         // день после — НЕ входит в июнь
    exp("e7", "2026-06-20", null, "taxi"),        // без курса (amount_eur=null)
    exp("e8", "2025-06-10", 50, "food"),          // прошлый год
];

describe("filterByPeriod — границы периодов", () => {
    it("month: первый и последний день месяца входят, соседние дни — нет", () => {
        const ids = filterByPeriod(WORLD, "month", 2026, 5).map(e => e.id);
        expect(ids).toEqual(["e1", "e2", "e3", "e4", "e7"]);   // без e5 (май), e6 (июль), e8 (2025)
    });
    it("year: весь 2026, без 2025", () => {
        const ids = filterByPeriod(WORLD, "year", 2026, 0).map(e => e.id).sort();
        expect(ids).toEqual(["e1", "e2", "e3", "e4", "e5", "e6", "e7"]);
    });
    it("all: весь набор без фильтра", () => {
        expect(filterByPeriod(WORLD, "all", 2026, 5)).toHaveLength(8);
    });
    it("periodPrefix: month → YYYY-MM, year → YYYY, all → null", () => {
        expect(periodPrefix("month", 2026, 5)).toBe("2026-06");
        expect(periodPrefix("year", 2026, 5)).toBe("2026");
        expect(periodPrefix("all", 2026, 5)).toBeNull();
    });
});

describe("aggregate — KPI-агрегация", () => {
    it("месяц: total/byCat/byDate точно; missing не теряется молча", () => {
        const agg = aggregate(filterByPeriod(WORLD, "month", 2026, 5));
        expect(agg.total).toBe(37.5);              // 10 + 5 + 20 + 2.5
        expect(agg.count).toBe(5);                 // ВКЛЮЧАЯ трату без курса (e7)
        expect(agg.missing).toBe(1);               // e7 явно посчитана в missing
        expect(agg.byCat.get("food")).toBe(15);    // 10 + 5
        expect(agg.byCat.get("taxi")).toBe(20);    // e7 (null) в сумму не входит
        expect(agg.byCat.get(null)).toBe(2.5);
        expect(agg.byDate.get("2026-06-15")).toBe(22.5);   // 20 + 2.5
        expect(agg.byDate.get("2026-06-20")).toBeUndefined();  // только missing-день → нет суммы
    });
    it("год: 337.5 = 37.5 (июнь) + 100 (май) + 200 (июль)", () => {
        const agg = aggregate(filterByPeriod(WORLD, "year", 2026, 0));
        expect(agg.total).toBe(337.5);
        expect(agg.count).toBe(7);
        expect(agg.missing).toBe(1);
    });
    it("всё время: 387.5 (плюс 50 из 2025)", () => {
        const agg = aggregate(WORLD);
        expect(agg.total).toBe(387.5);
        expect(agg.count).toBe(8);
    });
    it("пустой набор → нули, пустые map'ы", () => {
        const agg = aggregate([]);
        expect(agg.total).toBe(0);
        expect(agg.count).toBe(0);
        expect(agg.missing).toBe(0);
        expect(agg.byCat.size).toBe(0);
        expect(agg.byDate.size).toBe(0);
    });
    it("набор целиком без курса → total 0, но count/missing его видят", () => {
        const agg = aggregate([exp("x", "2026-06-01", null, "food")]);
        expect(agg.total).toBe(0);
        expect(agg.count).toBe(1);
        expect(agg.missing).toBe(1);
    });
});

describe("prevPeriod — переход через год", () => {
    it("январь → декабрь прошлого года", () => {
        expect(prevPeriod("month", 2026, 0)).toEqual({ year: 2025, month: 11 });
    });
    it("обычный месяц → минус один", () => {
        expect(prevPeriod("month", 2026, 5)).toEqual({ year: 2026, month: 4 });
    });
    it("год → минус один год", () => {
        expect(prevPeriod("year", 2026, 5)).toEqual({ year: 2025, month: 5 });
    });
});

describe("periodRange / daysInMonth / daysInclusive", () => {
    it("month: июнь → 01..30; февраль невисокосный → 28; високосный → 29", () => {
        expect(periodRange("month", 2026, 5, WORLD, "2026-06-20")).toEqual({ from: "2026-06-01", to: "2026-06-30" });
        expect(daysInMonth(2026, 1)).toBe(28);
        expect(daysInMonth(2028, 1)).toBe(29);
        expect(periodRange("month", 2028, 1, [], "2028-02-10").to).toBe("2028-02-29");
    });
    it("year: календарный год", () => {
        expect(periodRange("year", 2026, 5, WORLD, "2026-06-20")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    });
    it("all: min..max дат набора; пустой набор → today..today (E3)", () => {
        expect(periodRange("all", 2026, 5, WORLD, "2026-06-20")).toEqual({ from: "2025-06-10", to: "2026-07-01" });
        expect(periodRange("all", 2026, 5, [], "2026-06-20")).toEqual({ from: "2026-06-20", to: "2026-06-20" });
    });
    it("daysInclusive: включительно с обеих сторон", () => {
        expect(daysInclusive("2026-06-01", "2026-06-30")).toBe(30);
        expect(daysInclusive("2026-06-01", "2026-06-01")).toBe(1);
    });
});

describe("avgPerDay — прошедшие дни для in-progress периода", () => {
    it("прошлый месяц: делим на всю длину (37.5 / 30)", () => {
        const range = { from: "2026-06-01", to: "2026-06-30" };
        expect(avgPerDay(37.5, range, "2026-07-15")).toBe(1.25);
    });
    it("текущий месяц: делим на прошедшие дни (37.5 / 20 на 20 июня)", () => {
        const range = { from: "2026-06-01", to: "2026-06-30" };
        expect(avgPerDay(37.5, range, "2026-06-20")).toBe(1.875);
    });
});

describe("computeDelta", () => {
    it("рост/падение/флэт/new/нет прошлого", () => {
        const up = computeDelta(110, 100);
        expect(up?.kind).toBe("up");
        if (up?.kind === "up") expect(up.pct).toBeCloseTo(10, 10);
        const down = computeDelta(90, 100);
        expect(down?.kind).toBe("down");
        if (down?.kind === "down") expect(down.pct).toBeCloseTo(10, 10);
        expect(computeDelta(100.4, 100)).toEqual({ kind: "flat" });    // |0.4%| < 0.5
        expect(computeDelta(50, 0)).toEqual({ kind: "new" });
        expect(computeDelta(0, 0)).toBeNull();
        expect(computeDelta(100, null)).toBeNull();
    });
});

describe("buildTrend", () => {
    const todayJune = "2026-06-20";

    it("month: бин на каждый день, суммы на своих местах, isToday, avg по прошедшим", () => {
        const filtered = filterByPeriod(WORLD, "month", 2026, 5);
        const agg = aggregate(filtered);
        const range = periodRange("month", 2026, 5, WORLD, todayJune);
        const t = buildTrend(agg, "month", range, todayJune);
        expect(t.byMonth).toBe(false);
        expect(t.bins).toHaveLength(30);
        expect(t.bins[0].sum).toBe(10);            // 06-01
        expect(t.bins[14].sum).toBe(22.5);         // 06-15: 20 + 2.5
        expect(t.bins[29].sum).toBe(5);            // 06-30
        expect(t.bins[19].isToday).toBe(true);     // 06-20
        expect(t.max).toBe(22.5);
        expect(t.avg).toBe(37.5 / 20);             // elapsed = 20 дней
    });

    it("year: 12 бинов по месяцам, июльская трата в max, elapsed = 6", () => {
        const filtered = filterByPeriod(WORLD, "year", 2026, 0);
        const agg = aggregate(filtered);
        const range = periodRange("year", 2026, 0, WORLD, todayJune);
        const t = buildTrend(agg, "year", range, todayJune);
        expect(t.byMonth).toBe(true);
        expect(t.bins).toHaveLength(12);
        expect(t.bins.map(b => b.label)).toEqual(MONTHS_SHORT);
        expect(t.bins[4].sum).toBe(100);           // май
        expect(t.bins[5].sum).toBe(37.5);          // июнь
        expect(t.bins[6].sum).toBe(200);           // июль (будущее — в бинах, не в elapsed)
        expect(t.bins[5].isToday).toBe(true);
        expect(t.max).toBe(200);
        expect(t.avg).toBe(337.5 / 6);             // elapsed: янв..июн
    });

    it("all: месячные бины от min до max с годом в подписи", () => {
        const agg = aggregate(WORLD);
        const range = periodRange("all", 2026, 0, WORLD, todayJune);
        const t = buildTrend(agg, "all", range, todayJune);
        expect(t.bins).toHaveLength(14);           // 2025-06 .. 2026-07
        expect(t.bins[0].key).toBe("2025-06");
        expect(t.bins[0].label).toBe("июн '25");
        expect(t.bins[0].sum).toBe(50);
        expect(t.bins[13].key).toBe("2026-07");
        expect(t.bins[13].sum).toBe(200);
    });
});

describe("buildPalette — топ-N и хвост", () => {
    it("сортировка по убыванию, топ получает цвета палитры, хвост — CHART_TAIL", () => {
        const byCat = new Map<string | null, number>();
        for (let i = 0; i < TOP_N + 2; i++) byCat.set(`c${i}`, 100 - i);   // c0=100 … c9=91
        const p = buildPalette(byCat);
        expect(p.items[0]).toEqual(["c0", 100]);
        expect(p.topIds).toHaveLength(TOP_N);
        expect(p.colorByCat.get("c0")).toBe(CHART_PALETTE[0]);
        expect(p.colorByCat.get(`c${TOP_N}`)).toBe(CHART_TAIL);       // за пределами топа
        expect(p.colorByCat.get(`c${TOP_N + 1}`)).toBe(CHART_TAIL);
    });
    it("пустой byCat → пустая палитра", () => {
        const p = buildPalette(new Map());
        expect(p.items).toEqual([]);
        expect(p.topIds).toEqual([]);
    });
});

describe("drill-down по категории", () => {
    const filtered = filterByPeriod(WORLD, "month", 2026, 5);

    it("food: только свои траты, новые сверху, сумма точная", () => {
        const items = drillItems(filtered, "food");
        expect(items.map(e => e.id)).toEqual(["e2", "e1"]);   // 06-30 → 06-01
        expect(drillSumEur(items)).toBe(15);
    });
    it("null-категория: отдельный срез «Без категории»", () => {
        const items = drillItems(filtered, null);
        expect(items.map(e => e.id)).toEqual(["e4"]);
        expect(drillSumEur(items)).toBe(2.5);
    });
    it("трата без курса в списке видна, в сумме — 0 (missing сигналит KPI)", () => {
        const items = drillItems(filtered, "taxi");
        expect(items.map(e => e.id)).toEqual(["e7", "e3"]);   // 06-20 → 06-15
        expect(drillSumEur(items)).toBe(20);
    });
    it("одинаковая дата: tie-break по created_at desc", () => {
        const sameDay = [
            exp("a", "2026-06-10", 1, "x", "2026-06-10 08:00:00"),
            exp("b", "2026-06-10", 2, "x", "2026-06-10 09:00:00"),
        ];
        expect(drillItems(sameDay, "x").map(e => e.id)).toEqual(["b", "a"]);
    });
    it("пустой период → пусто", () => {
        expect(drillItems([], "food")).toEqual([]);
        expect(drillSumEur([])).toBe(0);
    });
});

describe("axisTickIndices", () => {
    it("month (30 бинов) → 5 равномерных тиков; year (12) → 6; n=1 → [0]", () => {
        expect(axisTickIndices(30, "month")).toEqual([0, 7, 15, 22, 29]);
        expect(axisTickIndices(12, "year")).toEqual([0, 2, 4, 7, 9, 11]);
        expect(axisTickIndices(1, "all")).toEqual([0]);
    });
});
