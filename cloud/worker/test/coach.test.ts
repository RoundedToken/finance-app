/**
 * SPEC-040 — coach: чистое ядро правил `signalsFor` + интеграция `runDailyNudge`
 * (сбор картины из D1, cooldown, молчание-когда-ок, отправка через stub fetch).
 */
import { describe, it, expect } from "vitest";
import { signalsFor, runDailyNudge, COACH_CONFIG, type CoachSnapshot } from "../src/coach";
import { makeEnv, seed } from "./d1-mock";

const TODAY = "2026-06-27";
/** Всё-чисто картина — правила должны молчать. Тесты переопределяют отдельные поля. */
function base(over: Partial<CoachSnapshot> = {}): CoachSnapshot {
    return {
        today: TODAY,
        lastExpenseDate: TODAY,
        lastSnapshotDate: TODAY,
        bucketsNoBaseline: [],
        missingRates: 0,
        freeEur: 1000,
        runwayMonths: 12,
        budgetsOver: [],
        goalsOverdue: [],
        categorySpikes: [],
        ...over,
    };
}
const keys = (s: CoachSnapshot) => signalsFor(s).map(x => x.key);

describe("signalsFor — чистое ядро (AC2-AC6)", () => {
    it("всё свежее → 0 сигналов (молчание)", () => {
        expect(signalsFor(base())).toEqual([]);
    });

    it("качество данных: гэп / устаревшие снапшоты / без baseline / без курса", () => {
        expect(keys(base({ lastExpenseDate: "2026-06-23" }))).toContain("gap_no_expenses");   // 4 дн ≥ 3
        expect(keys(base({ lastExpenseDate: "2026-06-25" }))).not.toContain("gap_no_expenses"); // 2 дн < 3
        expect(keys(base({ lastSnapshotDate: "2026-06-05" }))).toContain("stale_snapshots");   // 22 дн ≥ 14
        expect(keys(base({ lastSnapshotDate: "2026-06-20" }))).not.toContain("stale_snapshots"); // 7 дн < 14
        expect(keys(base({ bucketsNoBaseline: ["RSD-нал"] }))).toContain("bucket_no_baseline");
        expect(keys(base({ missingRates: 3 }))).toContain("missing_rates");
        expect(keys(base({ missingRates: 0 }))).not.toContain("missing_rates");
    });

    it("бюджеты/цели: превышение бюджета, просроченная цель", () => {
        expect(keys(base({ budgetsOver: [{ name: "Кафе", pct: 114 }] }))).toContain("budget_over");
        expect(keys(base({ goalsOverdue: ["Квартира"] }))).toContain("goal_overdue");
    });

    it("net worth/runway — ПОРОГ, не сводка (NG4)", () => {
        expect(keys(base({ freeEur: -50 }))).toContain("free_negative");
        expect(keys(base({ freeEur: 0.01 }))).not.toContain("free_negative");
        expect(keys(base({ runwayMonths: 2 }))).toContain("runway_low");       // < 3
        expect(keys(base({ runwayMonths: 5 }))).not.toContain("runway_low");
        expect(keys(base({ runwayMonths: null }))).not.toContain("runway_low"); // нет данных → молчим
    });

    it("аномалия трат", () => {
        expect(keys(base({ categorySpikes: [{ name: "Кафе", eur: 300, factor: 2.5 }] }))).toContain("spending_spike");
    });

    it("free<0 подавляет runway_low (один корень, не съедаем 2 слота)", () => {
        const ks = keys(base({ freeEur: -100, runwayMonths: 0 }));
        expect(ks).toContain("free_negative");
        expect(ks).not.toContain("runway_low");
    });

    it("копеечный минус не палит free_negative (эпсилон −0.5)", () => {
        expect(keys(base({ freeEur: -0.01 }))).not.toContain("free_negative");
    });

    it("приоритет: качество данных выше net worth", () => {
        const s = base({ lastExpenseDate: "2026-06-20", freeEur: -10 });
        const ks = signalsFor(s).map(x => x.key);
        expect(ks.indexOf("gap_no_expenses")).toBeLessThan(ks.indexOf("free_negative"));
    });

    it("несколько бюджетов over → один сигнал про худший + «и ещё N»", () => {
        const sigs = signalsFor(base({ budgetsOver: [{ name: "Кафе", pct: 130 }, { name: "Еда", pct: 110 }] }));
        const b = sigs.find(x => x.key === "budget_over")!;
        expect(b.text).toContain("Кафе");
        expect(b.text).toContain("130%");
        expect(b.text).toContain("и ещё 1");
    });
});

