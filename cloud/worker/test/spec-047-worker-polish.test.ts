/**
 * SPEC-047 — волна 3 аудита, P3-полировка worker:
 *  SEC-11  iss/exp у Google id_token
 *  SEC-12  CORS deny для не-allowlist + nosniff
 *  SEC-13  caps на строковые Zod-поля
 *  WRK-10  cron: фиат и крипта одной датой
 *  WRK-18  updateIncome: неизменённая деактивированная категория
 *  WRK-20  единая 404-семантика no-op мутаций
 *  WRK-21  бот: резолв категории по справочнику
 *  WRK-22  bootstrap: один скан expenses
 *  FIN-06  r2 на выдаче в net_worth_series
 *  FIN-08  budgetStatus от r2(spent)
 *  FIN-11  legacy-цель: list == detail (EUR fallback)
 *  FIN-12  free-формула: dashboard == /v1/web/accounts
 *  FIN-15  fee-in-asset не съедает доход стейкинга
 *  FIN-18  fee-событие в events_count
 * (FIN-05 — в rates.test.ts.)
 */
import { describe, it, expect, afterEach } from "vitest";
import worker from "../src/index";
import { handleGoogleCallback } from "../src/auth-google";
import { handleTelegramUpdate, resolveCategoryToken } from "../src/bot";
import { signJwt } from "../src/jwt";
import { getDashboard } from "../src/dashboard";
import { getEffectiveBalance } from "../src/snapshots";
import { getInvestments } from "../src/investments";
import { updateIncome } from "../src/incomes";
import { listGoals, getGoalDetail } from "../src/goals";
import { computeBudgetProgress } from "../src/budgets";
import { getBootstrapData } from "../src/db";
import { getEnvelopesForBootstrap } from "../src/rbar";
import { loadRatesIndex, RatesIndex } from "../src/rates";
import { expenseCreateSchema, goalCreateSchema } from "../src/schemas";
import { makeEnv, seed } from "./d1-mock";
import { makeInitData, BOT_TOKEN } from "./helpers";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

// ── Хелперы ──────────────────────────────────────────────────────────────────

const ADMIN_EMAIL = "owner@example.com";
const ADMIN_SECRET = "admin-secret";

