import { describe, it, expect } from "vitest";
import {
    classifyArchetype, recommendRecurring, computeEnvelope,
    computeRecommendationsCore, computeMetrics, DEFAULT_CONFIG,
    type RecommendationsInput,
} from "../src/rbar";
import { getRecommendations } from "../src/rbar";
import { RatesIndex, loadRatesIndex } from "../src/rates";
import { makeEnv, seed } from "./d1-mock";

// ── Реальная фикстура: помесячный EUR по категориям, 29 мес (2024-01..2026-05),
//    date-aware конвертация из дампа d1-pre-spec020. Для бэктеста AC13. ──────────
const MONTHS = [
    "2024-01","2024-02","2024-03","2024-04","2024-05","2024-06","2024-07","2024-08","2024-09","2024-10",
    "2024-11","2024-12","2025-01","2025-02","2025-03","2025-04","2025-05","2025-06","2025-07","2025-08",
    "2025-09","2025-10","2025-11","2025-12","2026-01","2026-02","2026-03","2026-04","2026-05",
];
const FIX: Record<string, number[]> = {
    food: [0,14.6,52.2,9.2,16.8,100.4,106,86.6,143.3,90.7,22.3,22,70.6,158.4,110.2,233,457.2,274.7,335.5,374.1,227.2,167.7,389.9,448.4,329,605.6,543.4,134.8,237.2],
    groceries: [0,26.6,6.2,3.7,9,9.4,5.5,10.7,24,3.8,29.3,6,7.6,169.8,341.2,375.2,279.2,238.6,311.6,194.9,132,345.6,298.1,327.1,175.9,147.8,150.2,641.4,442.2],
    utilities: [0,0,117.3,28.4,88,72.7,67.8,77.6,87.5,148,100.4,133.9,143.2,150.5,109.2,34,148.9,219.5,165.3,179.1,102.5,128.9,9.8,183.8,0,103.5,139.4,91.7,208.9],
    transport: [180.6,146.2,127.6,72.2,103.9,116.8,68.5,71.9,104.8,59.3,64.9,70.9,37.4,50.4,29.5,16.6,144.7,25.8,173.7,48.2,20.7,13,46.9,41.8,134,236,101.7,49.1,24.9],
    electronics: [0,53.1,0,0,0,0,250.2,84.7,1392.5,110.4,0,245.9,321.3,383.7,464.2,0,0,358.6,0,850.5,613.8,163.8,30.1,281,0,60.1,0,404.6,4503],
    housing: [0,0,0,0,0,0,0,0,0,0,0,0,0,1303.3,645.3,656.7,658.1,648.8,755.5,645.7,651.1,656,650.5,650.4,650.1,805.2,650.5,658.3,650],
};
/** Обрезает ведущие нули (как buildSeries: активное окно категории). */
function trim(a: number[]): { series: number[]; months: string[] } {
    let i = 0;
    while (i < a.length && a[i] === 0) i++;
    return { series: a.slice(i), months: MONTHS.slice(i) };
}

describe("classifyArchetype — на реальных категориях", () => {
    it("маркирует архетипы консистентно с анализом данных", () => {
        const arch = (k: string) => {
            const { series } = trim(FIX[k]);
            return classifyArchetype(series).archetype;
        };
        // recurring-controllable: где «поджимать» реально работает
        expect(["recurring", "seasonal"]).toContain(arch("food"));
        expect(["recurring", "seasonal"]).toContain(arch("groceries"));
        expect(["recurring", "seasonal"]).toContain(arch("utilities"));
        // lumpy: 9 нулей подряд + €4503 спайк → годовой конверт
        expect(arch("electronics")).toBe("lumpy");
        // fixed: аренда CoV≈0
        expect(arch("housing")).toBe("fixed");
    });

    it("cold-start при N<6", () => {
        expect(classifyArchetype([100, 110, 90]).archetype).toBe("cold-start");
    });

    it("override побеждает авто-классификацию", () => {
        const { series } = trim(FIX.electronics);
        expect(classifyArchetype(series, DEFAULT_CONFIG, "recurring").archetype).toBe("recurring");
    });

    it("computeMetrics на детрендированном масштабе (robust)", () => {
        const m = computeMetrics(trim(FIX.housing).series);
        expect(m.cov_resid).toBeLessThan(0.2);   // аренда — почти плоско
    });

    it("cov_resid детрендирован (AC1): на растущей «Еде» шум << сырой разброс", () => {
        const { series } = trim(FIX.food);
        const m = computeMetrics(series);
        // сырой CoV на ряде с трендом 14→600 был бы ~1.1; детрендированный — заметно ниже
        expect(m.cov_resid).toBeLessThan(0.8);
        expect(classifyArchetype(series).archetype).toBe("recurring");
    });
});

