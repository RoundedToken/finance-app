/**
 * In-memory D1 мок на node:sqlite (встроен в Node 24, без новых зависимостей).
 * SPEC-022. D1 == SQLite, поэтому грузим реальную schema.sql и гоняем
 * НАСТОЯЩИЙ SQL воркера — ловит и логику, и SQL-баги (фильтры дат, JOIN,
 * оконные суммы). Реализует используемый воркером срез D1Database:
 * prepare().bind(...).all<T>()/.first<T>()/.run() + batch().
 *
 * Типы node:sqlite не поставляются (@types/node нет; test/ вне tsconfig
 * include — vitest гоняет через esbuild без typecheck), поэтому модуль
 * импортируется без типов — это ок.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// node:sqlite — новый встроенный модуль; Vite/esbuild его не знает и пытается
// резолвить как "sqlite". Грузим через createRequire (рантайм-резолв Node),
// минуя бандлер. Типов нет (@types/node отсутствует) — берём untyped.
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as { DatabaseSync: any };

const SCHEMA = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "schema.sql"),
    "utf8",
);

/** Bound statement — повторяет форму D1PreparedStatement (всё async). */
class MockStatement {
    constructor(private d1: MockD1, private sql: string, private params: unknown[] = []) {}

    bind(...args: unknown[]): MockStatement {
        return new MockStatement(this.d1, this.sql, args);
    }

    async all<T = unknown>(): Promise<{ results: T[]; success: true; meta: Record<string, unknown> }> {
        const results = this.d1.compiled(this.sql).all(...this.params) as T[];
        return { results, success: true, meta: {} };
    }

    async first<T = unknown>(): Promise<T | null> {
        const row = this.d1.compiled(this.sql).get(...this.params);
        return (row ?? null) as T | null;   // D1: нет строки → null (node:sqlite → undefined)
    }

    async run(): Promise<{ success: true; meta: { changes: number; last_row_id: number } }> {
        const r = this.d1.compiled(this.sql).run(...this.params);
        return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    }
}

export class MockD1 {
    readonly db: InstanceType<typeof DatabaseSync>;
    private cache = new Map<string, ReturnType<InstanceType<typeof DatabaseSync>["prepare"]>>();

    constructor() {
        // enableForeignKeyConstraints:false — паритет с D1 (FK по умолчанию НЕ
        // форсятся; node:sqlite иначе форсит). Свобода порядка сидов.
        // readBigInts намеренно НЕ включаем: COUNT/SUM/INTEGER приходят как plain
        // number (как D1) — иначе .toBe() на events_count/балансах сломается на BigInt.
        this.db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
        this.db.exec(SCHEMA);
    }

    /** Кэш скомпилированных statements по SQL-строке (как D1 reuse). */
    compiled(sql: string) {
        let s = this.cache.get(sql);
        if (!s) { s = this.db.prepare(sql); this.cache.set(sql, s); }
        return s;
    }

    prepare(sql: string): MockStatement {
        return new MockStatement(this, sql);
    }

    /** D1.batch — атомарно (BEGIN/COMMIT), возвращает массив run-результатов. */
    async batch(stmts: MockStatement[]): Promise<unknown[]> {
        this.db.exec("BEGIN");
        try {
            const out: unknown[] = [];
            for (const s of stmts) out.push(await s.run());
            this.db.exec("COMMIT");
            return out;
        } catch (e) {
            this.db.exec("ROLLBACK");
            throw e;
        }
    }
}

/** Env с одним только DB — getEffectiveBalance/getDashboard/listGoals/loadRatesIndex
 *  больше ничего из env не трогают. Каст — тесты не типизируются. */
export function makeEnv(): { env: any; d1: MockD1 } {
    const d1 = new MockD1();
    return { env: { DB: d1 }, d1 };
}

type Row = Record<string, unknown>;

// Дефолты NOT NULL-колонок (без default в schema.sql) — тесты задают только
// значимое. Порядок: defaults → ...r (значения вызывающего перекрывают).
const FILL: Record<string, (r: Row) => Row> = {
    accounts: r => ({ type: "bank", name: String(r.id), is_active: 1, color: null, form: "digital", sort_order: 0, deleted_at: null, updated_at: "2020-01-01 00:00:00", ...r }),
    snapshots: r => ({ note: null, source: "manual", transaction_id: null, created_at: `${r.date ?? "2020-01-01"} 00:00:00`, updated_at: "2020-01-01 00:00:00", deleted_at: null, ...r }),
    incomes: r => ({ category_id: "ic", source: null, note: null, goal_id: null, created_at: "2020-01-01 00:00:00", updated_at: "2020-01-01 00:00:00", deleted_at: null, ...r }),
    expenses: r => ({ user_id: "u", account_id: null, category_id: null, note: null, source: "test", source_record_id: null, created_at: "2020-01-01 00:00:00", updated_at: "2020-01-01 00:00:00", deleted_at: null, ...r }),
    transactions: r => ({ type: "exchange", fee_amount: null, fee_currency: null, note: null, chain_id: null, chain_sequence: null, goal_id: null, created_at: "2020-01-01 00:00:00", updated_at: "2020-01-01 00:00:00", deleted_at: null, ...r }),
    goal_contributions: r => ({ account_id: null, note: null, created_at: "2020-01-01 00:00:00", updated_at: "2020-01-01 00:00:00", deleted_at: null, ...r }),
    rates: r => ({ base: "EUR", source: "test", fetched_at: "2020-01-01 00:00:00", ...r }),
    rate_ticks: r => ({ base: "EUR", source: "test", fetched_at: "2020-01-01 00:00:00", ...r }),
    goals: r => ({ emoji: null, color: null, target_amount: null, target_currency: null, deadline: null, note: null, status: "active", sort_order: 0, created_at: "2020-01-01 00:00:00", updated_at: "2020-01-01 00:00:00", deleted_at: null, ...r }),
    categories: r => ({ type: "expense", name: String(r.id), parent_id: null, emoji: null, color: null, sort_order: 0, is_active: 1, updated_at: "2020-01-01 00:00:00", ...r }),
    income_categories: r => ({ name: String(r.id), emoji: null, color: null, sort_order: 0, is_active: 1, created_at: "2020-01-01 00:00:00", ...r }),
};

/** Сидинг: seed(d1, { accounts:[...], snapshots:[...], rates:[...] }). Заполняет
 *  NOT NULL-дефолты, вставляет напрямую (минуя async-обёртку). */
export function seed(d1: MockD1, data: Record<string, Row[]>): void {
    for (const [table, rows] of Object.entries(data)) {
        const fill = FILL[table];
        for (const raw of rows) {
            const row = fill ? fill(raw) : raw;
            const cols = Object.keys(row);
            const sql = `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
            d1.db.prepare(sql).run(...cols.map(c => row[c]));
        }
    }
}