function adminEnv(env: any): any {
    env.ADMIN_JWT_SECRET = ADMIN_SECRET;
    env.ADMIN_ALLOWED_EMAILS = ADMIN_EMAIL;
    return env;
}
async function adminToken(): Promise<string> {
    return signJwt({ sub: ADMIN_EMAIL }, ADMIN_SECRET, 3600);
}
async function adminFetch(env: any, path: string, method = "GET", body?: unknown): Promise<Response> {
    return worker.fetch(new Request(`https://x${path}`, {
        method,
        headers: { Authorization: `Bearer ${await adminToken()}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
    }), env);
}

/** Неподписанный id_token (подпись в code-flow не проверяется — см. SEC-11). */
function fakeIdToken(claims: Record<string, unknown>): string {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    return `${b64({ alg: "RS256" })}.${b64(claims)}.sig`;
}

const NIL_ID = "00000000-0000-0000-0000-000000000000";

// ── SEC-11 — iss/exp у Google id_token ───────────────────────────────────────

describe("SEC-11 — id_token: iss + exp", () => {
    function oauthEnv(): any {
        const { env } = makeEnv();
        adminEnv(env);
        env.GOOGLE_CLIENT_ID = "cid";
        env.GOOGLE_CLIENT_SECRET = "csecret";
        env.GOOGLE_REDIRECT_URI = "https://x/v1/auth/google/callback";
        env.ADMIN_ALLOWED_ORIGINS = "https://admin.example.com";
        return env;
    }
    function callbackRequest(): Request {
        return new Request("https://x/v1/auth/google/callback?code=c&state=s", {
            headers: { Cookie: "google_oauth_state=s; google_oauth_return=https://admin.example.com/" },
        });
    }
    function stubTokenEndpoint(idToken: string): void {
        globalThis.fetch = (async () => new Response(JSON.stringify({ id_token: idToken }), {
            status: 200, headers: { "Content-Type": "application/json" },
        })) as any;
    }
    const goodClaims = () => ({
        iss: "https://accounts.google.com", aud: "cid",
        exp: Math.floor(Date.now() / 1000) + 3600,
        email: ADMIN_EMAIL, email_verified: true,
    });

    it("валидные iss/exp → 302 с токеном", async () => {
        stubTokenEndpoint(fakeIdToken(goodClaims()));
        const r = await handleGoogleCallback(callbackRequest(), oauthEnv());
        expect(r.status).toBe(302);
        expect(r.headers.get("Location")).toContain("#token=");
    });
    it("чужой iss → 401", async () => {
        stubTokenEndpoint(fakeIdToken({ ...goodClaims(), iss: "https://evil.example.com" }));
        const r = await handleGoogleCallback(callbackRequest(), oauthEnv());
        expect(r.status).toBe(401);
        expect(await r.text()).toContain("iss");
    });
    it("истёкший exp → 401", async () => {
        stubTokenEndpoint(fakeIdToken({ ...goodClaims(), exp: Math.floor(Date.now() / 1000) - 10 }));
        const r = await handleGoogleCallback(callbackRequest(), oauthEnv());
        expect(r.status).toBe(401);
        expect(await r.text()).toContain("expired");
    });
    it("exp отсутствует → 401 (fail-closed)", async () => {
        const c: any = goodClaims(); delete c.exp;
        stubTokenEndpoint(fakeIdToken(c));
        expect((await handleGoogleCallback(callbackRequest(), oauthEnv())).status).toBe(401);
    });
});

// ── SEC-12 — CORS deny + nosniff ─────────────────────────────────────────────

describe("SEC-12 — CORS и nosniff", () => {
    it("allowlisted origin → echo; неизвестный → БЕЗ ACAO; без Origin → БЕЗ ACAO", async () => {
        const { env } = makeEnv();
        env.ADMIN_ALLOWED_ORIGINS = "https://admin.example.com,https://miniapp.example.com";

        const ok = await worker.fetch(new Request("https://x/healthz", { headers: { Origin: "https://admin.example.com" } }), env);
        expect(ok.headers.get("Access-Control-Allow-Origin")).toBe("https://admin.example.com");

        const mini = await worker.fetch(new Request("https://x/healthz", { headers: { Origin: "https://miniapp.example.com" } }), env);
        expect(mini.headers.get("Access-Control-Allow-Origin")).toBe("https://miniapp.example.com");

        const evil = await worker.fetch(new Request("https://x/healthz", { headers: { Origin: "https://evil.example.com" } }), env);
        expect(evil.headers.get("Access-Control-Allow-Origin")).toBeNull();

        const curl = await worker.fetch(new Request("https://x/healthz"), env);
        expect(curl.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });
    it("JSON-ответы несут X-Content-Type-Options: nosniff", async () => {
        const { env } = makeEnv();
        const r = await worker.fetch(new Request("https://x/healthz"), env);
        expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
    });
});

// ── SEC-13 — caps на строки ──────────────────────────────────────────────────

describe("SEC-13 — Zod string caps", () => {
    it("note > 1000 / id > 128 / name > 200 → reject", () => {
        const base = { id: "e1", date: "2026-06-01", amount: 1, currency: "EUR" };
        expect(expenseCreateSchema.safeParse({ ...base, note: "x".repeat(1000) }).success).toBe(true);
        expect(expenseCreateSchema.safeParse({ ...base, note: "x".repeat(1001) }).success).toBe(false);
        expect(expenseCreateSchema.safeParse({ ...base, id: "x".repeat(129) }).success).toBe(false);
        expect(expenseCreateSchema.safeParse({ ...base, currency: "x".repeat(17) }).success).toBe(false);
        expect(goalCreateSchema.safeParse({ name: "x".repeat(200) }).success).toBe(true);
        expect(goalCreateSchema.safeParse({ name: "x".repeat(201) }).success).toBe(false);
    });
});

// ── WRK-10 — cron: одна дата для фиата и крипты ──────────────────────────────

describe("WRK-10 — scheduled пишет фиат и крипту одной датой", () => {
    it("дата ETH-строки = payload.date из CSV, не UTC-today", async () => {
        const { env, d1 } = makeEnv();
        env.GOOGLE_RATES_LATEST_CSV = "https://sheets.example.com/latest.csv";
        const SHEET_DATE = "2020-01-02";   // заведомо ≠ реальному UTC-today
        globalThis.fetch = (async (input: any) => {
            const url = String(input instanceof Request ? input.url : input);
            if (url.includes("sheets.example.com")) return new Response(`date,EURUSD\n${SHEET_DATE},1.1`, { status: 200 });
            if (url.includes("binance")) return new Response(JSON.stringify({ price: "2000" }), { status: 200 });
            return new Response("nope", { status: 500 });   // lido и прочее — падают (изолированы)
        }) as any;

        await worker.scheduled({ cron: "0 */6 * * *", scheduledTime: Date.now() } as any, env);

        const eth = await d1.prepare("SELECT date FROM rates WHERE quote = 'ETH'").first<{ date: string }>();
        const usd = await d1.prepare("SELECT date FROM rates WHERE quote = 'USD'").first<{ date: string }>();
        expect(usd!.date).toBe(SHEET_DATE);
        expect(eth!.date).toBe(SHEET_DATE);   // раньше — UTC-today, разъезжалось на границе суток
    });
});

// ── WRK-18 — updateIncome с деактивированной категорией ──────────────────────

describe("WRK-18 — updateIncome: неизменённая категория не требует is_active", () => {
    function incomeEnv() {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [{ id: "eur-main", currency: "EUR" }],
            income_categories: [
                { id: "salary-old", is_active: 0 },      // деактивирована (SPEC-017)
                { id: "salary-new", is_active: 1 },
                { id: "ghost-inactive", is_active: 0 },
            ],
            incomes: [{ id: "i1", date: "2026-06-01", account_id: "eur-main", amount: 100, currency_code: "EUR", category_id: "salary-old" }],
        });
        return { env, d1 };
    }
    it("full-PUT с неизменённым (деактивированным) category_id → ok", async () => {
        const { env } = incomeEnv();
        const r = await updateIncome(env, "i1", { amount: 150, category_id: "salary-old" });
        expect(r).toMatchObject({ ok: true, updated: true });
    });
    it("смена НА деактивированную категорию → 400 unknown", async () => {
        const { env } = incomeEnv();
        const r = await updateIncome(env, "i1", { category_id: "ghost-inactive" });
        expect(r).toMatchObject({ ok: false, error: "unknown category_id" });
    });
    it("смена на активную по-прежнему работает", async () => {
        const { env } = incomeEnv();
        const r = await updateIncome(env, "i1", { category_id: "salary-new" });
        expect(r).toMatchObject({ ok: true, updated: true });
    });
});

// ── WRK-20 — no-op мутации → 404 ─────────────────────────────────────────────

describe("WRK-20 — единая 404-семантика", () => {
    it("Mini App: PUT/DELETE несуществующей траты → 404; существующей → 200", async () => {
        const { env, d1 } = makeEnv();
        env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
        seed(d1, { authorized_users: [{ telegram_id: "42" }] });
        const initData = await makeInitData(Math.floor(Date.now() / 1000));
        const call = (path: string, method: string, body?: unknown) =>
            worker.fetch(new Request(`https://x${path}`, {
                method, headers: { "X-Telegram-Init-Data": initData, "Content-Type": "application/json" },
                body: body === undefined ? undefined : JSON.stringify(body),
            }), env);

        expect((await call(`/v1/expenses/${NIL_ID}`, "PUT", { note: "x" })).status).toBe(404);
        expect((await call(`/v1/expenses/${NIL_ID}`, "DELETE")).status).toBe(404);

        const created = await call("/v1/expenses", "POST", { id: "e-47", date: "2026-06-01", amount: 5, currency: "EUR" });
        expect(created.status).toBe(200);
        expect((await call("/v1/expenses/e-47", "PUT", { note: "ok" })).status).toBe(200);
        expect((await call("/v1/expenses/e-47", "DELETE")).status).toBe(200);
        expect((await call("/v1/expenses/e-47", "DELETE")).status).toBe(404);   // повтор — уже удалено
    });

    it("Web Admin: no-op update/delete по всем доменам → 404", async () => {
        const { env, d1 } = makeEnv();
        adminEnv(env);
        seed(d1, { accounts: [{ id: "eur-main", currency: "EUR" }] });

        expect((await adminFetch(env, `/v1/web/snapshots/${NIL_ID}`, "PUT", { amount: 1 })).status).toBe(404);
        expect((await adminFetch(env, `/v1/web/snapshots/${NIL_ID}`, "DELETE")).status).toBe(404);
        expect((await adminFetch(env, `/v1/web/incomes/${NIL_ID}`, "PUT", { amount: 1 })).status).toBe(404);
        expect((await adminFetch(env, `/v1/web/incomes/${NIL_ID}`, "DELETE")).status).toBe(404);
        expect((await adminFetch(env, `/v1/web/goals/${NIL_ID}`, "PUT", { name: "g" })).status).toBe(404);
        expect((await adminFetch(env, `/v1/web/goals/${NIL_ID}`, "DELETE")).status).toBe(404);
        expect((await adminFetch(env, `/v1/web/goals/${NIL_ID}/status`, "POST", { status: "archived" })).status).toBe(404);
        expect((await adminFetch(env, `/v1/web/goal-contributions/${NIL_ID}`, "PUT", { note: "x" })).status).toBe(404);
        expect((await adminFetch(env, `/v1/web/goal-contributions/${NIL_ID}`, "DELETE")).status).toBe(404);
        expect((await adminFetch(env, `/v1/web/transactions/${NIL_ID}`, "PUT", { note: "x" })).status).toBe(404);
        expect((await adminFetch(env, `/v1/web/transactions/${NIL_ID}`, "DELETE")).status).toBe(404);
        expect((await adminFetch(env, `/v1/web/budgets/${NIL_ID}`, "PUT", { limit_eur: 10 })).status).toBe(404);
        expect((await adminFetch(env, `/v1/web/budgets/${NIL_ID}`, "DELETE")).status).toBe(404);
        expect((await adminFetch(env, "/v1/web/categories/no-such-cat", "PUT", { name: "x" })).status).toBe(404);
        expect((await adminFetch(env, "/v1/web/income-categories/no-such-cat", "PUT", { name: "x" })).status).toBe(404);
    });

    it("успешный update по-прежнему 200 {updated:true}", async () => {
        const { env, d1 } = makeEnv();
        adminEnv(env);
        // id — hex/dash: route-regex снапшотов принимает только [0-9a-fA-F-]
        const SNAP_ID = "a1b2c3d4-0000-0000-0000-000000000001";
        seed(d1, {
            accounts: [{ id: "eur-main", currency: "EUR" }],
            snapshots: [{ id: SNAP_ID, date: "2026-06-01", account_id: "eur-main", amount: 100 }],
        });
        const r = await adminFetch(env, `/v1/web/snapshots/${SNAP_ID}`, "PUT", { amount: 120 });
        expect(r.status).toBe(200);
        expect(await r.json()).toMatchObject({ ok: true, updated: true });
    });
});

