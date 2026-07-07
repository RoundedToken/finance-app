import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { haptic } from "@/lib/telegram";

// MA-09 (SPEC-048): координация «открыта максимум одна строка» (iOS-паттерн) —
// модульный реестр закрывателей вместо прокидывания состояния через родителей
// (строки живут в разных списках и под виртуализацией; unmount снимает регистрацию).
const closers = new Set<() => void>();

/**
 * Строка со свайпом влево, открывающим кнопку «удалить» (iOS-стиль).
 * Тап без движения → onTap (по открытой строке — закрытие свайпа); свайп вправо закрывает.
 */
export function SwipeRow({ children, onTap, onDelete }: {
    children: ReactNode;
    onTap: () => void;
    onDelete: () => void;
}) {
    const [open, setOpen] = useState(false);
    const startX = useRef(0);
    const moved = useRef(false);

    const close = useCallback(() => setOpen(false), []);
    useEffect(() => {
        closers.add(close);
        return () => { closers.delete(close); };
    }, [close]);

    const openRow = () => {
        for (const c of closers) if (c !== close) c();   // MA-09: открылась новая — закрой старую
        if (!open) haptic("light");                       // MA-09: haptic на открытие, как у всех жестов
        setOpen(true);
    };

    const onDown = (e: React.PointerEvent) => { startX.current = e.clientX; moved.current = false; };
    const onMove = (e: React.PointerEvent) => { if (Math.abs(e.clientX - startX.current) > 8) moved.current = true; };
    // MA-09: отменённый браузером жест (pointercancel) не должен превращаться в тап
    const onCancel = () => { moved.current = true; };
    const onUp = (e: React.PointerEvent) => {
        const dx = e.clientX - startX.current;
        if (dx < -40) openRow();
        else if (dx > 40) close();
        else if (!moved.current) {
            // MA-09: тап по ОТКРЫТОЙ строке закрывает свайп (iOS-паттерн), а не ведёт в edit
            if (open) close();
            else onTap();
        }
    };

    return (
        <div className="relative overflow-hidden">
            <button onClick={onDelete} aria-label="Удалить"
                className="absolute inset-y-0 right-0 w-[72px] grid place-items-center bg-danger text-white">
                <Trash2 className="h-5 w-5" />
            </button>
            {/* MA-09: touch-отклик строки — brightness затемняет/освещает и инлайновый
                фон контента (active:bg-* его бы не перекрыл). */}
            <div
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onCancel}
                className="relative bg-bg transition-[transform,filter] duration-200 touch-pan-y active:brightness-[.92] dark:active:brightness-125"
                style={{ transform: `translateX(${open ? -72 : 0}px)` }}
            >
                {children}
            </div>
        </div>
    );
}
