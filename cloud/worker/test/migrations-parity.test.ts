/**
 * QA-03 (SPEC-046): паритет schema.sql ↔ цепочка миграций.
 *
 * Весь suite гоняется на schema.sql (d1-mock), а прод построен миграциями
 * 0001…NNNN — до этого теста эквивалентность двух путей ничем не гардилась
 * (единственный найденный аудитом механизм, через который зелёные тесты могли
 * бы маскировать денежный баг: расхождение DEFAULT/NOT NULL/индекса).
 *
 * БД №1 — schema.sql. БД №2 — baseline + migrations/*.sql по порядку.
 * Baseline: справочники accounts/categories/currencies/authorized_users
 * создавались ДО 0001 вне цепочки миграций (см. аудит 08-data-integrity § Метод
 * Блок A) — восстановлены в до-миграционной форме: прод-DDL минус ALTER-колонки
 * (0006: accounts.form/sort_order/deleted_at; 0014: accounts.is_investment).
 *
 * Сравнение — нормализованный sqlite_master: множества таблиц, per-таблица
 * МНОЖЕСТВО колонок (имя/тип/NOT NULL/DEFAULT/PK) + индексы (нормализованный
 * SQL, комментарии срезаны). Allowlist известного отличия: ПОРЯДОК колонок
 * после исторических ALTER (потому и множества, а не последовательности).
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// node:sqlite — через createRequire, минуя бандлер (паттерн d1-mock.ts).
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as { DatabaseSync: any };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Baseline-справочники в до-миграционной форме (прод-DDL минус ALTER 0006/0014). */
const BASELINE_SQL = `
CREATE TABLE IF NOT EXISTS authorized_users (
    telegram_id   TEXT PRIMARY KEY,
    name          TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS accounts (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    type          TEXT NOT NULL,
    currency      TEXT NOT NULL,
    is_active     INTEGER NOT NULL DEFAULT 1,
    color         TEXT,
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS categories (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL,
    parent_id   TEXT,
    emoji       TEXT,
    color       TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS currencies (
    code        TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    emoji       TEXT,
    is_crypto   INTEGER NOT NULL DEFAULT 0,
    decimals    INTEGER NOT NULL DEFAULT 2
);
`;

function openDb(): any {
    // FK off — паритет с D1 (как в d1-mock): свобода порядка DDL/DML в миграциях.
    return new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
}

function buildFromSchema(): any {
    const db = openDb();
    db.exec(readFileSync(join(ROOT, "schema.sql"), "utf8"));
    return db;
}

function buildFromMigrations(): { db: any; applied: string[] } {
    const db = openDb();
    db.exec(BASELINE_SQL);
    const dir = join(ROOT, "migrations");
    const files = readdirSync(dir).filter((f: string) => f.endsWith(".sql")).sort();
    for (const f of files) db.exec(readFileSync(join(dir, f), "utf8"));
    return { db, applied: files };
}

/** Нормализация SQL-текста индекса: комментарии срезаны, whitespace схлопнут,
 *  IF NOT EXISTS убран, lowercase — сравнивается смысл, не форматирование. */
function normalizeSql(sql: string): string {
    return sql
        .replace(/--[^\n]*/g, " ")
        .replace(/\s+/g, " ")
        .replace(/if not exists /gi, "")
        .trim()
        .replace(/;$/, "")
        .toLowerCase();
}

/** Нормализация DEFAULT-выражения из PRAGMA: без внешних скобок/пробелов, lowercase. */
function normalizeDefault(v: unknown): string | null {
    if (v == null) return null;
    let s = String(v).trim().toLowerCase().replace(/\s+/g, "");
    while (s.startsWith("(") && s.endsWith(")")) s = s.slice(1, -1);
    return s;
}

interface ColumnShape { type: string; notnull: number; dflt: string | null; pk: boolean }
interface DbShape {
    tables: Record<string, Record<string, ColumnShape>>;   // таблица → МНОЖЕСТВО колонок (по имени)
    indexes: Record<string, string>;                        // имя → нормализованный SQL
}

function shapeOf(db: any): DbShape {
    const tables: DbShape["tables"] = {};
    const tableRows = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as Array<{ name: string }>;
    for (const { name } of tableRows) {
        const cols: Record<string, ColumnShape> = {};
        const info = db.prepare(`PRAGMA table_info(${JSON.stringify(name)})`).all() as Array<any>;
        for (const c of info) {
            cols[String(c.name)] = {
                type: String(c.type).toUpperCase(),
                notnull: Number(c.notnull),
                dflt: normalizeDefault(c.dflt_value),
                pk: Number(c.pk) > 0,   // pk>0 = входит в PK (позиция в составном PK не сравниваем)
            };
        }
        tables[name] = cols;
    }
    const indexes: DbShape["indexes"] = {};
    const idxRows = db
        .prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name")
        .all() as Array<{ name: string; sql: string }>;
    for (const r of idxRows) indexes[r.name] = normalizeSql(r.sql);
    return { tables, indexes };
}

describe("QA-03 — schema.sql ≡ baseline + migrations", () => {
    const declared = shapeOf(buildFromSchema());
    const { db: replayDb, applied } = buildFromMigrations();
    const replay = shapeOf(replayDb);

    it("все миграции найдены и применились по порядку (0001 первая)", () => {
        expect(applied.length).toBeGreaterThanOrEqual(19);
        expect(applied[0]).toBe("0001_device_heartbeats.sql");
        // порядок строго возрастает — сортировка по имени = порядок применения
        expect([...applied].sort()).toEqual(applied);
    });

    it("множество таблиц совпадает", () => {
        expect(Object.keys(replay.tables).sort()).toEqual(Object.keys(declared.tables).sort());
    });

    it("колонки каждой таблицы: имя/тип/NOT NULL/DEFAULT/PK совпадают (порядок — allowlisted)", () => {
        for (const table of Object.keys(declared.tables)) {
            // сообщение об ошибке укажет таблицу: сравниваем per-таблицу
            expect({ [table]: replay.tables[table] }).toEqual({ [table]: declared.tables[table] });
        }
    });

    it("индексы: одинаковые имена и нормализованный DDL", () => {
        expect(replay.indexes).toEqual(declared.indexes);
    });
});
