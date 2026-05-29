import { describe, it, expect } from "vitest";
import {
    expenseCreateSchema, incomeCreateSchema, transactionCreateSchema,
    contributionCreateSchema, goalStatusSchema, snapshotCreateSchema, zodMessage,
} from "../src/schemas";

describe("SPEC-019 Zod schemas — shape-валидация", () => {
    it("incomeCreate: отклоняет без amount (AC1)", () => {
        const r = incomeCreateSchema.safeParse({ date: "2026-05-01", account_id: "eur-cash", category_id: "salary" });
        expect(r.success).toBe(false);
    });
    it("incomeCreate: отклоняет неположительный amount", () => {
        expect(incomeCreateSchema.safeParse({ date: "2026-05-01", account_id: "a", category_id: "c", amount: 0 }).success).toBe(false);
        expect(incomeCreateSchema.safeParse({ date: "2026-05-01", account_id: "a", category_id: "c", amount: -5 }).success).toBe(false);
    });
    it("incomeCreate: принимает валидный", () => {
        expect(incomeCreateSchema.safeParse({ date: "2026-05-01", account_id: "a", category_id: "c", amount: 1200 }).success).toBe(true);
    });

    it("transactionCreate: отклоняет неверный type-enum (AC2)", () => {
        const r = transactionCreateSchema.safeParse({
            type: "foo", date: "2026-05-01", from_account_id: "a", to_account_id: "b", from_amount: 1, to_amount: 1,
        });
        expect(r.success).toBe(false);
    });
    it("transactionCreate: принимает exchange/transfer", () => {
        const base = { date: "2026-05-01", from_account_id: "a", to_account_id: "b", from_amount: 100, to_amount: 90 };
        expect(transactionCreateSchema.safeParse({ ...base, type: "exchange" }).success).toBe(true);
        expect(transactionCreateSchema.safeParse({ ...base, type: "transfer" }).success).toBe(true);
    });
    it("transactionCreate: fee_amount не может быть отрицательным", () => {
        expect(transactionCreateSchema.safeParse({
            type: "exchange", date: "2026-05-01", from_account_id: "a", to_account_id: "b",
            from_amount: 100, to_amount: 90, fee_amount: -1, fee_currency: "EUR",
        }).success).toBe(false);
    });

    it("expenseCreate: отклоняет amount строкой (AC3)", () => {
        expect(expenseCreateSchema.safeParse({ id: "u", date: "2026-05-01", amount: "x", currency: "EUR" }).success).toBe(false);
    });
    it("expenseCreate: отклоняет плохой формат даты", () => {
        expect(expenseCreateSchema.safeParse({ id: "u", date: "01.05.2026", amount: 5, currency: "EUR" }).success).toBe(false);
    });
    it("expenseCreate: принимает валидный (account_id опционален)", () => {
        expect(expenseCreateSchema.safeParse({ id: "u", date: "2026-05-01", amount: 5, currency: "EUR" }).success).toBe(true);
    });

    it("contributionCreate: отклоняет без account_id (AC4 / L4)", () => {
        expect(contributionCreateSchema.safeParse({ goal_id: "g", date: "2026-05-01", amount: 100 }).success).toBe(false);
    });
    it("contributionCreate: принимает с account_id", () => {
        expect(contributionCreateSchema.safeParse({ goal_id: "g", date: "2026-05-01", amount: 100, account_id: "eur-cash" }).success).toBe(true);
    });

    it("snapshotCreate: amount может быть 0 (это баланс)", () => {
        expect(snapshotCreateSchema.safeParse({ date: "2026-05-01", account_id: "a", amount: 0 }).success).toBe(true);
    });

    it("goalStatus: только enum", () => {
        expect(goalStatusSchema.safeParse({ status: "active" }).success).toBe(true);
        expect(goalStatusSchema.safeParse({ status: "done" }).success).toBe(false);
    });

    it("zodMessage: человекочитаемое сообщение с путём поля", () => {
        const r = incomeCreateSchema.safeParse({ date: "2026-05-01", account_id: "a", category_id: "c" });
        expect(r.success).toBe(false);
        if (!r.success) {
            const msg = zodMessage(r.error);
            expect(typeof msg).toBe("string");
            expect(msg).toContain("amount");
        }
    });
});
