/**
 * SPEC-022 (тех-долг 2.6): getDashboard против реального SQLite (node:sqlite).
 * Закрывает money-critical агрегатор (net worth / series / targeted) + гард
 * SPEC-021 AC1: net_worth_series[].by_bucket_native присутствует и для текущего
 * месяца == getEffectiveBalance(today) по каждому ведру. «Сегодня» зафиксирован.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getDashboard } from "../src/dashboard";
import { getEffectiveBalance } from "../src/snapshots";
import { makeEnv, seed } from "./d1-mock";

const TODAY = "2026-05-15";

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
});
afterEach(() => vi.useRealTimers());

describe("getDashboard · by_bucket_native (гард SPEC-021)", () => {
    it("присутствует в каждой точке + текущий месяц == getEffectiveBalance(today)", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [
                { id: "eur-bank", currency: "EUR", sort_order: 10 },
                { id: "rub-bank", currency: "RUB", sort_order: 20 },
                { id: "usdt", currency: "USDT", form: "digital", type: "crypto", sort_order: 30 },
            ],
            snapshots: [
                { id: "s1", date: "2026-01-01", account_id: "eur-bank", amount: 1000 },
                { id: "s2", date: "2026-01-01", account_id: "rub-bank", amount: 50000 },
                { id: "s3", date: "2026-01-01", account_id: "usdt", amount: 100 },
            ],
            incomes: [
                { id: "i1", date: "2026-03-10", account_id: "eur-bank", amount: 200, currency_code: "EUR" },
                { id: "i2", date: "2026-02-20", account_id: "rub-bank", amount: 10000, currency_code: "RUB" },
            ],
            expenses: [{ id: "e1", date: "2026-04-05", account_id: "usdt", amount: 5, currency: "USDT" }],
            rates: [
                { date: "2026-01-01", quote: "RUB", rate: 90 },
                { date: "2026-05-01", quote: "RUB", rate: 82.63 },
                { date: "2026-05-01", quote: "USDT", rate: 1.16 },
            ],
        });
        const dash = await getDashboard(env, {}) as any;

        // присутствует во всех точках, ключи = все 3 ведра
        expect(dash.net_worth_series.length).toBeGreaterThan(0);
        for (const p of dash.net_worth_series) {
            expect(p.by_bucket_native).toBeDefined();
            expect(Object.keys(p.by_bucket_native).sort()).toEqual(["eur-bank", "rub-bank", "usdt"]);
        }

        // текущий месяц == getEffectiveBalance(today) по каждому ведру (гард)
        const cur = dash.net_worth_series.find((p: any) => p.month === "2026-05");
        expect(cur).toBeDefined();
        for (const id of ["eur-bank", "rub-bank", "usdt"]) {
            const eff = await getEffectiveBalance(env, id, TODAY);
            expect(cur.by_bucket_native[id]).toBeCloseTo(eff.balance, 2);
        }
        // и значения ровно те, что насчитали вручную
        expect(cur.by_bucket_native["eur-bank"]).toBe(1200);   // 1000 + 200
        expect(cur.by_bucket_native["rub-bank"]).toBe(60000);  // 50000 + 10000
        expect(cur.by_bucket_native["usdt"]).toBe(95);         // 100 - 5
    });

    it("by_bucket (EUR) ≈ конверсия by_bucket_native по курсу на сегодня", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [{ id: "rub-bank", currency: "RUB", sort_order: 10 }],
            snapshots: [{ id: "s1", date: "2026-01-01", account_id: "rub-bank", amount: 82630 }],
            rates: [{ date: "2026-05-01", quote: "RUB", rate: 82.63 }],
        });
        const dash = await getDashboard(env, {}) as any;
        const cur = dash.net_worth_series.find((p: any) => p.month === "2026-05");
        expect(cur.by_bucket_native["rub-bank"]).toBe(82630);
        expect(cur.by_bucket["rub-bank"]).toBeCloseTo(1000, 2);   // 82630 / 82.63
    });
});

describe("getDashboard · KPI консистентность", () => {
    it("net_worth_eur = Σ EUR-балансов вёдер (mark-to-market today)", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [
                { id: "eur-bank", currency: "EUR", sort_order: 10 },
                { id: "rub-bank", currency: "RUB", sort_order: 20 },
            ],
            snapshots: [
                { id: "s1", date: "2026-01-01", account_id: "eur-bank", amount: 1000 },
                { id: "s2", date: "2026-01-01", account_id: "rub-bank", amount: 82630 },
            ],
            rates: [{ date: "2026-05-01", quote: "RUB", rate: 82.63 }],
        });
        const dash = await getDashboard(env, {}) as any;
        expect(dash.kpi.net_worth_eur).toBeCloseTo(2000, 2);   // 1000 EUR + (82630/82.63)=1000 EUR
        expect(dash.kpi.missing_rates).toBe(0);
    });

    it("targeted / free split по активной цели (goal-помеченный доход)", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [{ id: "eur-bank", currency: "EUR", sort_order: 10 }],
            snapshots: [{ id: "s1", date: "2026-01-01", account_id: "eur-bank", amount: 5000 }],
            goals: [{ id: "g1", name: "Подушка", status: "active", target_currency: "EUR", target_amount: 5000 }],
            // доход, помеченный целью: +1500 на ведро (net) И в баланс цели (targeted)
            incomes: [{ id: "i1", date: "2026-04-01", account_id: "eur-bank", amount: 1500, currency_code: "EUR", goal_id: "g1" }],
        });
        const dash = await getDashboard(env, {}) as any;
        expect(dash.kpi.net_worth_eur).toBeCloseTo(6500, 2);        // 5000 + 1500
        expect(dash.kpi.targeted_eur).toBeCloseTo(1500, 2);         // баланс цели
        expect(dash.kpi.free_net_worth_eur).toBeCloseTo(5000, 2);   // net − targeted
    });
});

describe("getDashboard · помесячный ряд", () => {
    it("net worth по месяцам отражает события (income/expense в разные месяцы)", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [{ id: "eur-bank", currency: "EUR", sort_order: 10 }],
            snapshots: [{ id: "s1", date: "2026-01-01", account_id: "eur-bank", amount: 1000 }],
            incomes: [{ id: "i1", date: "2026-02-15", account_id: "eur-bank", amount: 500, currency_code: "EUR" }],
            expenses: [{ id: "e1", date: "2026-03-10", account_id: "eur-bank", amount: 200, currency: "EUR" }],
        });
        const dash = await getDashboard(env, {}) as any;
        const byMonth: Record<string, number> = Object.fromEntries(
            dash.net_worth_series.map((p: any) => [p.month, p.total_eur]),
        );
        expect(byMonth["2026-01"]).toBeCloseTo(1000, 2);   // до дохода
        expect(byMonth["2026-02"]).toBeCloseTo(1500, 2);   // +500
        expect(byMonth["2026-03"]).toBeCloseTo(1300, 2);   // −200
        expect(byMonth["2026-05"]).toBeCloseTo(1300, 2);   // текущий месяц = today, без новых событий
    });
});

describe("getDashboard · граничные кейсы (немутируемость balanceAt)", () => {
    it("baseline на дату == today включается в текущий месяц (граница snaps.date <= asOf)", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [{ id: "eur-bank", currency: "EUR", sort_order: 10 }],
            snapshots: [{ id: "s1", date: TODAY, account_id: "eur-bank", amount: 7000 }], // == today
        });
        const dash = await getDashboard(env, {}) as any;
        const cur = dash.net_worth_series.find((p: any) => p.month === "2026-05");
        // baseline датирован сегодня → должен выбраться (ловит date<asOf мутацию в dashboard-пути)
        expect(cur.by_bucket_native["eur-bank"]).toBe(7000);
        expect(dash.kpi.net_worth_eur).toBeCloseTo(7000, 2);
    });

    it("событие в день baseline исключено в dashboard-пути (ledger > baselineDate)", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [{ id: "eur-bank", currency: "EUR", sort_order: 10 }],
            snapshots: [{ id: "s1", date: "2026-03-01", account_id: "eur-bank", amount: 1000 }],
            incomes: [{ id: "i1", date: "2026-03-01", account_id: "eur-bank", amount: 500, currency_code: "EUR" }], // день снапшота → исключён
        });
        const dash = await getDashboard(env, {}) as any;
        const mar = dash.net_worth_series.find((p: any) => p.month === "2026-03");
        expect(mar.by_bucket_native["eur-bank"]).toBe(1000);  // событие дня baseline не входит (ловит >= мутацию)
        const cur = dash.net_worth_series.find((p: any) => p.month === "2026-05");
        expect(cur.by_bucket_native["eur-bank"]).toBe(1000);
    });

    it("текущий месяц капится по today: будущие события месяца исключены (M3)", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [{ id: "eur-bank", currency: "EUR", sort_order: 10 }],
            snapshots: [{ id: "s1", date: "2026-01-01", account_id: "eur-bank", amount: 1000 }],
            incomes: [{ id: "i1", date: "2026-05-31", account_id: "eur-bank", amount: 500, currency_code: "EUR" }], // после TODAY, тот же месяц
        });
        const dash = await getDashboard(env, {}) as any;
        const cur = dash.net_worth_series.find((p: any) => p.month === "2026-05");
        // T = today (не конец месяца) → будущий доход 2026-05-31 исключён (ловит T=endOfMonth мутацию)
        expect(cur.by_bucket_native["eur-bank"]).toBe(1000);
    });

    it("legacy-цель без target_currency: targeted = EUR-нейтральный balance (M6)", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [{ id: "eur-bank", currency: "EUR", sort_order: 10 }],
            snapshots: [{ id: "s1", date: "2026-01-01", account_id: "eur-bank", amount: 5000 }],
            goals: [{ id: "g1", name: "legacy", status: "active", target_currency: null }], // без target_currency
            incomes: [{ id: "i1", date: "2026-04-01", account_id: "eur-bank", amount: 1200, currency_code: "EUR", goal_id: "g1" }],
        });
        const dash = await getDashboard(env, {}) as any;
        expect(dash.kpi.net_worth_eur).toBeCloseTo(6200, 2);       // 5000 + 1200
        expect(dash.kpi.targeted_eur).toBeCloseTo(1200, 2);        // legacy balance в EUR-нейтрале (ловит инверсию знака)
        expect(dash.kpi.free_net_worth_eur).toBeCloseTo(5000, 2);
    });
});