describe("recommendRecurring — закон управления", () => {
    it("экономия → лимит идёт ВНИЗ малыми шагами (≤2.5%/мес), не ниже пола", () => {
        // ровный уровень 500, затем 3 мес снижения
        const series = [500, 510, 490, 505, 500, 495, 470, 455, 448];
        const months = series.map((_, i) => `2025-${String(i + 1).padStart(2, "0")}`);
        const r = recommendRecurring(series, months);
        const traj = r.trajectory;
        // каждый шаг вниз ограничен ~2.5%
        for (let i = 1; i < traj.length; i++) {
            const drop = (traj[i - 1].limit_eur - traj[i].limit_eur) / traj[i - 1].limit_eur;
            expect(drop).toBeLessThanOrEqual(0.026);
        }
        // в конце снижения лимит ниже стартового, но выше пола
        expect(r.recommended_limit_eur).toBeLessThan(520);
        expect(r.recommended_limit_eur).toBeGreaterThanOrEqual(r.floor_eur);
    });

    it("разовый перебор без подтверждённого роста базы → HOLD (не поднимаем)", () => {
        // лимит оседает ~315; 360 — мягкий перебор (+~14% от лимита, <25% → не rollback)
        const series = [300, 300, 300, 300, 300, 300, 300, 360];
        const months = series.map((_, i) => `2025-${String(i + 1).padStart(2, "0")}`);
        const r = recommendRecurring(series, months);
        const last = r.trajectory[r.trajectory.length - 1];
        expect(["HOLD_AFTER_BREACH", "HOLD"]).toContain(last.reason_code);
        // лимит НЕ вырос из одиночного перебора
        const prev = r.trajectory[r.trajectory.length - 2];
        expect(last.limit_eur).toBeLessThanOrEqual(prev.limit_eur + 1e-6);
    });

    it("сильный перебор (>25%) → ROLLBACK к комфортной планке", () => {
        const series = [300, 300, 300, 300, 300, 300, 300, 600];  // +100%
        const months = series.map((_, i) => `2025-${String(i + 1).padStart(2, "0")}`);
        const r = recommendRecurring(series, months);
        expect(r.trajectory[r.trajectory.length - 1].reason_code).toBe("ROLLBACK");
    });

    it("ANTI-DRIFT (AC6): шумовой ряд БЕЗ тренда не дрейфует вверх", () => {
        // среднее ~300, без тренда, 24 мес
        const series = [300,340,270,310,290,330,280,320,300,350,260,310,295,325,275,315,305,285,330,270,310,290,320,300];
        const months = series.map((_, i) => `20${24 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`);
        const r = recommendRecurring(series, months);
        const start = r.trajectory[0].limit_eur;
        const end = r.recommended_limit_eur;
        // наивная асимметрия дала бы +23–35%; RBAR держит около старта (±10%)
        expect(end).toBeLessThanOrEqual(start * 1.10);
        expect(end).toBeGreaterThanOrEqual(start * 0.85);
        expect(end).toBeLessThanOrEqual(360);   // не убежал вверх от среднего 300
    });

    it("ANTI-DRIFT (AC6, безусловный): одиночный спайк НЕ дрейфит лимит вверх и не метит TRACKING_UP", () => {
        // плоско 300, один всплеск 500, снова плоско — классический leak-сценарий
        const series = [300, 300, 300, 300, 300, 300, 300, 500, 300, 300, 300, 300];
        const months = series.map((_, i) => `2025-${String((i % 12) + 1).padStart(2, "0")}`);
        const r = recommendRecurring(series, months);
        const limits = r.trajectory.map(t => t.limit_eur);
        const startL = limits[0];
        // ни один шаг не помечен ложным «устойчивым ростом»
        expect(r.trajectory.every(t => t.reason_code !== "TRACKING_UP")).toBe(true);
        // лимит не уехал вверх от старта (анти-апдрейф)
        expect(Math.max(...limits)).toBeLessThanOrEqual(startL * 1.03);
    });

    it("подтверждённый рост базы ≥3 мес → лимит РАСТЁТ (TRACKING_UP)", () => {
        // реалистичный рост уровня жизни +4%/мес (в пределах slew ≤5%; быстрее
        // — постоянный режим ROLLBACK, т.к. факт >25% над лимитом). Длинный ряд.
        const series = [300, 312, 324, 337, 351, 365, 380, 395, 411, 427, 444, 462];
        const months = series.map((_, i) => `2025-${String((i % 12) + 1).padStart(2, "0")}`);
        const r = recommendRecurring(series, months);
        const reasons = r.trajectory.map(t => t.reason_code);
        expect(reasons).toContain("TRACKING_UP");
        expect(r.recommended_limit_eur).toBeGreaterThan(r.trajectory[0].limit_eur);
    });

    it("winsorize: одиночный всплеск не обваливает рекомендацию", () => {
        const calm = [300, 305, 295, 310, 300, 298, 302, 300];
        const months = calm.map((_, i) => `2025-${String(i + 1).padStart(2, "0")}`);
        const base = recommendRecurring(calm, months).recommended_limit_eur;
        const spiked = [...calm];
        spiked[5] = 3000;  // мега-всплеск
        const r2 = recommendRecurring(spiked, months).recommended_limit_eur;
        // спайк не должен раздуть лимит более чем на ~20%
        expect(r2).toBeLessThan(base * 1.25);
    });
});