// ── WRK-21 — бот: резолв категории ───────────────────────────────────────────

describe("WRK-21 — бот резолвит категорию по справочнику", () => {
    const CATS = [{ id: "food", name: "Еда" }, { id: "transport", name: "Транспорт" }];
    it("resolveCategoryToken: по id, по имени (case-insensitive), null для мусора", () => {
        expect(resolveCategoryToken(CATS, "food")?.id).toBe("food");
        expect(resolveCategoryToken(CATS, "еда")?.id).toBe("food");
        expect(resolveCategoryToken(CATS, "ТРАНСПОРТ".toLowerCase())?.id).toBe("transport");
        expect(resolveCategoryToken(CATS, "food2")).toBeNull();
    });

    function botEnv() {
        const { env, d1 } = makeEnv();
        env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
        seed(d1, {
            authorized_users: [{ telegram_id: "42" }],
            categories: [{ id: "food", name: "Еда", type: "expense", is_active: 1 }],
        });
        return { env, d1 };
    }
    function stubTelegram(sent: string[]): void {
        globalThis.fetch = (async (_url: any, init?: any) => {
            sent.push(JSON.parse(init?.body ?? "{}").text ?? "");
            return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }) as any;
    }
    const update = (text: string) => ({ message: { message_id: 1, chat: { id: 42, type: "private" }, from: { id: 42 }, text, date: 0 } });

    it("токен = имя категории → трата с category_id справочника", async () => {
        const { env, d1 } = botEnv();
        const sent: string[] = [];
        stubTelegram(sent);
        await handleTelegramUpdate(update("50 EUR еда обед") as any, env);
        const row = await d1.prepare("SELECT category_id, amount FROM expenses").first<{ category_id: string; amount: number }>();
        expect(row).toMatchObject({ category_id: "food", amount: 50 });
        expect(sent.some(t => t.includes("Записано"))).toBe(true);
    });
    it("неизвестный токен → подсказка со списком, трата НЕ создаётся", async () => {
        const { env, d1 } = botEnv();
        const sent: string[] = [];
        stubTelegram(sent);
        await handleTelegramUpdate(update("50 EUR food2 опечатка") as any, env);
        const n = await d1.prepare("SELECT COUNT(*) AS n FROM expenses").first<{ n: number }>();
        expect(n!.n).toBe(0);
        expect(sent.some(t => t.includes("Неизвестная категория") && t.includes("food"))).toBe(true);
    });
});