describe("runDailyNudge — интеграция (AC1/6/7/8)", () => {
    function stubFetch() {
        let calls = 0;
        const orig = globalThis.fetch;
        globalThis.fetch = (async () => { calls++; return new Response("{}", { status: 200 }); }) as typeof fetch;
        return { count: () => calls, restore: () => { globalThis.fetch = orig; } };
    }

    it("шлёт при сигнале, пишет coach_state, cooldown молчит в тот же день", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            authorized_users: [{ telegram_id: "12345", name: "Stepan" }],
            accounts: [{ id: "rsd-cash", currency: "RSD", sort_order: 10 }],
            snapshots: [{ id: "s1", date: "2026-05-01", account_id: "rsd-cash", amount: 10000 }], // старо → stale
            categories: [{ id: "food", name: "Еда" }],
            expenses: [{ id: "e1", date: "2026-06-20", account_id: "rsd-cash", amount: 500, currency: "RSD", category_id: "food" }], // 7 дн → gap
            rates: [{ date: "2026-05-01", quote: "RSD", rate: 117 }],
        });
        const fx = stubFetch();
        try {
            const r1 = await runDailyNudge(env, TODAY);
            expect(r1.sent).toBe(true);
            expect(r1.signals).toBeGreaterThan(0);
            expect(fx.count()).toBe(1);
            const st = await env.DB.prepare("SELECT COUNT(*) AS n FROM coach_state").first<{ n: number }>();
            expect(st!.n).toBe(r1.signals);
            // cooldown: повтор в тот же день → молчим, fetch не вызван снова
            const r2 = await runDailyNudge(env, TODAY);
            expect(r2.sent).toBe(false);
            expect(fx.count()).toBe(1);
        } finally { fx.restore(); }
    });

    it("молчит когда всё свежее (0 сигналов → нет отправки)", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            authorized_users: [{ telegram_id: "12345", name: "Stepan" }],
            accounts: [{ id: "rsd-cash", currency: "RSD", sort_order: 10 }],
            snapshots: [{ id: "s1", date: TODAY, account_id: "rsd-cash", amount: 10000 }],
            categories: [{ id: "food", name: "Еда" }],
            expenses: [{ id: "e1", date: TODAY, account_id: "rsd-cash", amount: 500, currency: "RSD", category_id: "food" }],
            rates: [{ date: "2026-06-01", quote: "RSD", rate: 117 }],
        });
        const fx = stubFetch();
        try {
            const r = await runDailyNudge(env, TODAY);
            expect(r.sent).toBe(false);
            expect(fx.count()).toBe(0);
        } finally { fx.restore(); }
    });

    it("E6: доставка упала (5xx) → coach_state НЕ обновлён, повтор завтра", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            authorized_users: [{ telegram_id: "12345", name: "Stepan" }],
            accounts: [{ id: "rsd-cash", currency: "RSD", sort_order: 10 }],
            snapshots: [{ id: "s1", date: "2026-05-01", account_id: "rsd-cash", amount: 10000 }],
            categories: [{ id: "food", name: "Еда" }],
            expenses: [{ id: "e1", date: "2026-06-20", account_id: "rsd-cash", amount: 500, currency: "RSD", category_id: "food" }],
            rates: [{ date: "2026-05-01", quote: "RSD", rate: 117 }],
        });
        const orig = globalThis.fetch;
        globalThis.fetch = (async () => new Response("err", { status: 500 })) as typeof fetch;
        try {
            const r = await runDailyNudge(env, TODAY);
            expect(r.sent).toBe(false);
            const st = await env.DB.prepare("SELECT COUNT(*) AS n FROM coach_state").first<{ n: number }>();
            expect(st!.n).toBe(0);   // не застамплено → завтра повторим
        } finally { globalThis.fetch = orig; }
    });

    it("нет авторизованных получателей → не шлём", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [{ id: "rsd-cash", currency: "RSD", sort_order: 10 }],
            snapshots: [{ id: "s1", date: "2026-05-01", account_id: "rsd-cash", amount: 10000 }],
            rates: [{ date: "2026-05-01", quote: "RSD", rate: 117 }],
        });
        const fx = stubFetch();
        try {
            const r = await runDailyNudge(env, TODAY);
            expect(r.sent).toBe(false);
            expect(fx.count()).toBe(0);
        } finally { fx.restore(); }
    });
});
