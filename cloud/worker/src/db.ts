/**
 * D1 access helpers. После pivot к D1-centric архитектуре, D1 — источник правды
 * для всех expenses. Mini App пишет напрямую через CRUD endpoints.
 */
import type { Env, ExpensePayload } from "./types";
import { loadRatesIndex, type RatesIndex } from "./rates";
import { getEffectiveBalance } from "./snapshots";
import { roundMoney, canonicalTs } from "./ledger";
import { getBudgetsWithProgress } from "./budgets";
import { getEnvelopesForBootstrap } from "./rbar";

// ─── App config (key/value, SPEC-027) ───────────────────────────────────────
export async function getAppConfig(env: Env, key: string): Promise<string | null> {
    const r = await env.DB.prepare("SELECT value FROM app_config WHERE key = ?").bind(key).first<{ value: string }>();
    return r?.value ?? null;
}

export async function setAppConfig(env: Env, key: string, value: string): Promise<void> {
    await env.DB.prepare(
        `INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    ).bind(key, value).run();
}

export async function isAuthorizedUser(env: Env, telegramId: string): Promise<boolean> {
    const row = await env.DB
        .prepare("SELECT 1 FROM authorized_users WHERE telegram_id = ?")
        .bind(telegramId)
        .first();
    return !!row;
}

// ─── Expenses CRUD ──────────────────────────────────────────────────────────

/**
 * SPEC-032: согласованность валюта↔счёт. Трата со счётом обязана быть в native-валюте
 * ведра — баланс (`effective_balance`, SPEC-011) вычитает её именно в этой валюте, иначе
 * «999 RSD на RUB-ведре» тихо искажает баланс. Возвращает текст ошибки, если счёт задан,
 * его валюта известна и ≠ валюте траты, а осознанный override не выставлен; иначе null
 * (всё ок / нет счёта / ведро не найдено → не блокируем первичный flow).
 */
async function currencyMismatchError(
    env: Env,
    accountId: string | null | undefined,
    currency: string,
    allowMismatch?: boolean,
): Promise<string | null> {
    if (!accountId || allowMismatch) return null;
    const acc = await env.DB
        .prepare("SELECT name, currency FROM accounts WHERE id = ? AND deleted_at IS NULL")
        .bind(accountId)
        .first<{ name: string; currency: string }>();
    if (!acc || acc.currency === currency) return null;
    return `валюта траты (${currency}) не совпадает с валютой счёта «${acc.name}» (${acc.currency})`;
}

/** SPEC-026 AC18 / SPEC-042: инвест-ведро — актив, не операционный счёт. Трата с него
 *  ломает реплей qty vs value_series в investments.ts (доход стейкинга занижается). */
async function investmentAccountError(env: Env, accountId: string | null | undefined): Promise<string | null> {
    if (!accountId) return null;
    const acc = await env.DB
        .prepare("SELECT name, is_investment FROM accounts WHERE id = ? AND deleted_at IS NULL")
        .bind(accountId)
        .first<{ name: string; is_investment: number }>();
    if (!acc || !acc.is_investment) return null;
    return `нельзя записать трату с инвест-ведра «${acc.name}»`;
}

export async function createExpense(env: Env, userId: string, e: ExpensePayload): Promise<{ ok: true; inserted: boolean } | { ok: false; error: string }> {
    // Идемпотентность (CLAUDE.md §6 / SPEC-042): ретрай с тем же id должен вернуть
    // inserted:false, а не споткнуться о guard'ы ниже (overdraft уже «съеден» первой
    // вставкой — повтор дал бы ложное «недостаточно средств»).
    const dup = await env.DB.prepare("SELECT 1 FROM expenses WHERE id = ?").bind(e.id).first();
    if (dup) return { ok: true, inserted: false };
    // SPEC-032: трата со счётом обязана быть в валюте ведра (см. currencyMismatchError).
    const ccyErr = await currencyMismatchError(env, e.account_id, e.currency, e.allow_currency_mismatch);
    if (ccyErr) return { ok: false, error: ccyErr };
    const invErr = await investmentAccountError(env, e.account_id);
    if (invErr) return { ok: false, error: invErr };
    // Overdraft (L1, SPEC-011 §G6): не даём ведру уйти в минус — но ТОЛЬКО если у
    // ведра есть manual baseline (без него нет ground truth, чтобы судить о минусе;
    // первичный flow Mini App без снапшота не ломаем). asOf = дата траты.
    if (e.account_id && e.date && typeof e.amount === "number" && e.amount > 0) {
        const eff = await getEffectiveBalance(env, e.account_id, e.date);
        if (eff.manual_baseline && roundMoney(eff.balance - e.amount) < 0) {
            return { ok: false, error: `недостаточно средств в ведре (доступно: ${eff.balance.toFixed(2)}, нужно: ${e.amount.toFixed(2)})` };
        }
    }
    // created_at ставит СЕРВЕР (datetime('now'), каноничный формат) — порядок ввода
    // = время записи на сервере, а не часы телефона (SPEC-024). Клиентский e.created_at
    // намеренно игнорируется: tie-break баланса внутри дня должен быть монотонным и
    // не зависеть от рассинхрона часов устройства.
    const r = await env.DB.prepare(
        `INSERT OR IGNORE INTO expenses
           (id, date, account_id, amount, currency, category_id, note, source, source_record_id, user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    )
        .bind(
            e.id,
            e.date,
            e.account_id ?? null,
            e.amount,
            e.currency,
            e.category_id ?? null,
            e.note ?? null,
            e.source ?? "mini_app",
            e.source_record_id ?? null,
            userId,
        )
        .run();
    return { ok: true, inserted: (r.meta.changes ?? 0) > 0 };
}

export async function updateExpense(env: Env, id: string, userId: string, patch: any): Promise<{ ok: true; updated: boolean } | { ok: false; error: string }> {
    // PATCH-семантика: отсутствие ключа → оставить старое; явный null → стереть.
    // Для nullable-полей (note, account_id, category_id) различаем «не передан» и
    // «стереть» через hasOwnProperty (WRK-01: COALESCE молча глотал account_id: null —
    // «без счёта» в Edit не работало, ведро продолжало худеть).
    const hasNote = Object.prototype.hasOwnProperty.call(patch, "note");
    const hasAccount = Object.prototype.hasOwnProperty.call(patch, "account_id");
    const hasCategory = Object.prototype.hasOwnProperty.call(patch, "category_id");
    // SPEC-032: валидируем согласованность валюта↔счёт по РЕЗУЛЬТИРУЮЩИМ значениям, но только
    // если патч реально трогает валюту или счёт (иначе инвариант измениться не может — экономим
    // лишний SELECT в горячем пути правки note/amount/date).
    if (hasAccount || patch.currency !== undefined) {
        const existing = await env.DB
            .prepare("SELECT account_id, currency FROM expenses WHERE id = ? AND user_id = ? AND deleted_at IS NULL")
            .bind(id, userId)
            .first<{ account_id: string | null; currency: string }>();
        if (existing) {
            const resAccount = hasAccount ? (patch.account_id ?? null) : existing.account_id;
            const resCurrency = patch.currency ?? existing.currency;
            const ccyErr = await currencyMismatchError(env, resAccount, resCurrency, patch.allow_currency_mismatch);
            if (ccyErr) return { ok: false, error: ccyErr };
            const invErr = await investmentAccountError(env, resAccount);
            if (invErr) return { ok: false, error: invErr };
        }
    }
    const sql =
        `UPDATE expenses
         SET date         = COALESCE(?, date),
             amount       = COALESCE(?, amount),
             currency     = COALESCE(?, currency),
             category_id  = ${hasCategory ? "?" : "category_id"},
             account_id   = ${hasAccount ? "?" : "account_id"},
             note         = ${hasNote ? "?" : "note"},
             updated_at   = datetime('now')
         WHERE id = ? AND user_id = ? AND deleted_at IS NULL`;
    const params: any[] = [
        patch.date ?? null,
        patch.amount ?? null,
        patch.currency ?? null,
    ];
    if (hasCategory) params.push(patch.category_id ?? null);
    if (hasAccount) params.push(patch.account_id ?? null);
    if (hasNote) params.push(patch.note ?? null);
    params.push(id, userId);
    const r = await env.DB.prepare(sql).bind(...params).run();
    return { ok: true, updated: (r.meta.changes ?? 0) > 0 };
}

export async function deleteExpense(env: Env, id: string, userId: string): Promise<{ deleted: boolean }> {
    const r = await env.DB.prepare(
        `UPDATE expenses
         SET deleted_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    )
        .bind(id, userId)
        .run();
    return { deleted: (r.meta.changes ?? 0) > 0 };
}

export async function listExpenses(env: Env, options: { limit?: number; from?: string }, rates?: RatesIndex): Promise<any[]> {
    const limit = Math.min(options.limit ?? 10000, 20000);
    let sql = "SELECT id, date, account_id, amount, currency, category_id, note, source, created_at, updated_at " +
              "FROM expenses WHERE deleted_at IS NULL";
    const params: any[] = [];
    if (options.from) {
        sql += " AND date >= ?";
        params.push(options.from);
    }
    sql += " ORDER BY date DESC, created_at DESC LIMIT ?";
    params.push(limit);
    const r = await env.DB.prepare(sql).bind(...params).all();
    const rows = r.results as any[];

    // EUR-эквивалент date-aware (по курсу на дату траты — расход это поток,
    // ADR-014/SPEC-016). Покрывает Mini App day-total + Admin /expenses + bootstrap.
    // SPEC-038: rates можно передать (bootstrap грузит индекс 1× и шарит), иначе грузим.
    const idx = rates ?? await loadRatesIndex(env);
    for (const row of rows) {
        const eur = idx.toEurAt(row.amount, row.currency, row.date);
        row.amount_eur = eur == null ? null : Math.round(eur * 100) / 100;
    }
    return rows;
}

export async function bulkInsertExpenses(env: Env, expenses: any[]): Promise<number> {
    const stmts = [];
    for (const e of expenses) {
        stmts.push(
            env.DB.prepare(
                `INSERT OR IGNORE INTO expenses
                   (id, date, account_id, amount, currency, category_id, note, source, source_record_id, user_id, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ).bind(
                e.id,
                e.date,
                e.account_id ?? null,
                e.amount,
                e.currency,
                e.category_id ?? null,
                e.note ?? null,
                e.source ?? "migration",
                e.source_record_id ?? null,
                e.user_id ?? "migration",
                // Импорт сохраняет историческое время, но канонизируем формат под
                // 'YYYY-MM-DD HH:MM:SS' (SPEC-024), чтобы created_at сравнивался корректно.
                canonicalTs(e.created_at ?? new Date().toISOString()),
                canonicalTs(e.updated_at ?? e.created_at ?? new Date().toISOString()),
            ),
        );
    }
    if (stmts.length === 0) return 0;
    const results = await env.DB.batch(stmts);
    return results.reduce((acc, r) => acc + (r.meta.changes ?? 0), 0);
}