describe("computeEnvelope — lumpy конверт", () => {
    it("Техника: годовой бюджет разумен, накоплено ≥0, alert при перерасходе", () => {
        const { series } = trim(FIX.electronics);
        const e = computeEnvelope(series);
        expect(e.annual_eur).toBeGreaterThan(0);
        expect(e.accrual_monthly_eur).toBeCloseTo(e.annual_eur / 12, 2);
        expect(e.accrued_eur).toBeGreaterThanOrEqual(0);
        // €4503 спайк в trailing-12m → расход >> envelope·1.15
        expect(e.alert).toBe(true);
    });

    it("спокойный год: alert=false", () => {
        const series = [50, 0, 60, 0, 40, 0, 55, 0, 45, 0, 50, 0];
        const e = computeEnvelope(series);
        expect(e.alert).toBe(false);
        expect(e.accrued_eur).toBeGreaterThan(0);
    });

    it("живой баланс: трата текущего месяца сразу уменьшает конверт (bug-fix SPEC-023)", () => {
        const series = [0, 0, 600, 0, 0, 0, 0, 0, 500, 0, 0, 0];          // закрытые месяцы (lumpy)
        const closed  = computeEnvelope(series, DEFAULT_CONFIG, null);    // как было: только закрытые
        const noSpend = computeEnvelope(series, DEFAULT_CONFIG, 0);       // текущий месяц, трат ещё нет
        const spent   = computeEnvelope(series, DEFAULT_CONFIG, 200);     // в текущем месяце потрачено 200
        // вариант A: текущий месяц добавляет отчисление → баланс не ниже «как было»
        expect(noSpend.accrued_eur).toBeGreaterThanOrEqual(closed.accrued_eur);
        // главный баг: трата текущего месяца УМЕНЬШАЕТ живой баланс
        expect(spent.accrued_eur).toBeLessThan(noSpend.accrued_eur);
        // ровно на сумму траты (пока не упёрлись в пол 0 / потолок annual)
        if (noSpend.accrued_eur > 200 && noSpend.accrued_eur < noSpend.annual_eur) {
            expect(spent.accrued_eur).toBeCloseTo(noSpend.accrued_eur - 200, 2);
        }
        // обратная совместимость: без 3-го аргумента (default null) = режим «только закрытые»
        expect(computeEnvelope(series).accrued_eur).toBe(closed.accrued_eur);
    });
});

describe("бэктест AC13 — траектории на реальных 29 мес", () => {
    it("recurring-категории не взрываются и трекают реальность", () => {
        for (const k of ["food", "groceries", "utilities", "transport"]) {
            const { series, months } = trim(FIX[k]);
            const r = recommendRecurring(series, months);
            const recentMed = median12(series);
            // все лимиты конечны, положительны, в разумном коридоре
            for (const step of r.trajectory) {
                expect(Number.isFinite(step.limit_eur)).toBe(true);
                expect(step.limit_eur).toBeGreaterThan(0);
            }
            // финальная рекомендация трекает недавний уровень (не застряла в ратчете)
            expect(r.recommended_limit_eur).toBeGreaterThan(recentMed * 0.3);
            expect(r.recommended_limit_eur).toBeLessThan(recentMed * 3 + 200);
        }
    });

    it("детерминизм/идемпотентность (AC9): повтор даёт тот же результат", () => {
        const { series, months } = trim(FIX.food);
        const a = recommendRecurring(series, months).recommended_limit_eur;
        const b = recommendRecurring(series, months).recommended_limit_eur;
        expect(a).toBe(b);
    });
});