// ── WRK-22 — bootstrap: один скан expenses ───────────────────────────────────

describe("WRK-22 — bootstrap шарит траты с конвертами", () => {
    it("budget_envelopes bootstrap == standalone getEnvelopesForBootstrap", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [{ id: "eur-main", currency: "EUR" }],
            categories: [{ id: "food", type: "expense", is_active: 1 }],
            currencies: [{ code: "EUR", name: "Euro" }],
            expenses: [{ id: "e1", date: "2026-05-10", amount: 10, currency: "EUR", category_id: "food" }],
            rates: [{ date: "2026-05-10", quote: "USD", rate: 1.1 }],
        });
        const boot = await getBootstrapData(env) as any;
        const standalone = await getEnvelopesForBootstrap(env, await loadRatesIndex(env));
        expect(boot.budget_envelopes).toEqual(standalone);
        expect(boot.expenses.length).toBe(1);
    });
});

// ── FIN-06 — r2 на выдаче ────────────────────────────────────────────────────

describe("FIN-06 — net_worth_series: Σ групп == total_eur", () => {
    it("дробные остатки не теряются в аккумуляции by_form/by_currency", async () => {
        const { env, d1 } = makeEnv();
        const accounts = [1, 2, 3, 4, 5].map(i => ({ id: `b${i}`, currency: "EUR", form: "digital" }));
        seed(d1, {
            accounts,
            snapshots: accounts.map(a => ({ id: `s-${a.id}`, date: "2026-01-10", account_id: a.id, amount: 100.004 })),
            rates: [{ date: "2026-01-10", quote: "USD", rate: 1.1 }],
        });
        const d = await getDashboard(env, { today: "2026-06-15" }) as any;
        const last = d.net_worth_series[d.net_worth_series.length - 1];
        // 5 × 100.004 = 500.02; r2-на-каждом-шаге давал 500.00
        expect(last.total_eur).toBe(500.02);
        expect(last.by_form.digital).toBe(500.02);
        expect(last.by_currency.EUR).toBe(500.02);
    });
});

