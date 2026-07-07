/**
 * QA-08 (SPEC-046): парсер текстового ввода трат бота (ADR-009 fallback-канал).
 * До этого bot.ts не исполнялся тестами вовсе; регрессия парсера — тихо
 * испорченная запись расхода (не та валюта / мусорная категория).
 */
import { describe, it, expect } from "vitest";
import { parseExpense } from "../src/bot";

describe("parseExpense — валидные форматы", () => {
    it("канонический: '50 EUR food продукты'", () => {
        expect(parseExpense("50 EUR food продукты")).toEqual({
            amount: 50, currency: "EUR", category: "food", note: "продукты",
        });
    });

    it("дробная сумма + lowercase-валюта: '49.99 usd taxi' (валюта → UPPER, категория → lower)", () => {
        expect(parseExpense("49.99 usd taxi")).toEqual({
            amount: 49.99, currency: "USD", category: "taxi", note: undefined,
        });
    });

    it("запятая как десятичный разделитель: '49,99 eur food' → 49.99", () => {
        expect(parseExpense("49,99 eur food")).toEqual({
            amount: 49.99, currency: "EUR", category: "food", note: undefined,
        });
    });

    it("категория нормализуется к lowercase, note сохраняет регистр", () => {
        expect(parseExpense("10 EUR Food Кофе с собой")).toEqual({
            amount: 10, currency: "EUR", category: "food", note: "Кофе с собой",
        });
    });

    it("USDT (4-буквенная валюта) проходит — regex допускает 3-5 букв [известно, roadmap]", () => {
        expect(parseExpense("25 usdt food")).toMatchObject({ currency: "USDT" });
    });
});

describe("parseExpense — reject", () => {
    it("отрицательная сумма → null (знак матчится, но amount <= 0 режется)", () => {
        expect(parseExpense("-5 EUR food")).toBeNull();
    });
    it("ноль → null", () => {
        expect(parseExpense("0 EUR food")).toBeNull();
    });
    it("свободный текст → null (бот ответит подсказкой формата)", () => {
        expect(parseExpense("привет")).toBeNull();
        expect(parseExpense("")).toBeNull();
        expect(parseExpense("как дела 50")).toBeNull();
    });
    it("валюта 6+ букв → null (regex {3,5})", () => {
        expect(parseExpense("50 DOLLAR food")).toBeNull();
    });
    it("валюта короче 3 букв / цифры в валюте → null", () => {
        expect(parseExpense("50 EU food")).toBeNull();
        expect(parseExpense("50 EU1 food")).toBeNull();
    });
    it("нет категории → null (сумма+валюта недостаточны)", () => {
        expect(parseExpense("50 EUR")).toBeNull();
    });
});
