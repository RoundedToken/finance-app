import { useReferences } from "@/api/queries";
import { cn } from "@/lib/utils";

interface CurrencyProps {
    code: string | undefined | null;
    /** Скрыть текстовый код, оставить только флаг/значок. */
    flagOnly?: boolean;
    /** Размер кода: sm (default) | xs | base. Эмодзи size наследуется от родителя. */
    size?: "xs" | "sm" | "base";
    /** Дополнительные tailwind-классы (на wrapper span). */
    className?: string;
}

/**
 * Единая точка отображения валюты по всему приложению.
 *
 * По правилам Mini App: сначала флаг (или значок для крипты), затем
 * приглушённый код. Жирно не выделяем — валюта не должна перебивать
 * сумму, к которой относится.
 */
export function Currency({ code, flagOnly = false, size = "sm", className }: CurrencyProps) {
    const { data: refs } = useReferences();
    if (!code) return null;
    const ccy = refs?.currencies?.find(c => c.code === code);
    const glyph = ccy?.emoji;
    const codeSize = size === "xs" ? "text-xs" : size === "base" ? "text-base" : "text-sm";

    return (
        <span className={cn("inline-flex items-center gap-1 align-middle", className)}>
            {glyph && <span aria-hidden className="leading-none">{glyph}</span>}
            {!flagOnly && <span className={cn(codeSize, "text-muted-foreground")}>{code}</span>}
        </span>
    );
}
