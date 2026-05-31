import { cn } from "@/lib/utils";
import type { BudgetStatus } from "@/api/types";

/** Цвет по статусу бюджета (единый для бара и подписей). SPEC-020 §7. */
export const BUDGET_STATUS_COLOR: Record<BudgetStatus, string> = {
    good: "#10b981", // зелёный — < 80%
    warn: "#f59e0b", // амбер — 80%..лимит
    over: "#ef4444", // красный — > лимита
};

/** Tailwind text-класс статуса (для подписи «осталось / сверх»). */
export const BUDGET_STATUS_TEXT: Record<BudgetStatus, string> = {
    good: "text-positive",
    warn: "text-amber-500",
    over: "text-destructive",
};

/**
 * Прогресс-бар бюджета с порогами good/warn/over (SPEC-020). Первый
 * multi-threshold бар в коде; геометрия как у Goals/CategoryBar.
 */
export function BudgetBar({ pct, status, height = "h-2" }: { pct: number; status: BudgetStatus; height?: string }) {
    const width = Math.min(100, Math.max(2, pct));
    return (
        <div className={cn(height, "rounded-full bg-secondary/60 overflow-hidden")}>
            <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{ width: `${width}%`, background: BUDGET_STATUS_COLOR[status] }}
            />
        </div>
    );
}
