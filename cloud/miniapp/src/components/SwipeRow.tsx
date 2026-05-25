import { useRef, useState, type ReactNode } from "react";
import { Trash2 } from "lucide-react";

/**
 * Строка со свайпом влево, открывающим кнопку «удалить» (iOS-стиль).
 * Тап без движения → onTap; свайп вправо закрывает.
 */
export function SwipeRow({ children, onTap, onDelete }: {
    children: ReactNode;
    onTap: () => void;
    onDelete: () => void;
}) {
    const [open, setOpen] = useState(false);
    const startX = useRef(0);
    const moved = useRef(false);

    const onDown = (e: React.PointerEvent) => { startX.current = e.clientX; moved.current = false; };
    const onMove = (e: React.PointerEvent) => { if (Math.abs(e.clientX - startX.current) > 8) moved.current = true; };
    const onUp = (e: React.PointerEvent) => {
        const dx = e.clientX - startX.current;
        if (dx < -40) setOpen(true);
        else if (dx > 40) setOpen(false);
        else if (!moved.current) onTap();
    };

    return (
        <div className="relative overflow-hidden rounded-lg">
            <button onClick={onDelete} aria-label="Удалить"
                className="absolute inset-y-0 right-0 w-[72px] grid place-items-center bg-danger text-white">
                <Trash2 className="h-5 w-5" />
            </button>
            <div
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                className="relative bg-bg transition-transform duration-200 touch-pan-y"
                style={{ transform: `translateX(${open ? -72 : 0}px)` }}
            >
                {children}
            </div>
        </div>
    );
}
