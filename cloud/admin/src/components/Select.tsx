import { forwardRef } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type NativeSelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

interface SelectProps extends NativeSelectProps {
    /** Растянуть на всю ширину родителя. */
    fullWidth?: boolean;
    /** Класс на внешний wrapper (полезно для min-w / margin). */
    wrapperClassName?: string;
}

/**
 * Единый <select> wrapper с custom ChevronDown справа.
 *
 * Native browser arrow заезжал за border и выглядел обрезанным —
 * `appearance-none` + lucide ChevronDown с абсолютным позиционированием
 * фиксят это раз и навсегда.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
    { className, wrapperClassName, fullWidth, children, ...props },
    ref,
) {
    return (
        <div className={cn("relative inline-block", fullWidth && "w-full", wrapperClassName)}>
            <select
                ref={ref}
                {...props}
                className={cn(
                    "appearance-none w-full pl-3 pr-9 py-2 rounded-lg border bg-background text-sm",
                    "focus:outline-none focus:ring-2 focus:ring-ring",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                    "min-w-[10rem]",
                    className,
                )}
            >
                {children}
            </select>
            <ChevronDown
                aria-hidden
                className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
            />
        </div>
    );
});
