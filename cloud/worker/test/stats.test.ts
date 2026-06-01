import { describe, it, expect } from "vitest";
import {
    mean, median, pstdev, mad, madScaled, quantile, theilSen,
    covRobust, zeroFraction, acf, clamp, K_MAD,
} from "../src/stats";

describe("stats — базовые", () => {
    it("mean / median / pstdev", () => {
        expect(mean([1, 2, 3, 4])).toBe(2.5);
        expect(median([3, 1, 2])).toBe(2);
        expect(median([4, 1, 2, 3])).toBe(2.5);
        expect(median([])).toBe(0);
        expect(pstdev([2, 2, 2])).toBe(0);
    });

    it("MAD и масштабирование 1.4826", () => {
        // median=3, |dev|={2,1,0,1,2} → MAD=1
        const xs = [1, 2, 3, 4, 5];
        expect(mad(xs)).toBe(1);
        expect(madScaled(xs)).toBeCloseTo(K_MAD, 5);
    });

    it("quantile линейная интерполяция (type-7)", () => {
        const xs = [10, 20, 30, 40, 50];
        expect(quantile(xs, 0)).toBe(10);
        expect(quantile(xs, 1)).toBe(50);
        expect(quantile(xs, 0.5)).toBe(30);
        expect(quantile(xs, 0.8)).toBeCloseTo(42, 5);
        expect(quantile([], 0.8)).toBe(0);
        expect(quantile([7], 0.8)).toBe(7);
    });

    it("Theil-Sen робастен к выбросу (vs OLS)", () => {
        // чистый рост +10/шаг
        expect(theilSen([0, 10, 20, 30, 40])).toBe(10);
        // тот же рост, но последний — гигантский спайк: TS почти не дрогнет
        const spiked = [0, 10, 20, 30, 5000];
        expect(theilSen(spiked)).toBeLessThan(30);   // OLS бы дал ~700+
        expect(theilSen(spiked)).toBeGreaterThan(5);
    });

    it("covRobust / zeroFraction / acf", () => {
        expect(zeroFraction([0, 0, 1, 2])).toBe(0.5);
        expect(covRobust([100, 100, 100, 100])).toBe(0);   // нет разброса
        expect(acf([1, 2, 3], 12)).toBe(0);                // мало точек → 0
        // сезонный сигнал период 3 → acf(lag=3) высокая
        const seas = [1, 5, 2, 1, 5, 2, 1, 5, 2, 1, 5, 2, 1, 5];
        expect(acf(seas, 3)).toBeGreaterThan(0.5);
    });

    it("clamp", () => {
        expect(clamp(5, 0, 10)).toBe(5);
        expect(clamp(-1, 0, 10)).toBe(0);
        expect(clamp(99, 0, 10)).toBe(10);
    });
});
