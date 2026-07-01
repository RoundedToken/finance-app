/**
 * SPEC-022 (тех-долг 2.6): getDashboard против реального SQLite (node:sqlite).
 * Закрывает money-critical агрегатор (net worth / series / targeted) + гард
 * SPEC-021 AC1: net_worth_series[].by_bucket_native присутствует и для текущего
 * месяца == getEffectiveBalance(today) по каждому ведру. «Сегодня» зафиксирован.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getDashboard } from "../src/dashboard";
import { median } from "../src/stats";
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

    it("tie-break внутри дня снапшота в dashboard-пути по created_at + зеркало getEffectiveBalance (SPEC-024 AC4)", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [{ id: "eur-bank", currency: "EUR", sort_order: 10 }],
            snapshots: [{ id: "s1", date: "2026-03-01", account_id: "eur-bank", amount: 1000, created_at: "2026-03-01 10:00:00" }],
            incomes: [
                { id: "i-before", date: "2026-03-01", account_id: "eur-bank", amount: 500, currency_code: "EUR", created_at: "2026-03-01 09:00:00" }, // до снапшота → исключён
                { id: "i-after", date: "2026-03-01", account_id: "eur-bank", amount: 300, currency_code: "EUR", created_at: "2026-03-01 11:00:00" },  // после снапшота → учтён
            ],
        });
        const dash = await getDashboard(env, {}) as any;
        const mar = dash.net_worth_series.find((p: any) => p.month === "2026-03");
        expect(mar.by_bucket_native["eur-bank"]).toBe(1300);  // 1000 + 300 (i-after); i-before уже в снапшоте
        // зеркальность: тот же результат из per-bucket getEffectiveBalance (AC4)
        const eff = await getEffectiveBalance(env, "eur-bank", "2026-03-31");
        expect(eff.balance).toBe(1300);
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

describe("getDashboard · SPEC-041 медианный «типичный месяц»", () => {
    it("median(): [] → 0, один элемент, нечётное/чётное число элементов (AC1)", () => {
        expect(median([])).toBe(0);
        expect(median([42])).toBe(42);
        expect(median([3, 1, 2])).toBe(2);                  // нечётное → центральный
        expect(median([4, 1, 2, 3])).toBe(2.5);             // чётное → среднее двух центральных
        expect(median([1000, 1000, 1000, 1000, 1000, 5500])).toBe(1000);   // выброс не влияет
    });

    it("разовая крупная трата не ломает burn/savings_rate (медиана vs среднее, AC2/AC3)", async () => {
        const { env, d1 } = makeEnv();
        // TODAY=2026-05-15 → окно = 2025-11..2026-04 (6 полных месяцев).
        // Траты 1000 EUR/мес + разовый выброс 4500 в апреле; доход 2000 EUR/мес.
        const months = ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04"];
        seed(d1, {
            accounts: [{ id: "eur-bank", currency: "EUR", sort_order: 10 }],
            snapshots: [{ id: "s1", date: "2025-11-01", account_id: "eur-bank", amount: 10000 }],
            expenses: [
                ...months.map((m, i) => ({ id: `e${i}`, date: `${m}-05`, account_id: "eur-bank", amount: 1000, currency: "EUR" })),
                { id: "e-outlier", date: "2026-04-20", account_id: "eur-bank", amount: 4500, currency: "EUR" },
            ],
            incomes: months.map((m, i) => ({ id: `i${i}`, date: `${m}-10`, account_id: "eur-bank", amount: 2000, currency_code: "EUR" })),
        });
        const dash = await getDashboard(env, {}) as any;
        expect(dash.kpi.burn_window_months).toBe(6);
        expect(dash.kpi.monthly_burn_eur).toBeCloseTo(1000, 2);      // медиана; среднее дало бы 1750
        expect(dash.kpi.monthly_income_eur).toBeCloseTo(2000, 2);
        expect(dash.kpi.savings_rate).toBeCloseTo(0.5, 4);           // (2000−1000)/2000
        // prev-окно (2025-05..2025-10) не покрыто историей → 0, Δ-бейдж скрыт клиентом
        expect(dash.kpi.prev_monthly_burn_eur).toBe(0);
    });

    it("prev-окно покрыто: медиана по месяцам −7..−12, prev_net_worth на конец месяца −6 (AC4)", async () => {
        const { env, d1 } = makeEnv();
        // TODAY=2026-05-15: cur-окно = 2025-11..2026-04 (по 200/мес),
        // prev-окно = 2025-05..2025-10 (по 100/мес + выброс 400 в августе).
        const prevMonths = ["2025-05", "2025-06", "2025-07", "2025-08", "2025-09", "2025-10"];
        const curMonths = ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04"];
        seed(d1, {
            accounts: [{ id: "eur-bank", currency: "EUR", sort_order: 10 }],
            snapshots: [{ id: "s1", date: "2025-05-01", account_id: "eur-bank", amount: 10000 }],
            expenses: [
                ...prevMonths.map((m, i) => ({ id: `p${i}`, date: `${m}-05`, account_id: "eur-bank", amount: 100, currency: "EUR" })),
                { id: "p-outlier", date: "2025-08-20", account_id: "eur-bank", amount: 400, currency: "EUR" },
                ...curMonths.map((m, i) => ({ id: `c${i}`, date: `${m}-05`, account_id: "eur-bank", amount: 200, currency: "EUR" })),
            ],
        });
        const dash = await getDashboard(env, {}) as any;
        expect(dash.kpi.monthly_burn_eur).toBeCloseTo(200, 2);        // медиана cur-окна
        expect(dash.kpi.prev_monthly_burn_eur).toBeCloseTo(100, 2);   // медиана prev-окна, выброс 400 не влияет
        // prevAsOf = endOfMonth(2026-05 − 6) = 2025-11-30:
        // 10000 − (6×100 + 400 за prev-окно) − 200 (ноябрь) = 8800
        expect(dash.kpi.prev_net_worth_eur).toBeCloseTo(8800, 2);
    });

    it("история короче окна: медиана по покрытым месяцам, без деления на 0 (AC7)", async () => {
        const { env, d1 } = makeEnv();
        // Данные только за март и апрель → окно покрыто 2 месяцами.
        seed(d1, {
            accounts: [{ id: "eur-bank", currency: "EUR", sort_order: 10 }],
            snapshots: [{ id: "s1", date: "2026-03-01", account_id: "eur-bank", amount: 5000 }],
            expenses: [
                { id: "e1", date: "2026-03-10", account_id: "eur-bank", amount: 300, currency: "EUR" },
                { id: "e2", date: "2026-04-10", account_id: "eur-bank", amount: 500, currency: "EUR" },
            ],
        });
        const dash = await getDashboard(env, {}) as any;
        expect(dash.kpi.burn_window_months).toBe(2);
        expect(dash.kpi.monthly_burn_eur).toBeCloseTo(400, 2);       // median([300, 500])
        expect(dash.kpi.savings_rate).toBeNull();                    // дохода нет
    });

    it("месяц без операций внутри покрытого окна участвует как ноль", async () => {
        const { env, d1 } = makeEnv();
        // История с февраля (окно: фев, мар, апр), траты только в феврале и апреле.
        seed(d1, {
            accounts: [{ id: "eur-bank", currency: "EUR", sort_order: 10 }],
            snapshots: [{ id: "s1", date: "2026-02-01", account_id: "eur-bank", amount: 5000 }],
            expenses: [
                { id: "e1", date: "2026-02-10", account_id: "eur-bank", amount: 600, currency: "EUR" },
                { id: "e2", date: "2026-04-10", account_id: "eur-bank", amount: 900, currency: "EUR" },
            ],
        });
        const dash = await getDashboard(env, {}) as any;
        expect(dash.kpi.burn_window_months).toBe(3);
        expect(dash.kpi.monthly_burn_eur).toBeCloseTo(600, 2);       // median([600, 0, 900])
    });
});

describe("getDashboard · free стабилен на обмене в чужой валюте (SPEC-025 G2/G3)", () => {
    it("targeted зафиксирован по дате вклада; обмен RUB→EUR не создаёт фантомный free", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [
                { id: "rub", currency: "RUB", sort_order: 10 },
                { id: "eur", currency: "EUR", sort_order: 20 },
            ],
            // 1000 RUB → цель (EUR) на 2024-01-01 (курс 100 → вклад зафиксирован = 10 EUR)
            goals: [{ id: "g1", name: "цель", status: "active", target_currency: "EUR" }],
            incomes: [
                { id: "i1", date: "2024-01-01", account_id: "rub", amount: 1000, currency_code: "RUB", goal_id: "g1" },
            ],
            // позже целевые деньги обменяны RUB → EUR (физически ушли в евро)
            transactions: [
                { id: "t1", date: "2025-06-01", from_account_id: "rub", to_account_id: "eur",
                  from_amount: 1000, from_currency: "RUB", to_amount: 20, to_currency: "EUR" },
            ],
            rates: [
                { date: "2024-01-01", quote: "RUB", rate: 100 },   // на дату вклада: 1000/100 = 10 EUR
                { date: "2026-05-01", quote: "RUB", rate: 50 },    // сегодня (TODAY=2026-05-15): rate=50
            ],
        });
        const dash = await getDashboard(env, {}) as any;
        // net следует за валютой, где деньги реально лежат: rub=0, eur=20 → net=20 EUR
        expect(dash.kpi.net_worth_eur).toBeCloseTo(20, 2);
        // targeted зафиксирован по дате вклада (10), НЕ переоценён по сегодняшнему курсу RUB
        // (псевдо-запас дал бы 1000/50 = 20 и фантомный free=0 — это и есть починенный баг)
        expect(dash.kpi.targeted_eur).toBeCloseTo(10, 2);
        expect(dash.kpi.targeted_eur).not.toBeCloseTo(20, 2);
        // free = net − targeted = 10: курсовой рост денег (10→20 EUR) над фикс-обязательством,
        // обмен RUB→EUR его не дёрнул (без спреда — стабилен)
        expect(dash.kpi.free_net_worth_eur).toBeCloseTo(10, 2);
    });
});
