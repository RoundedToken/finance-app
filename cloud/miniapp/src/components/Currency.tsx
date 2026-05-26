import { useBootstrap } from "@/api/queries";
import { cn } from "@/lib/utils";

/** Флаг (emoji) + приглушённый код валюты. Единая точка отображения валюты. */
export function Currency({ code, size = "sm", flagOnly = false, className }: {
    code?: string | null;
    size?: "xs" | "sm" | "base";
    flagOnly?: boolean;
    className?: string;
}) {
    const { data } = useBootstrap();
    if (!code) return null;
    const ccy = data?.currencies?.find(c => c.code === code);
    const sz = size === "xs" ? "text-xs" : size === "base" ? "text-base" : "text-sm";
    return (
        <span className={cn("inline-flex items-center gap-1 align-middle", className)}>
            {ccy?.emoji && <span aria-hidden className="leading-none">{ccy.emoji}</span>}
            {!flagOnly && <span className={cn(sz, "text-hint")}>{code}</span>}
        </span>
    );
}

/** Только emoji-флаг валюты (для крупного дисплея). */
export function CurrencyFlag({ code }: { code?: string | null }) {
    const { data } = useBootstrap();
    const ccy = data?.currencies?.find(c => c.code === code);
    return <span aria-hidden>{ccy?.emoji ?? "💱"}</span>;
}