// ─── References ────────────────────────────────────────────────────────────

interface ReferencePayload {
    accounts?: any[];
    categories?: any[];
    currencies?: any[];
}

export async function replaceReferences(env: Env, payload: ReferencePayload): Promise<void> {
    const stmts = [];
    if (payload.currencies) {
        stmts.push(env.DB.prepare("DELETE FROM currencies"));
        for (const c of payload.currencies) {
            stmts.push(
                env.DB.prepare(
                    "INSERT INTO currencies (code, name, emoji, is_crypto, decimals) VALUES (?, ?, ?, ?, ?)",
                ).bind(c.code, c.name, c.emoji ?? null, c.is_crypto ?? 0, c.decimals ?? 2),
            );
        }
    }
    if (payload.accounts) {
        stmts.push(env.DB.prepare("DELETE FROM accounts"));
        for (const a of payload.accounts) {
            // form/sort_order/is_investment несём из payload — иначе DELETE+INSERT
            // сбрасывал бы форму вёдер на 'digital' и инвест-флаг на 0 (SPEC-026).
            stmts.push(
                env.DB.prepare(
                    "INSERT INTO accounts (id, name, type, currency, is_active, color, form, sort_order, is_investment, updated_at) " +
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
                ).bind(
                    a.id, a.name, a.type, a.currency, a.is_active ?? 1, a.color ?? null,
                    a.form ?? "digital", a.sort_order ?? 0, a.is_investment ?? 0,
                ),
            );
        }
    }
    if (payload.categories) {
        stmts.push(env.DB.prepare("DELETE FROM categories"));
        for (const c of payload.categories) {
            stmts.push(
                env.DB.prepare(
                    "INSERT INTO categories (id, name, type, parent_id, emoji, color, sort_order, is_active, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
                ).bind(
                    c.id,
                    c.name,
                    c.type,
                    c.parent_id ?? null,
                    c.emoji ?? null,
                    c.color ?? null,
                    c.sort_order ?? 0,
                    c.is_active ?? 1,
                ),
            );
        }
    }
    if (stmts.length > 0) await env.DB.batch(stmts);
}

