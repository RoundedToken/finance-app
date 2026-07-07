/**
 * QA-07 (SPEC-046): CRUD-часть snapshots.ts — до этого покрывался только
 * расчётный слой (getEffectiveBalance), а create/update/delete не исполнялись.
 */
import { describe, it, expect } from "vitest";
import { createSnapshot, updateSnapshot, deleteSnapshot, getEffectiveBalance } from "../src/snapshots";
import { makeEnv, seed } from "./d1-mock";

const CANON = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;   // канон created_at (SPEC-024/031)

function makeWorld() {
    const { env, d1 } = makeEnv();
    seed(d1, { accounts: [{ id: "eur-bank", currency: "EUR" }] });
    return { env, d1 };
}

describe("createSnapshot", () => {
    it("создаёт снапшот с каноническим created_at; effective_balance его видит", async () => {
        const { env, d1 } = makeWorld();
        const r = await createSnapshot(env, { id: "s1", date: "2026-06-01", account_id: "eur-bank", amount: 1000 });
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.inserted).toBe(true);
        const row = d1.db.prepare("SELECT * FROM snapshots WHERE id = 's1'").get() as any;
        expect(row.source).toBe("manual");
        expect(String(row.created_at)).toMatch(CANON);
        expect((await getEffectiveBalance(env, "eur-bank", "2026-06-30")).balance).toBe(1000);
    });

    it("идемпотентность по id: повтор → inserted:false, amount первой версии цел", async () => {
        const { env, d1 } = makeWorld();
        await createSnapshot(env, { id: "s1", date: "2026-06-01", account_id: "eur-bank", amount: 1000 });
        const r2 = await createSnapshot(env, { id: "s1", date: "2026-06-01", account_id: "eur-bank", amount: 9999 });
        expect(r2.ok).toBe(true);
        if (r2.ok) expect(r2.inserted).toBe(false);
        expect(d1.db.prepare("SELECT COUNT(*) AS n FROM snapshots").get()).toMatchObject({ n: 1 });
        expect((d1.db.prepare("SELECT amount FROM snapshots WHERE id = 's1'").get() as any).amount).toBe(1000);
    });

    it("unknown account_id → ошибка (handler мапит в 400), снапшот не создаётся", async () => {
        const { env, d1 } = makeWorld();
        const r = await createSnapshot(env, { date: "2026-06-01", account_id: "ghost", amount: 1 });
        expect(r).toEqual({ ok: false, error: "unknown account_id" });
        expect(d1.db.prepare("SELECT COUNT(*) AS n FROM snapshots").get()).toMatchObject({ n: 0 });
    });
});

describe("updateSnapshot / deleteSnapshot", () => {
    it("update меняет amount, баланс пересчитывается", async () => {
        const { env } = makeWorld();
        await createSnapshot(env, { id: "s1", date: "2026-06-01", account_id: "eur-bank", amount: 1000 });
        const r = await updateSnapshot(env, "s1", { amount: 1500 });
        expect(r.ok).toBe(true);
        expect((await getEffectiveBalance(env, "eur-bank", "2026-06-30")).balance).toBe(1500);
    });

    it("delete — soft: строка остаётся с deleted_at, баланс снапшот больше не учитывает", async () => {
        const { env, d1 } = makeWorld();
        await createSnapshot(env, { id: "s1", date: "2026-06-01", account_id: "eur-bank", amount: 1000 });
        const r = await deleteSnapshot(env, "s1");
        expect(r.deleted).toBe(true);
        const row = d1.db.prepare("SELECT deleted_at FROM snapshots WHERE id = 's1'").get() as any;
        expect(row.deleted_at).not.toBeNull();
        expect((await getEffectiveBalance(env, "eur-bank", "2026-06-30")).balance).toBe(0);
        expect((await deleteSnapshot(env, "s1")).deleted).toBe(false);   // повторно — уже нет
    });
});
