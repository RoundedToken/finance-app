import { Amount } from "./Amount";
import type { Expense } from "@/api/types";

/**
 * Итог за день: оригинальные суммы по валютам + приблизительный EUR-эквивалент.
 * Если день целиком в EUR — показываем только его (без «≈»).
 * Пример: «3 200 🇷🇸 RSD ≈ 27 🇪🇺 EUR».
 *
 * SPEC-016: эквивалент = Σ amount_eur (date-aware, по курсу даты траты — расход
 * это поток, ADR-014). Клиент не конвертирует сам — amount_eur приходит с worker.
 * MA-13 (SPEC-048): база захардкожена EUR — параметр `base` мог подписать EUR-сумму
 * чужим кодом валюты из легаси-localStorage (SPEC-036 NG1: baseCurrency мёртв).
 */
export function DayTotal({ rows }: { rows: Expense[] }) {
    const byCcy = new Map<string, number>();
    for (const e of rows) byCcy.set(e.currency, (byCcy.get(e.currency) ?? 0) + e.amount);
    const entries = [...byCcy.entries()];
    const eurTotal = rows.reduce((sum, e) => sum + (e.amount_eur ?? 0), 0);
    const onlyEur = entries.length === 1 && entries[0][0] === "EUR";

    return (
        <span className="inline-flex items-center gap-x-1.5 gap-y-0.5 flex-wrap justify-end">
            {entries.map(([ccy, n]) => <Amount key={ccy} amount={n} currency={ccy} />)}
            {!onlyEur && (
                <>
                    <span className="text-hint">≈</span>
                    <Amount amount={eurTotal} currency="EUR" />
                </>
            )}
        </span>
    );
}
