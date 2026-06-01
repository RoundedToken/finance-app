/**
 * Робастные статистические примитивы для RBAR (SPEC-023).
 *
 * Чистые функции, без зависимостей и без D1 — тестируются изолированно.
 * Используются классификатором архетипов и законом управления (rbar.ts):
 *   median/MAD — устойчивый центр и масштаб (breakdown 50%, гасит всплески),
 *   Theil-Sen  — устойчивый наклон тренда (на спайке OLS врёт, TS — нет),
 *   quantile   — годовой envelope lumpy-категорий,
 *   acf        — детектор сезонности.
 *
 * Все функции игнорируют форму NaN/пустых массивов разумными дефолтами (0),
 * чтобы холодный старт / пустая категория не роняли расчёт.
 */

/** Константа согласованности MAD↔σ для нормальных данных (1/Φ⁻¹(0.75)). */
export const K_MAD = 1.4826;

export function clamp(x: number, lo: number, hi: number): number {
    return x < lo ? lo : x > hi ? hi : x;
}

export function mean(xs: number[]): number {
    if (!xs.length) return 0;
    let s = 0;
    for (const x of xs) s += x;
    return s / xs.length;
}

export function sum(xs: number[]): number {
    let s = 0;
    for (const x of xs) s += x;
    return s;
}

/** Стандартное отклонение (популяционное). */
export function pstdev(xs: number[]): number {
    if (xs.length < 2) return 0;
    const m = mean(xs);
    let s = 0;
    for (const x of xs) s += (x - m) * (x - m);
    return Math.sqrt(s / xs.length);
}

export function median(xs: number[]): number {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Сырое median absolute deviation (без масштабной константы). */
export function mad(xs: number[]): number {
    if (xs.length < 2) return 0;
    const m = median(xs);
    return median(xs.map(x => Math.abs(x - m)));
}

/** Масштабированный MAD ≈ σ для нормальных данных (k=1.4826). */
export function madScaled(xs: number[]): number {
    return K_MAD * mad(xs);
}

/**
 * Квантиль уровня p∈[0,1], линейная интерполяция (type-7, как numpy по умолчанию).
 * Пустой массив → 0.
 */
export function quantile(xs: number[], p: number): number {
    if (!xs.length) return 0;
    if (xs.length === 1) return xs[0];
    const s = [...xs].sort((a, b) => a - b);
    const h = (s.length - 1) * clamp(p, 0, 1);
    const lo = Math.floor(h);
    const hi = Math.ceil(h);
    if (lo === hi) return s[lo];
    return s[lo] + (h - lo) * (s[hi] - s[lo]);
}

/**
 * Theil-Sen наклон: медиана попарных наклонов (y_j − y_i)/(j − i) при xs = 0..n−1.
 * Устойчив к выбросам (breakdown ~29%) — на одиночном спайке не улетает, в
 * отличие от OLS. O(n²), для n≤~30 (месяцы) пренебрежимо.
 */
export function theilSen(ys: number[]): number {
    const n = ys.length;
    if (n < 2) return 0;
    const slopes: number[] = [];
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            slopes.push((ys[j] - ys[i]) / (j - i));
        }
    }
    return median(slopes);
}

/**
 * Робастный коэффициент вариации: σ_MAD / max(median, ε).
 * Меряем «шум» масштабированным MAD, а не σ — устойчиво к всплескам.
 */
export function covRobust(xs: number[], eps = 1): number {
    const med = median(xs);
    return madScaled(xs) / Math.max(med, eps);
}

/** Доля нулевых (≈0) месяцев. */
export function zeroFraction(xs: number[], eps = 1e-9): number {
    if (!xs.length) return 0;
    let z = 0;
    for (const x of xs) if (x <= eps) z++;
    return z / xs.length;
}

/**
 * Автокорреляция на лаге `lag` (для детекции сезонности, lag=12).
 * Возвращает 0, если данных меньше lag+2.
 */
export function acf(xs: number[], lag: number): number {
    const n = xs.length;
    if (n < lag + 2) return 0;
    const m = mean(xs);
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) den += (xs[i] - m) * (xs[i] - m);
    if (den === 0) return 0;
    for (let i = lag; i < n; i++) num += (xs[i] - m) * (xs[i - lag] - m);
    return num / den;
}

/** Винзоризация значения в коридор [lo, hi]. */
export function winsorize(x: number, lo: number, hi: number): number {
    return clamp(x, lo, hi);
}
