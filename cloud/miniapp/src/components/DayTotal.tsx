import { useBootstrap } from "@/api/queries";
import { Amount } from "./Amount";
import { toBase } from "@/lib/money";
import type { Expense } from "@/api/types";

/**
 * Итог за день: оригинальные суммы по валютам + приблизительный эквивалент в
 * базовой валюте. Если день целиком в базовой валюте — показываем только её
 * (без «≈»). Пример: «3 200 🇷🇸 RSD ≈ 27 🇪🇺 EUR».
 */
export function DayTotal({ rows, base }: { rows: Expense[]; base: string }) {
    const { data } = useBootstrap();
    const rates = data?.rates;

    const byCcy = new Map<string, number>();
    for (const e of rows) byCcy.set(e.currency, (byCcy.get(e.currency) ?? 0) + e.amount);
    const entries = [...byCcy.entries()];
    const baseTotal = rates ? entries.reduce((sum, [ccy, n]) => sum + toBase(n, ccy, base, rates), 0) : 0;
    const onlyBase = entries.length === 1 && entries[0][0] === base;

    return (
        <span className="inline-flex items-center gap-x-1.5 gap-y-0.5 flex-wrap justify-end">
            {entries.map(([ccy, n]) => <Amount key={ccy} amount={n} currency={ccy} />)}
            {!onlyBase && (
                <>
                    <span className="text-hint">≈</span>
                    <Amount amount={baseTotal} currency={base} />
                </>
            )}
        </span>
    );
}
