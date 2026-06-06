/**
 * SPEC-026: инвестиции (крипто-портфель). Против реального SQLite (node:sqlite,
 * как dashboard.test.ts). Проверяет линзу investments.ts (qty/value/WAC cost
 * basis/P&L/доход стейкинга), free = net − targeted − invested в dashboard,
 * guard'ы (settings/goal_contribution) и инверсию крипто-курса Binance.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { getInvestments, upsertInvestmentSettings } from "../src/investments";
import { fetchCryptoRatesEUR, fetchLidoStethApr } from "../src/rates";
import { getDashboard } from "../src/dashboard";
import { createContribution } from "../src/goals";
import { makeEnv, seed } from "./d1-mock";

const TODAY = "2026-05-15";

afterEach(() => vi.unstubAllGlobals());

describe("investments · cost basis + P&L + staking income (линза)", () => {
    it("покупка + ребейзинг-снапшот → qty/value/cost basis/P&L/доход стейкинга", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [
                { id: "usdt", currency: "USDT", type: "crypto", form: "digital", sort_order: 30 },
                { id: "eth-invest", currency: "ETH", type: "crypto", form: "digital", sort_order: 90, is_investment: 1 },
            ],
            transactions: [
                // покупка 1.0 ETH за 3520 USDT (rate USDT=1.1 → 3200 EUR) 2026-04-01
                { id: "t1", date: "2026-04-01", from_account_id: "usdt", to_account_id: "eth-invest",
                  from_amount: 3520, from_currency: "USDT", to_amount: 1.0, to_currency: "ETH" },
            ],
            // ребейзинг: фактический баланс с биржи = 1.02 ETH (снапшот = ground truth)
            snapshots: [{ id: "s1", date: "2026-05-01", account_id: "eth-invest", amount: 1.02 }],
            rates: [
                { date: "2026-04-01", quote: "USDT", rate: 1.1 },     // cost basis по дате покупки
                { date: "2026-05-10", quote: "ETH", rate: 0.00025 },  // сегодня: ETH = 4000 EUR
            ],
        });

        const inv = await getInvestments(env, { today: TODAY }) as any;
        expect(inv.positions).toHaveLength(1);
        const p = inv.positions[0];
        expect(p.account_id).toBe("eth-invest");
        expect(p.qty).toBeCloseTo(1.02, 6);                  // baseline-снапшот (покупка до него — внутри)
        expect(p.value_eur).toBeCloseTo(4080, 2);            // 1.02 / 0.00025
        expect(p.cost_basis_known).toBe(true);
        expect(p.cost_basis_eur).toBeCloseTo(3200, 2);       // 3520 / 1.1
        expect(p.unrealized_pl_eur).toBeCloseTo(880, 2);     // 4080 − 3200
        expect(p.unrealized_pl_pct).toBeCloseTo(27.5, 1);
        expect(p.staking_income_qty).toBeCloseTo(0.02, 6);   // 1.02 − 1.0 net bought
        expect(p.staking_income_eur).toBeCloseTo(80, 2);     // 0.02 / 0.00025
        // summary зеркалит позицию
        expect(inv.summary.value_eur).toBeCloseTo(4080, 2);
        expect(inv.summary.cost_basis_eur).toBeCloseTo(3200, 2);
        expect(inv.summary.staking_income_eur).toBeCloseTo(80, 2);
    });

    it("комиссия покупки входит в cost basis", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [
                { id: "usdt", currency: "USDT", type: "crypto", sort_order: 30 },
                { id: "eth-invest", currency: "ETH", type: "crypto", sort_order: 90, is_investment: 1 },
            ],
            transactions: [
                { id: "t1", date: "2026-04-01", from_account_id: "usdt", to_account_id: "eth-invest",
                  from_amount: 3300, from_currency: "USDT", to_amount: 1.0, to_currency: "ETH",
                  fee_amount: 11, fee_currency: "USDT" },   // fee 11 USDT / 1.1 = 10 EUR
            ],
            rates: [
                { date: "2026-04-01", quote: "USDT", rate: 1.1 },
                { date: "2026-05-10", quote: "ETH", rate: 0.00025 },
            ],
        });
        const inv = await getInvestments(env, { today: TODAY }) as any;
        // cost = 3300/1.1 + 11/1.1 = 3000 + 10 = 3010
        expect(inv.positions[0].cost_basis_eur).toBeCloseTo(3010, 2);
    });

    it("WAC: продажа списывает cost по средневзвешенной цене", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [
                { id: "usdt", currency: "USDT", type: "crypto", sort_order: 30 },
                { id: "eth-invest", currency: "ETH", type: "crypto", sort_order: 90, is_investment: 1 },
            ],
            transactions: [
                // buy 1 ETH @3200, buy 1 ETH @4000 → cbQty=2, cost=7200, avg=3600
                { id: "t1", date: "2026-04-01", from_account_id: "usdt", to_account_id: "eth-invest",
                  from_amount: 3200, from_currency: "USDT", to_amount: 1.0, to_currency: "ETH" },
                { id: "t2", date: "2026-04-10", from_account_id: "usdt", to_account_id: "eth-invest",
                  from_amount: 4000, from_currency: "USDT", to_amount: 1.0, to_currency: "ETH" },
                // sell 1 ETH → cost -= 3600 → cost=3600, cbQty=1
                { id: "t3", date: "2026-04-20", from_account_id: "eth-invest", to_account_id: "usdt",
                  from_amount: 1.0, from_currency: "ETH", to_amount: 3800, to_currency: "USDT" },
            ],
            rates: [
                { date: "2026-04-01", quote: "USDT", rate: 1.0 },     // 1 EUR = 1 USDT → cost в EUR = сумма USDT
                { date: "2026-05-10", quote: "ETH", rate: 0.00025 },
            ],
        });
        const inv = await getInvestments(env, { today: TODAY }) as any;
        const p = inv.positions[0];
        expect(p.qty).toBeCloseTo(1.0, 6);              // 1+1−1
        expect(p.cost_basis_eur).toBeCloseTo(3600, 2);  // WAC: 7200 − 3600
    });

    it("cost_basis_known=false (E2 смешанный): снапшот-принципал РАНЬШЕ покупки → P&L и доход стейкинга null", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [
                { id: "usdt", currency: "USDT", type: "crypto", sort_order: 30 },
                { id: "eth-invest", currency: "ETH", type: "crypto", sort_order: 90, is_investment: 1 },
            ],
            // opening balance снимком (2026-02-01) ДО первой покупки (2026-04-01) — un-costed принципал
            snapshots: [{ id: "s0", date: "2026-02-01", account_id: "eth-invest", amount: 1.0 }],
            transactions: [
                { id: "t1", date: "2026-04-01", from_account_id: "usdt", to_account_id: "eth-invest",
                  from_amount: 1600, from_currency: "USDT", to_amount: 0.5, to_currency: "ETH" },
            ],
            rates: [
                { date: "2026-04-01", quote: "USDT", rate: 1.0 },
                { date: "2026-05-10", quote: "ETH", rate: 0.00025 },   // 4000 EUR
            ],
        });
        const inv = await getInvestments(env, { today: TODAY }) as any;
        const p = inv.positions[0];
        // qty = 1.0 (snapshot baseline) + 0.5 (buy после снапшота) = 1.5
        expect(p.qty).toBeCloseTo(1.5, 6);
        expect(p.value_eur).toBeCloseTo(6000, 2);          // стоимость всё равно считается
        expect(p.cost_basis_known).toBe(false);            // принципал без затратной цены
        expect(p.cost_basis_eur).toBeNull();
        expect(p.unrealized_pl_eur).toBeNull();            // НЕ +2800 (катастрофическое завышение)
        expect(p.staking_income_eur).toBeNull();           // принципал не атрибутируется стейкингу
    });

    it("cost_basis_known=false: ETH из снапшота без обмена → P&L=null", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [{ id: "eth-invest", currency: "ETH", type: "crypto", sort_order: 90, is_investment: 1 }],
            snapshots: [{ id: "s1", date: "2026-04-01", account_id: "eth-invest", amount: 0.5 }],
            rates: [{ date: "2026-05-10", quote: "ETH", rate: 0.00025 }],
        });
        const inv = await getInvestments(env, { today: TODAY }) as any;
        const p = inv.positions[0];
        expect(p.cost_basis_known).toBe(false);
        expect(p.cost_basis_eur).toBeNull();
        expect(p.unrealized_pl_eur).toBeNull();
        expect(p.value_eur).toBeCloseTo(2000, 2);   // 0.5 / 0.00025
        expect(p.staking_income_eur).toBeNull();    // нет cost basis → доход не разделить
    });
});

describe("investments · free = net − targeted − invested (dashboard)", () => {
    it("invested вычитается из free, но входит в net; Δ корректен", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [
                { id: "eur-bank", currency: "EUR", sort_order: 10 },
                { id: "eth-invest", currency: "ETH", type: "crypto", sort_order: 90, is_investment: 1 },
            ],
            snapshots: [
                { id: "s1", date: "2026-01-01", account_id: "eur-bank", amount: 5000 },
                { id: "s2", date: "2026-01-01", account_id: "eth-invest", amount: 1.0 },
            ],
            rates: [{ date: "2026-01-01", quote: "ETH", rate: 0.0005 }],  // ETH = 2000 EUR (стабилен)
        });
        const dash = await getDashboard(env, { today: TODAY }) as any;
        expect(dash.kpi.net_worth_eur).toBeCloseTo(7000, 2);     // 5000 EUR + 1 ETH×2000
        expect(dash.kpi.invested_eur).toBeCloseTo(2000, 2);
        expect(dash.kpi.targeted_eur).toBeCloseTo(0, 2);
        expect(dash.kpi.free_net_worth_eur).toBeCloseTo(5000, 2); // 7000 − 0 − 2000
        // net_worth_series несёт invested_eur
        const cur = dash.net_worth_series.find((p: any) => p.month === "2026-05");
        expect(cur.invested_eur).toBeCloseTo(2000, 2);
        // prev_invested присутствует (≤ today; для Δ свободных)
        expect(dash.kpi.prev_invested_eur).toBeGreaterThanOrEqual(0);
    });

    it("рост курса ETH: net и invested растут одинаково, free не меняется (E5)", async () => {
        const mk = () => {
            const { env, d1 } = makeEnv();
            seed(d1, {
                accounts: [
                    { id: "eur-bank", currency: "EUR", sort_order: 10 },
                    { id: "eth-invest", currency: "ETH", type: "crypto", sort_order: 90, is_investment: 1 },
                ],
                snapshots: [
                    { id: "s1", date: "2026-01-01", account_id: "eur-bank", amount: 5000 },
                    { id: "s2", date: "2026-01-01", account_id: "eth-invest", amount: 1.0 },
                ],
            });
            return { env, d1 };
        };
        const a = mk(); seed(a.d1, { rates: [{ date: "2026-05-01", quote: "ETH", rate: 0.0005 }] });   // 2000
        const b = mk(); seed(b.d1, { rates: [{ date: "2026-05-01", quote: "ETH", rate: 0.00025 }] });  // 4000
        const da = await getDashboard(a.env, { today: TODAY }) as any;
        const db = await getDashboard(b.env, { today: TODAY }) as any;
        expect(db.kpi.net_worth_eur - da.kpi.net_worth_eur).toBeCloseTo(2000, 2);     // +2000 (4000−2000)
        expect(db.kpi.invested_eur - da.kpi.invested_eur).toBeCloseTo(2000, 2);       // +2000
        expect(da.kpi.free_net_worth_eur).toBeCloseTo(db.kpi.free_net_worth_eur, 2);  // free не изменился
    });
});

describe("investments · guards", () => {
    it("upsertInvestmentSettings: только инвест-ведро, APR в [0,100], staked_qty>=0", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [
                { id: "eur-bank", currency: "EUR", sort_order: 10 },
                { id: "eth-invest", currency: "ETH", type: "crypto", sort_order: 90, is_investment: 1 },
            ],
            snapshots: [{ id: "s1", date: "2026-05-01", account_id: "eth-invest", amount: 1.0 }],
            rates: [{ date: "2026-05-01", quote: "ETH", rate: 0.00025 }],
        });
        const notInv = await upsertInvestmentSettings(env, "eur-bank", { staked_qty: 0.5 });
        expect(notInv.ok).toBe(false);
        const badApr = await upsertInvestmentSettings(env, "eth-invest", { staking_apr_pct: 500 });
        expect(badApr.ok).toBe(false);
        const badQty = await upsertInvestmentSettings(env, "eth-invest", { staked_qty: -1 });
        expect(badQty.ok).toBe(false);
        const ok = await upsertInvestmentSettings(env, "eth-invest", { staked_qty: 0.7, staking_apr_pct: 4.2 });
        expect(ok.ok).toBe(true);
        const inv = await getInvestments(env, { today: TODAY }) as any;
        const p = inv.positions[0];
        expect(p.is_staked).toBe(true);
        expect(p.staked_qty).toBeCloseTo(0.7, 6);
        expect(p.liquid_qty).toBeCloseTo(0.3, 6);            // qty 1.0 − staked 0.7
        expect(p.staking_apr_pct).toBeCloseTo(4.2, 2);       // override
        expect(p.staking_apr_override).toBeCloseTo(4.2, 2);
        // убрать из стейкинга: staked_qty=0
        await upsertInvestmentSettings(env, "eth-invest", { staked_qty: 0 });
        const inv2 = await getInvestments(env, { today: TODAY }) as any;
        expect(inv2.positions[0].is_staked).toBe(false);
        expect(inv2.positions[0].liquid_qty).toBeCloseTo(1.0, 6);
    });

    it("SPEC-027: USDT-стоимость + эффективный APR (override ?? авто Lido) + legacy is_staked", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [{ id: "eth-invest", currency: "ETH", type: "crypto", sort_order: 90, is_investment: 1 }],
            snapshots: [{ id: "s1", date: "2026-05-01", account_id: "eth-invest", amount: 2.0 }],
            rates: [
                { date: "2026-05-01", quote: "ETH", rate: 0.00025 },   // 4000 EUR
                { date: "2026-05-01", quote: "USDT", rate: 1.1 },      // 1 EUR = 1.1 USDT
            ],
            app_config: [{ key: "steth_apr_pct", value: "2.48" }],     // авто Lido
            // legacy: is_staked=1 без staked_qty → трактуется как вся позиция (E3)
            investment_settings: [{ account_id: "eth-invest", is_staked: 1, staked_qty: null, staking_apr_pct: null, note: null }],
        });
        const inv = await getInvestments(env, { today: TODAY }) as any;
        const p = inv.positions[0];
        // USDT: value = 2 ETH × 4000 EUR × 1.1 = 8800 USDT; price = 4400 USDT
        expect(p.value_eur).toBeCloseTo(8000, 2);
        expect(p.value_usdt).toBeCloseTo(8800, 2);
        expect(p.price_usdt).toBeCloseTo(4400, 2);
        expect(inv.summary.value_usdt).toBeCloseTo(8800, 2);
        // эффективный APR = авто Lido (override null)
        expect(p.staking_apr_override).toBeNull();
        expect(p.staking_apr_auto).toBeCloseTo(2.48, 2);
        expect(p.staking_apr_pct).toBeCloseTo(2.48, 2);
        // legacy is_staked=1 без staked_qty → вся позиция застейкана (E3)
        expect(p.is_staked).toBe(true);
        expect(p.staked_qty).toBeCloseTo(2.0, 6);
        expect(p.liquid_qty).toBeCloseTo(0, 6);
    });

    it("goal_contribution на инвест-ведро → 400 (E6)", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [{ id: "eth-invest", currency: "ETH", type: "crypto", sort_order: 90, is_investment: 1 }],
            goals: [{ id: "g1", name: "Цель", status: "active", target_currency: "EUR" }],
        });
        const r = await createContribution(env, { goal_id: "g1", date: "2026-05-01", amount: 100, account_id: "eth-invest" });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toContain("инвест-вед");
    });
});

describe("rates · крипто-курс Binance (инверсия + изоляция)", () => {
    it("fetchCryptoRatesEUR инвертирует цену: rate = 1/price (toEurAt → цена)", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ symbol: "ETHEUR", price: "3200.00" }), { status: 200 })));
        const r = await fetchCryptoRatesEUR("2026-05-15");
        expect(r.base).toBe("EUR");
        expect(r.date).toBe("2026-05-15");
        expect(r.rates.ETH).toBeCloseTo(1 / 3200, 10);   // инверсия
        // toEurAt(1 ETH) должен дать ≈ цену Binance
        expect(1 / r.rates.ETH).toBeCloseTo(3200, 2);
    });

    it("Binance http-ошибка → throw (изолируется в cron/refresh)", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response("blocked", { status: 451 })));
        await expect(fetchCryptoRatesEUR("2026-05-15")).rejects.toThrow(/binance/i);
    });

    it("Binance bad price (0/NaN) → throw", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ price: "0" }), { status: 200 })));
        await expect(fetchCryptoRatesEUR("2026-05-15")).rejects.toThrow(/bad price/i);
    });
});

describe("rates · Lido stETH APR (SPEC-027)", () => {
    it("берёт сглаженный smaApr из /sma", async () => {
        vi.stubGlobal("fetch", vi.fn(async (url: string) =>
            url.includes("/sma")
                ? new Response(JSON.stringify({ data: { smaApr: 2.48 } }), { status: 200 })
                : new Response(JSON.stringify({ data: { apr: 2.7 } }), { status: 200 })));
        expect(await fetchLidoStethApr()).toBeCloseTo(2.48, 4);
    });

    it("fallback на /last когда sma недоступен", async () => {
        vi.stubGlobal("fetch", vi.fn(async (url: string) =>
            url.includes("/sma")
                ? new Response("err", { status: 500 })
                : new Response(JSON.stringify({ data: { apr: 2.7 } }), { status: 200 })));
        expect(await fetchLidoStethApr()).toBeCloseTo(2.7, 4);
    });

    it("оба источника мусор → throw (изолируется в cron/refresh)", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: {} }), { status: 200 })));
        await expect(fetchLidoStethApr()).rejects.toThrow(/lido apr/i);
    });
});