// ── FIN-08 — budgetStatus от r2(spent) ───────────────────────────────────────

describe("FIN-08 — статус бюджета согласован с отображением", () => {
    it("spent чуть выше лимита, но r2 == лимиту → warn (не over)", () => {
        const rates = new RatesIndex();
        rates.finalize();
        const budgets = [{ id: "b1", scope: "category" as const, category_id: "food", limit_eur: 100, name: "Еда" }];
        const expenses = [{ date: "2026-06-10", amount: 100.0000001, currency: "EUR", category_id: "food" }];
        const r = computeBudgetProgress(budgets, expenses, rates, "2026-06");
        expect(r.categories[0].spent_eur).toBe(100);
        expect(r.categories[0].status).toBe("warn");   // экран показывает «100.00 / 100» — не over
    });
    it("r2(spent) > лимита → over (порог не размяк)", () => {
        const rates = new RatesIndex();
        rates.finalize();
        const budgets = [{ id: "b1", scope: "category" as const, category_id: "food", limit_eur: 100, name: "Еда" }];
        const expenses = [{ date: "2026-06-10", amount: 100.005, currency: "EUR", category_id: "food" }];
        const r = computeBudgetProgress(budgets, expenses, rates, "2026-06");
        expect(r.categories[0].status).toBe("over");
    });
});

