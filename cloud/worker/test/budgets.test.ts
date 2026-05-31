import { describe, it, expect } from "vitest";
import { RatesIndex } from "../src/rates";
import {
    budgetStatus,
    computeBudgetProgress,
    type BudgetRow,
    type ExpenseLite,
} from "../src/budgets";

/** Индекс EUR→quote из пар [quote, date, rate]. */
function idx(points: Array<[string, string, number]>): RatesIndex {
    const r = new RatesIndex();
    for (const [q, d, rate] of points) r.add(q, d, rate);
    r.finalize();
    return r;
}

// Курсы: RUB 100/EUR (с 2024), USD 1.25/EUR.
const rates = idx([
    ["RUB", "2024-01-01", 100],
    ["RUB", "2026-05-01", 125],
    ["USD", "2024-01-01", 1.25],
]);

describe("budgetStatus (пороги good/warn/over)", () => {
    it("good — потрачено < 80% лимита", () => {
        expect(budgetStatus(79, 100)).toBe("good");
        expect(budgetStatus(0, 100)).toBe("good");
    });
    it("warn — 80% .. ровно лимит", () => {
        expect(budgetStatus(80, 100)).toBe("warn");
        expect(budgetStatus(100, 100)).toBe("warn");   // ровно на грани = warn, не over
    });
    it("over — строго больше лимита", () => {
        expect(budgetStatus(101, 100)).toBe("over");
        expect(budgetStatus(250, 100)).toBe("over");
    });
});

describe("computeBudgetProgress — окно месяца", () => {
    const budgets: BudgetRow[] = [
        { id: "b-food", scope: "category", category_id: "food", limit_eur: 300, name: "Еда", emoji: "🍔", color: "#ef4444" },
    ];

    it("учитывает только траты текущего месяца (границы включительно)", () => {
        const exp: ExpenseLite[] = [
            { date: "2026-04-30", amount: 10000, currency: "RUB", category_id: "food" }, // прошлый месяц → вне
            { date: "2026-05-01", amount: 12500, currency: "RUB", category_id: "food" }, // 125 RUB/EUR → 100 €
            { date: "2026-05-31", amount: 12500, currency: "RUB", category_id: "food" }, // → 100 €
            { date: "2026-06-01", amount: 12500, currency: "RUB", category_id: "food" }, // следующий месяц → вне
        ];
        const res = computeBudgetProgress(budgets, exp, rates, "2026-05");
        expect(res.month).toBe("2026-05");
        expect(res.categories).toHaveLength(1);
        expect(res.categories[0].spent_eur).toBe(200);       // 100 + 100
        expect(res.categories[0].remaining_eur).toBe(100);   // 300 − 200
        expect(res.categories[0].pct).toBe(67);              // round(200/300*100)
        expect(res.categories[0].status).toBe("good");       // 200 < 0.8*300=240
    });

    it("пустой месяц → spent 0, статус good", () => {
        const res = computeBudgetProgress(budgets, [], rates, "2026-05");
        expect(res.categories[0].spent_eur).toBe(0);
        expect(res.categories[0].remaining_eur).toBe(300);
        expect(res.categories[0].pct).toBe(0);
        expect(res.categories[0].status).toBe("good");
    });

    it("превышение → remaining отрицательный, статус over", () => {
        const exp: ExpenseLite[] = [
            { date: "2026-05-10", amount: 50000, currency: "RUB", category_id: "food" }, // 50000/125 = 400 €
        ];
        const res = computeBudgetProgress(budgets, exp, rates, "2026-05");
        expect(res.categories[0].spent_eur).toBe(400);
        expect(res.categories[0].remaining_eur).toBe(-100);
        expect(res.categories[0].pct).toBe(133);
        expect(res.categories[0].status).toBe("over");
    });
});

describe("computeBudgetProgress — date-aware конверсия (поток)", () => {
    it("трата в RUB конвертится по курсу СВОЕЙ даты, не latest", () => {
        const budgets: BudgetRow[] = [
            { id: "b", scope: "category", category_id: "food", limit_eur: 1000, name: "Еда" },
        ];
        // та же сумма RUB в разные месяцы → разный EUR (курс рос 100→125)
        const janRates = idx([["RUB", "2024-01-01", 100]]);
        const exp: ExpenseLite[] = [
            { date: "2024-01-15", amount: 10000, currency: "RUB", category_id: "food" }, // /100 = 100 €
        ];
        const res = computeBudgetProgress(budgets, exp, janRates, "2024-01");
        expect(res.categories[0].spent_eur).toBe(100);
    });
});

describe("computeBudgetProgress — missing rates", () => {
    it("трата без курса на дату пропускается и считается в missing_rates (категория + total)", () => {
        const budgets: BudgetRow[] = [
            { id: "b-food", scope: "category", category_id: "food", limit_eur: 300, name: "Еда" },
            { id: "b-total", scope: "total", category_id: null, limit_eur: 1000 },
        ];
        const exp: ExpenseLite[] = [
            { date: "2026-05-05", amount: 12500, currency: "RUB", category_id: "food" }, // 100 €
            { date: "2026-05-06", amount: 100, currency: "TRY", category_id: "food" },   // нет курса TRY → null
            { date: "2026-05-07", amount: 200, currency: "GBP", category_id: "food" },   // нет курса GBP → null
        ];
        const res = computeBudgetProgress(budgets, exp, rates, "2026-05");
        expect(res.categories[0].spent_eur).toBe(100);
        expect(res.categories[0].missing_rates).toBe(2);
        expect(res.total?.spent_eur).toBe(100);
        expect(res.total?.missing_rates).toBe(2);
    });
});

describe("computeBudgetProgress — общий потолок (scope='total')", () => {
    it("суммирует ВСЕ траты месяца, включая uncategorized", () => {
        const budgets: BudgetRow[] = [
            { id: "b-total", scope: "total", category_id: null, limit_eur: 500 },
            { id: "b-food", scope: "category", category_id: "food", limit_eur: 100, name: "Еда" },
        ];
        const exp: ExpenseLite[] = [
            { date: "2026-05-02", amount: 12500, currency: "RUB", category_id: "food" }, // 100 €
            { date: "2026-05-03", amount: 25000, currency: "RUB", category_id: "transport" }, // 200 €
            { date: "2026-05-04", amount: 12500, currency: "RUB", category_id: null }, // 100 € uncategorized
        ];
        const res = computeBudgetProgress(budgets, exp, rates, "2026-05");
        expect(res.total?.spent_eur).toBe(400);            // 100 + 200 + 100
        expect(res.total?.status).toBe("warn");            // 400 >= 0.8*500=400
        const food = res.categories.find(c => c.category_id === "food")!;
        expect(food.spent_eur).toBe(100);                  // только food
        expect(food.status).toBe("warn");                  // 100 >= 0.8*100 (ровно лимит)
    });
});
