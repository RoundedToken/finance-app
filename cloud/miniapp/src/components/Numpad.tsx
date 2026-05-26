import { haptic } from "@/lib/telegram";
import { cn } from "@/lib/utils";

/**
 * Переиспользуемый numpad — единственный способ ввода сумм (на главной и в edit),
 * вместо системной клавиатуры. Нет нативной клавиатуры → нечему прыгать.
 * `onKey` получает: "0".."9" | "." | "⌫"; применять через applyNumpadKey.
 */
export function Numpad({ onKey, className }: { onKey: (key: string) => void; className?: string }) {
    const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"];
    return (
        <div className={cn("grid grid-cols-3 gap-px", className)}>
            {keys.map(k => (
                <button
                    key={k}
                    type="button"
                    onClick={() => { haptic("light"); onKey(k); }}
                    className="h-16 grid place-items-center text-2xl font-medium no-select active:bg-secondary-bg active:animate-pop rounded-xl transition-colors"
                >
                    {k}
                </button>
            ))}
        </div>
    );
}