// ── FIN-11 — legacy-цель: list == detail ─────────────────────────────────────

describe("FIN-11 — legacy-цель без target_currency", () => {
    it("баланс listGoals == баланс getGoalDetail (обе ветки → EUR)", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [{ id: "eur-main", currency: "EUR" }, { id: "rub-bank", currency: "RUB" }],
            goals: [{ id: "g-legacy", name: "Legacy", target_currency: null }],
            goal_contributions: [
                { id: "c1", goal_id: "g-legacy", date: "2026-05-01", amount: 100, currency_code: "EUR", account_id: "eur-main" },
                { id: "c2", goal_id: "g-legacy", date: "2026-05-01", amount: 9000, currency_code: "RUB", account_id: "rub-bank" },
            ],
            rates: [{ date: "2026-05-01", quote: "RUB", rate: 90 }],
        });
        const list = await listGoals(env, { status: "active" });
        const detail = await getGoalDetail(env, "g-legacy");
        // 100 EUR + 9000/90 = 200 EUR; раньше detail давал 100 + 9000 (identity RUB) = 9100
        expect(list[0].balance).toBe(200);
        expect(detail.goal!.balance).toBe(200);
    });
});

// ── FIN-12 — free-формула: dashboard == /accounts ────────────────────────────

describe("FIN-12 — dashboard KPI == /v1/web/accounts summary", () => {
    it("net/targeted/invested/free совпадают на одном моке", async () => {
        const { env, d1 } = makeEnv();
        adminEnv(env);
        const TODAY = "2026-06-15";
        seed(d1, {
            accounts: [
                { id: "eur-main", currency: "EUR" },
                { id: "rub-bank", currency: "RUB" },
                { id: "eth-invest", currency: "ETH", is_investment: 1 },
            ],
            snapshots: [
                { id: "s1", date: "2026-06-01", account_id: "eur-main", amount: 1000 },
                { id: "s2", date: "2026-06-01", account_id: "rub-bank", amount: 90000 },
                { id: "s3", date: "2026-06-01", account_id: "eth-invest", amount: 0.5 },
            ],
            goals: [
                { id: "g1", name: "Fund", target_currency: "EUR" },
                { id: "g-legacy", name: "Legacy", target_currency: null },   // legacy-ветка тоже сверяется
            ],
            goal_contributions: [
                { id: "c1", goal_id: "g1", date: "2026-06-02", amount: 200, currency_code: "EUR", account_id: "eur-main" },
                { id: "c2", goal_id: "g-legacy", date: "2026-06-02", amount: 9000, currency_code: "RUB", account_id: "rub-bank" },
            ],
            incomes: [{ id: "i1", date: "2026-06-03", account_id: "eur-main", amount: 50, currency_code: "EUR", goal_id: "g1" }],
            rates: [
                { date: "2026-06-01", quote: "RUB", rate: 90 },
                { date: "2026-06-01", quote: "ETH", rate: 0.0005 },
            ],
        });
        const dash = await getDashboard(env, { today: TODAY }) as any;
        const accR = await adminFetch(env, `/v1/web/accounts?today=${TODAY}`);
        expect(accR.status).toBe(200);
        const acc = await accR.json() as any;
        expect(acc.summary.net_worth_eur).toBe(dash.kpi.net_worth_eur);
        expect(acc.summary.targeted_eur).toBe(dash.kpi.targeted_eur);
        expect(acc.summary.invested_eur).toBe(dash.kpi.invested_eur);
        expect(acc.summary.free_eur).toBe(dash.kpi.free_net_worth_eur);
        expect(acc.summary.missing_rates).toBe(0);
    });
});

