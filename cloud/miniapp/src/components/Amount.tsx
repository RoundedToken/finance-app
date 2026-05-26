import { useBootstrap } from "@/api/queries";
import { cn, fmt } from "@/lib/utils";

/**
 * Сумма + флаг валюты + код — как в SPEC-002 (amountHTML: «500 🇷🇸 RSD»).
 * Флаг обязателен по требованию: валюта всегда с флажком.
 */
export function Amount({ amount, currency, className, size = "sm" }: {
    amount: number;
    currency: string;
    className?: string;
    size?: "sm" | "base";
}) {
    const { data } = useBootstrap();
    const flag = data?.currencies?.find(c => c.code === currency)?.emoji ?? "💱";
    return (
        <span className={cn("inline-flex items-center gap-1 num tabular-nums", className)}>
            <span>{fmt(amount, currency)}</span>
            <span aria-hidden className="leading-none">{flag}</span>
            <span className={cn("text-hint", size === "base" ? "text-sm" : "text-xs")}>{currency}</span>
        </span>
    );
}
