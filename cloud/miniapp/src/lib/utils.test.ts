/**
 * MA-07 (SPEC-048): golden-тесты денежного numpad-ввода. Единственный способ ввода
 * сумм в Mini App — applyNumpadKey; после введения валютного decimal-cap'а (BTC 8 /
 * ETH 6 / RSD 0) базовые и краевые случаи фиксируем тестами.
 */
import { describe, it, expect } from "vitest";
import { applyNumpadKey, CURRENCY_DECIMALS, fmt } from "./utils";

/** Прогоняет последовательность numpad-нажатий от чистого «0». */
function type(seq: string, maxDec?: number): string {
    return [...seq].reduce((acc, k) => applyNumpadKey(acc, k, maxDec), "0");
}

describe("applyNumpadKey — базовые случаи (дефолт 2 знака)", () => {
    it("«0» + цифра заменяет ноль, дальше — конкатенация", () => {
        expect(applyNumpadKey("0", "5")).toBe("5");
        expect(type("125")).toBe("125");
    });
    it("вторая точка блокируется", () => {
        expect(applyNumpadKey("1.2", ".")).toBe("1.2");
        expect(type("1..5")).toBe("1.5");
    });
    it("backspace: до «0», не дальше; оба алиаса клавиши", () => {
        expect(applyNumpadKey("5", "⌫")).toBe("0");
        expect(applyNumpadKey("0", "back")).toBe("0");
        expect(applyNumpadKey("1.5", "⌫")).toBe("1.");
    });
    it("cap 12 цифр (точка не считается)", () => {
        expect(type("1234567890123")).toBe("123456789012");
        expect(applyNumpadKey("1234567890.12", "3")).toBe("1234567890.12");
    });
    it("третий знак после точки не проходит", () => {
        expect(applyNumpadKey("1.23", "4")).toBe("1.23");
    });
});

describe("applyNumpadKey — валютный decimal-cap (MA-07)", () => {
    it("BTC (8 знаков): 0.00000042 вводится целиком", () => {
        expect(type(".00000042", CURRENCY_DECIMALS.BTC)).toBe("0.00000042");
        expect(applyNumpadKey("0.00000042", "1", CURRENCY_DECIMALS.BTC)).toBe("0.00000042");   // 9-й — нет
    });
    it("ETH (6 знаков): 0.005 вводится, 7-й знак — нет", () => {
        expect(type(".005", CURRENCY_DECIMALS.ETH)).toBe("0.005");
        expect(applyNumpadKey("0.123456", "7", CURRENCY_DECIMALS.ETH)).toBe("0.123456");
    });
    it("RSD (0 знаков): точка игнорируется — «12.5 RSD» невозможно набрать", () => {
        expect(applyNumpadKey("12", ".", CURRENCY_DECIMALS.RSD)).toBe("12");
        expect(type("12.5", CURRENCY_DECIMALS.RSD)).toBe("125");
    });
    it("неизвестная валюта → дефолт 2 знака (маппинг caller'а `?? 2`)", () => {
        expect(applyNumpadKey("1.23", "4", CURRENCY_DECIMALS["XXX"] ?? 2)).toBe("1.23");
    });
});

describe("fmt — отображение по знакам валюты (согласовано с вводом)", () => {
    it("RSD целочислен, EUR — 2 знака, BTC — 8", () => {
        expect(fmt(12, "RSD")).toBe("12");
        expect(fmt(27.5, "EUR")).toBe("27,50");
        expect(fmt(0.00000042, "BTC")).toBe("0,00000042");
    });
});
