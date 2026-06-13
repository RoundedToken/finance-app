/**
 * SPEC-025 / ADR-020: вклад в цель — поток (date-aware), а не псевдо-запас.
 * D1-mock vitest (инфраструктура SPEC-022) против реального SQLite.
 *
 * Покрывает AC1–AC7:
 *  • вклад конвертируется в target_currency по курсу НА ДАТУ вклада, фиксируется
 *    и не зависит от сегодняшнего курса (AC1);
 *  • обмен валюты не меняет баланс цели — listGoals не читает transactions (AC2/AC3);
 *  • free = net − targeted − invested возвращается без клампа, может быть < 0 (AC4);
 *  • getGoalDetail.delta_in_target фиксируется по дате каждой строки (AC5);
 *  • вклад на дату без курса (нет ≤-fallback) → balance_missing_rates++ (AC6);
 *  • валюта вклада == target_currency → identity, дата не важна (AC7).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { listGoals, getGoalDetail } from "../src/goals";
import { getDashboard } from "../src/dashboard";
import { makeEnv, seed } from "./d1-mock";

const TODAY = "2026-06-13";

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
});
afterEach(() => vi.useRealTimers());

describe("listGoals · вклад = поток (SPEC-025)", () => {
    it("AC1: вклад 1000 RUB → цель (EUR) фиксируется по курсу на дату вклада, а не сегодня", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [{ id: "a1", currency: "RUB" }],
            goals: [{ id: "g1", name: "ипотека", target_currency: "EUR" }],
            incomes: [
                { id: "i1", goal_id: "g1", date: "2024-01-01", account_id: "a1", amount: 1000, currency_code: "RUB" },
            ],
            rates: [
                { date: "2024-01-01", quote: "RUB", rate: 100 },   // на дату вклада: 1 EUR = 100 RUB
                { date: TODAY, quote: "RUB", rate: 50 },           // сегодня курс другой (1 EUR = 50 RUB)
            ],
        });
        const goals = await listGoals(env, {}) as any[];
        const g = goals.find(x => x.id === "g1");
        // фиксируется по дате вклада: 1000 / 100 = 10 EUR. Если бы по сегодня — было бы 20.
        expect(g.balance).toBeCloseTo(10, 6);
        expect(g.balance).not.toBeCloseTo(20, 6);
        expect(g.balance_missing_rates).toBe(0);
    });

    it("AC7: валюта вклада == target_currency → identity, дата/курс не важны", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [{ id: "a1", currency: "USD" }],
            goals: [{ id: "g2", name: "подушка", target_currency: "USD" }],
            incomes: [
                { id: "i2", goal_id: "g2", date: "2024-01-01", account_id: "a1", amount: 500, currency_code: "USD" },
            ],
            // никаких USD-курсов в базе — identity не должна их требовать
        });
        const goals = await listGoals(env, {}) as any[];
        const g = goals.find(x => x.id === "g2");
        expect(g.balance).toBeCloseTo(500, 6);
        expect(g.balance_missing_rates).toBe(0);
    });

    it("AC6: вклад на дату без курса (нет ≤-fallback) → balance_missing_rates++", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [{ id: "a1", currency: "RUB" }],
            goals: [{ id: "g3", name: "отпуск", target_currency: "EUR" }],
            incomes: [
                { id: "i3", goal_id: "g3", date: "2020-01-01", account_id: "a1", amount: 1000, currency_code: "RUB" },
            ],
            rates: [
                { date: "2024-01-01", quote: "RUB", rate: 100 },   // самый ранний курс ПОЗЖЕ даты вклада
            ],
        });
        const goals = await listGoals(env, {}) as any[];
        const g = goals.find(x => x.id === "g3");
        expect(g.balance_missing_rates).toBe(1);
        expect(g.balance).toBeCloseTo(0, 6);
    });

    it("AC2/AC3: обмен валюты (transactions) не влияет на баланс цели — listGoals их не читает", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [
                { id: "rub", currency: "RUB" },
                { id: "usdt", currency: "USDT", form: "digital", type: "crypto" },
                { id: "eur", currency: "EUR" },
            ],
            goals: [{ id: "g4", name: "цель", target_currency: "EUR" }],
            incomes: [
                { id: "i4", goal_id: "g4", date: "2024-01-01", account_id: "rub", amount: 1000, currency_code: "RUB" },
            ],
            // цепочка обменов RUB → USDT → EUR: цель не должна их учитывать
            transactions: [
                { id: "t1", date: "2024-02-01", from_account_id: "rub", to_account_id: "usdt", from_amount: 1000, from_currency: "RUB", to_amount: 10, to_currency: "USDT" },
                { id: "t2", date: "2024-03-01", from_account_id: "usdt", to_account_id: "eur", from_amount: 10, from_currency: "USDT", to_amount: 9, to_currency: "EUR" },
            ],
            rates: [{ date: "2024-01-01", quote: "RUB", rate: 100 }],
        });
        const goals = await listGoals(env, {}) as any[];
        const g = goals.find(x => x.id === "g4");
        // только вклад: 1000 / 100 = 10 EUR; обмены не трогают баланс цели (±0)
        expect(g.balance).toBeCloseTo(10, 6);
        expect(g.contribution_count).toBe(1);
    });
});

describe("getGoalDetail · delta_in_target по дате строки (SPEC-025)", () => {
    it("AC5: каждый вклад конвертируется по курсу НА ЕГО дату, не на сегодня", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [{ id: "a1", currency: "RUB" }],
            goals: [{ id: "g5", name: "цель", target_currency: "EUR" }],
            incomes: [
                { id: "i5a", goal_id: "g5", date: "2024-01-01", account_id: "a1", amount: 1000, currency_code: "RUB" },
                { id: "i5b", goal_id: "g5", date: "2025-01-01", account_id: "a1", amount: 1000, currency_code: "RUB" },
            ],
            rates: [
                { date: "2024-01-01", quote: "RUB", rate: 100 },   // вклад A: 1000/100 = 10
                { date: "2025-01-01", quote: "RUB", rate: 80 },    // вклад B: 1000/80  = 12.5
                { date: TODAY, quote: "RUB", rate: 50 },           // сегодня: если бы по нему — оба по 20
            ],
        });
        const { goal, contributions } = await getGoalDetail(env, "g5") as any;
        const a = contributions.find((c: any) => c.id === "i5a");
        const b = contributions.find((c: any) => c.id === "i5b");
        expect(a.delta_in_target).toBeCloseTo(10, 6);
        expect(b.delta_in_target).toBeCloseTo(12.5, 6);
        // суммарный баланс = сумма зафиксированных по датам дельт, не 2×(1000/50)=40
        expect(goal.balance).toBeCloseTo(22.5, 6);
    });
});

describe("getDashboard · free без клампа (SPEC-025)", () => {
    it("AC4: free_net_worth_eur может быть < 0, когда net < targeted (без клампа)", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [{ id: "a1", currency: "EUR" }],
            // ведро снапшотом ушло в 50 (деньги потрачены/выведены), но цель всё ещё держит 800
            snapshots: [
                { id: "s1", account_id: "a1", date: "2024-01-01", amount: 1000 },
                { id: "s2", account_id: "a1", date: "2025-06-01", amount: 50 },
            ],
            goals: [{ id: "g1", name: "цель", target_currency: "EUR" }],
            goal_contributions: [
                { id: "gc1", goal_id: "g1", account_id: "a1", date: "2024-01-01", amount: 800, currency_code: "EUR" },
            ],
        });
        const dash = await getDashboard(env, {}) as any;
        // net = 50 (последний снапшот), targeted = 800, invested = 0 → free = -750, без клампа
        expect(dash.kpi.net_worth_eur).toBeCloseTo(50, 2);
        expect(dash.kpi.targeted_eur).toBeCloseTo(800, 2);
        expect(dash.kpi.free_net_worth_eur).toBeCloseTo(-750, 2);
        expect(dash.kpi.free_net_worth_eur).toBeLessThan(0);
    });
});