// ── FIN-15 / FIN-18 — fee в валюте актива ────────────────────────────────────

describe("FIN-15 — fee-in-asset не занижает доход стейкинга", () => {
    it("netBought = brutto − fee; staking = qty − netBought", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [
                { id: "usdt-w", currency: "USDT" },
                { id: "eth-invest", currency: "ETH", is_investment: 1 },
            ],
            transactions: [{
                id: "t1", type: "exchange", date: "2026-05-01",
                from_account_id: "usdt-w", to_account_id: "eth-invest",
                from_amount: 1000, from_currency: "USDT", to_amount: 0.5, to_currency: "ETH",
                fee_amount: 0.001, fee_currency: "ETH",   // fee в активе → платит eth-invest
            }],
            // снапшот ПОСЛЕ покупки фиксирует ребейзинг: 0.499 (нетто) + 0.011 награды
            snapshots: [{ id: "s1", date: "2026-06-01", account_id: "eth-invest", amount: 0.51 }],
            rates: [
                { date: "2026-05-01", quote: "USDT", rate: 1.1 },
                { date: "2026-05-01", quote: "ETH", rate: 0.0005 },
                { date: "2026-06-10", quote: "ETH", rate: 0.0004 },
            ],
        });
        const inv = await getInvestments(env, { today: "2026-06-15" }) as any;
        const pos = inv.positions[0];
        expect(pos.qty).toBe(0.51);
        expect(pos.cost_basis_known).toBe(true);
        // qty 0.51 − netBought (0.5 − 0.001 fee) = 0.011; старый код давал 0.01
        expect(pos.staking_income_qty).toBeCloseTo(0.011, 8);
    });
});

describe("FIN-18 — fee-событие входит в events_count", () => {
    it("ведро-плательщик комиссии: tx-out + fee = 2 события", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            accounts: [{ id: "eur-main", currency: "EUR" }, { id: "usd-w", currency: "USD" }],
            transactions: [{
                id: "t1", type: "exchange", date: "2026-06-02",
                from_account_id: "eur-main", to_account_id: "usd-w",
                from_amount: 100, from_currency: "EUR", to_amount: 108, to_currency: "USD",
                fee_amount: 1, fee_currency: "EUR",   // платит from-ведро
            }],
        });
        const eff = await getEffectiveBalance(env, "eur-main");
        expect(eff.balance).toBe(-101);          // −100 − 1 fee (baseline 0)
        expect(eff.events_count).toBe(2);        // раньше 1: fee не считался событием
        const effTo = await getEffectiveBalance(env, "usd-w");
        expect(effTo.events_count).toBe(1);      // to-ведро комиссию не платило
    });
});