function median12(s: number[]): number {
    const last = s.slice(-12).filter(x => x > 0).sort((a, b) => a - b);
    return last.length ? last[last.length >> 1] : 1;
}

describe("computeRecommendationsCore — оркестратор (pure)", () => {
    function makeInput(period: string): RecommendationsInput {
        const rates = new RatesIndex(); rates.finalize();  // EUR-only
        const expenses: any[] = [];
        // food: recurring; tech: lumpy
        for (let i = 0; i < FIX.food.length; i++) {
            const m = MONTHS[i];
            if (FIX.food[i] > 0) expenses.push({ date: `${m}-15`, amount: FIX.food[i], currency: "EUR", category_id: "food" });
            if (FIX.electronics[i] > 0) expenses.push({ date: `${m}-15`, amount: FIX.electronics[i], currency: "EUR", category_id: "tech" });
        }
        return {
            expenses, rates,
            categories: [
                { id: "food", name: "Еда", emoji: "🍔", color: "#f00" },
                { id: "tech", name: "Техника", emoji: "💻", color: "#00f" },
            ],
            budgets: new Map([["food", { id: "b1", limit_eur: 520 }]]),
            settings: new Map(),
            dismissed: new Set(),
            period,
        };
    }

    it("food → recommended + delta vs ручного лимита; tech → envelope", () => {
        const res = computeRecommendationsCore(makeInput("2026-06"));
        const food = res.recommendations.find(r => r.category_id === "food")!;
        const tech = res.recommendations.find(r => r.category_id === "tech")!;
        expect(["recurring", "seasonal"]).toContain(food.archetype);
        expect(food.recommended_limit_eur).toBeGreaterThan(0);
        expect(food.current_limit_eur).toBe(520);
        expect(food.delta_pct).not.toBeNull();
        expect(food.reason_text).toBeTruthy();
        expect(tech.archetype).toBe("lumpy");
        expect(tech.recommended_limit_eur).toBeNull();
        expect(tech.envelope).not.toBeNull();
    });

    it("adaptive_enabled=false → категория пропущена", () => {
        const input = makeInput("2026-06");
        input.settings.set("food", { archetype_override: null, floor_eur: null, adaptive_enabled: false });
        const res = computeRecommendationsCore(input);
        expect(res.recommendations.find(r => r.category_id === "food")).toBeUndefined();
    });

    it("dismissed помечается", () => {
        const input = makeInput("2026-06");
        input.dismissed.add("food");
        const res = computeRecommendationsCore(input);
        expect(res.recommendations.find(r => r.category_id === "food")!.dismissed).toBe(true);
    });
});

describe("getRecommendations — D1 mock смоук (SQL/wiring)", () => {
    it("грузит траты/категории из D1 и считает рекомендации", async () => {
        const { env, d1 } = makeEnv();
        const cats = [{ id: "food" }, { id: "tech" }];
        const expenses: any[] = [];
        let n = 0;
        for (let i = 0; i < FIX.food.length; i++) {
            const m = MONTHS[i];
            if (FIX.food[i] > 0) expenses.push({ id: `f${n++}`, date: `${m}-15`, amount: FIX.food[i], currency: "EUR", category_id: "food" });
            if (FIX.electronics[i] > 0) expenses.push({ id: `t${n++}`, date: `${m}-15`, amount: FIX.electronics[i], currency: "EUR", category_id: "tech" });
        }
        seed(d1, { categories: cats, expenses });
        const res = await getRecommendations(env, { period: "2026-06" });
        expect(res.period).toBe("2026-06");
        const food = res.recommendations.find(r => r.category_id === "food");
        expect(food).toBeDefined();
        expect(["recurring", "seasonal"]).toContain(food!.archetype);
        const tech = res.recommendations.find(r => r.category_id === "tech");
        expect(tech!.archetype).toBe("lumpy");
        expect(tech!.envelope).not.toBeNull();
    });
});
