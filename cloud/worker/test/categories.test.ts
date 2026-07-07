/**
 * QA-07 (SPEC-046): CRUD категорий (SPEC-017) — create/rename/деактивация.
 * Ключевой инвариант: «удаление» мягкое (is_active=0) — история трат цела.
 */
import { describe, it, expect } from "vitest";
import {
    listExpenseCategories, createExpenseCategory, updateExpenseCategory,
    createIncomeCategory, updateIncomeCategory,
} from "../src/categories";
import { makeEnv, seed } from "./d1-mock";

describe("createExpenseCategory", () => {
    it("создаёт type='expense', sort_order авто = max+10", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, { categories: [{ id: "food", sort_order: 40 }] });
        const r = await createExpenseCategory(env, { name: "Спорт", emoji: "🏃" });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const row = d1.db.prepare("SELECT * FROM categories WHERE id = ?").get(r.id) as any;
        expect(row.type).toBe("expense");
        expect(row.name).toBe("Спорт");
        expect(row.sort_order).toBe(50);          // 40 + 10 (в конец списка)
        expect(row.is_active).toBe(1);
    });

    it("пустое имя / битый цвет → ошибка валидации (handler мапит в 400)", async () => {
        const { env } = makeEnv();
        expect((await createExpenseCategory(env, { name: "  " })).ok).toBe(false);
        expect((await createExpenseCategory(env, { name: "X", color: "red" })).ok).toBe(false);
        expect((await createExpenseCategory(env, { name: "X", color: "#12345" })).ok).toBe(false);
        expect((await createExpenseCategory(env, { name: "X", color: "#a1b2c3" })).ok).toBe(true);
    });

    it("идемпотентность по id: повтор → inserted:false", async () => {
        const { env } = makeEnv();
        const r1 = await createExpenseCategory(env, { id: "c1", name: "A" });
        const r2 = await createExpenseCategory(env, { id: "c1", name: "B" });
        expect(r1.ok && r1.inserted).toBe(true);
        expect(r2.ok && !("inserted" in r2 && r2.inserted)).toBe(true);   // INSERT OR IGNORE
    });
});

describe("updateExpenseCategory — rename и деактивация", () => {
    it("rename меняет имя, не трогая остальное", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, { categories: [{ id: "food", name: "Еда", emoji: "🍔" }] });
        const r = await updateExpenseCategory(env, "food", { name: "Продукты" });
        expect(r.ok && (r as any).updated).toBe(true);
        const row = d1.db.prepare("SELECT name, emoji FROM categories WHERE id = 'food'").get() as any;
        expect(row).toMatchObject({ name: "Продукты", emoji: "🍔" });
    });

    it("деактивация is_active=0: уходит из выбора, но история трат ЦЕЛА", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, {
            categories: [{ id: "food", name: "Еда" }, { id: "taxi", name: "Такси" }],
            expenses: [{ id: "e1", date: "2026-06-10", amount: 10, currency: "EUR", category_id: "food" }],
        });
        const r = await updateExpenseCategory(env, "food", { is_active: false });
        expect(r.ok && (r as any).updated).toBe(true);

        // из активного списка ушла…
        expect((await listExpenseCategories(env)).map((c: any) => c.id)).toEqual(["taxi"]);
        // …но с include_inactive видна (история сохраняет подпись, SPEC-017 AC4)…
        const all = await listExpenseCategories(env, true);
        expect(all.map((c: any) => c.id).sort()).toEqual(["food", "taxi"]);
        // …и сама трата не тронута — категория НЕ удалена, ссылка жива.
        const e = d1.db.prepare("SELECT category_id, deleted_at FROM expenses WHERE id = 'e1'").get() as any;
        expect(e).toMatchObject({ category_id: "food", deleted_at: null });
    });

    it("несуществующий id → updated:false; income-категории не задеваются (WHERE type='expense')", async () => {
        const { env, d1 } = makeEnv();
        seed(d1, { income_categories: [{ id: "salary", name: "Зарплата" }] });
        const r = await updateExpenseCategory(env, "salary", { name: "X" });   // id из ДРУГОЙ таблицы
        expect(r.ok && !(r as any).updated).toBe(true);
        expect((d1.db.prepare("SELECT name FROM income_categories WHERE id = 'salary'").get() as any).name).toBe("Зарплата");
    });
});

describe("income_categories — create/rename/деактивация", () => {
    it("полный цикл: create → rename → is_active=0", async () => {
        const { env, d1 } = makeEnv();
        const c = await createIncomeCategory(env, { id: "freelance", name: "Фриланс" });
        expect(c.ok && (c as any).inserted).toBe(true);
        const u = await updateIncomeCategory(env, "freelance", { name: "Подработка", is_active: false });
        expect(u.ok && (u as any).updated).toBe(true);
        const row = d1.db.prepare("SELECT name, is_active FROM income_categories WHERE id = 'freelance'").get() as any;
        expect(row).toMatchObject({ name: "Подработка", is_active: 0 });
    });
});