// ─── Bootstrap (для Mini App при старте) ────────────────────────────────────

export async function getBootstrapData(env: Env, opts: { withExpenses?: boolean; withBudgets?: boolean } = {}) {
    const withExpenses = opts.withExpenses ?? true;
    const withBudgets = opts.withBudgets ?? true;   // refs (Admin) не нужны бюджеты-подсказки
    // SPEC-038: RatesIndex = скан всей таблицы rates. Грузим ОДИН раз и шарим в
    // listExpenses/getBudgetsWithProgress/getEnvelopesForBootstrap (раньше — 3× за bootstrap).
    // refs (Admin: оба флага false) индекс не нужен — пропускаем загрузку.
    const ratesIdx = withExpenses || withBudgets ? await loadRatesIndex(env) : undefined;
    const [accounts, categories, currencies, expenses, ratesMaxDate, budgets, envelopes] = await Promise.all([
        env.DB.prepare("SELECT * FROM accounts WHERE is_active = 1").all(),
        // Все категории (вкл. неактивные) — чтобы история сохраняла подпись после
        // деактивации (SPEC-017 AC4); выбор фильтрует is_active на клиенте.
        env.DB.prepare("SELECT * FROM categories ORDER BY sort_order, name").all(),
        env.DB.prepare("SELECT * FROM currencies").all(),
        withExpenses ? listExpenses(env, { limit: 20000 }, ratesIdx) : Promise.resolve([] as any[]),   // refs не нужны траты (Фаза 1.8); amount_eur date-aware (ADR-014/SPEC-016)
        env.DB.prepare("SELECT MAX(date) AS d FROM rates").first<{ d: string | null }>(),
        // SPEC-020: read-only бюджет-подсказка «осталось X» при вводе траты в Mini App.
        withBudgets ? getBudgetsWithProgress(env, {}, ratesIdx) : Promise.resolve(null),
        // SPEC-023: read-only lens годового конверта для lumpy-категорий.
        withBudgets ? getEnvelopesForBootstrap(env, ratesIdx) : Promise.resolve([] as any[]),
    ]);
    const date = ratesMaxDate?.d ?? null;
    let rates: Record<string, number> = {};
    if (date) {
        const r = await env.DB.prepare(
            "SELECT quote, rate FROM rates WHERE date = ? AND base = 'EUR'",
        ).bind(date).all<{ quote: string; rate: number }>();
        for (const row of r.results) rates[row.quote] = row.rate;
    }
    return {
        accounts: accounts.results,
        categories: categories.results,
        currencies: currencies.results,
        expenses,
        rates: { date, base: "EUR", quotes: rates },
        budgets,
        budget_envelopes: envelopes,
    };
}
