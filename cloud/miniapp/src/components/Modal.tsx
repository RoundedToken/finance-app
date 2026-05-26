import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Focus-guard (SPEC-002 AC25/E7): тап на ДРУГОЕ поле при сфокусированном → blur. */
function focusGuard(e: React.PointerEvent) {
    const active = document.activeElement as HTMLElement | null;
    const target = e.target as HTMLElement;
    const isField = (el: HTMLElement | null) => !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
    if (isField(active) && active !== target) {
        if (isField(target)) { e.preventDefault(); e.stopPropagation(); }
        active!.blur();
    }
}

/**
 * Bottom-sheet модал.
 *
 * scroll-lock: `overflow:hidden` на body на iOS НЕ блокирует touch-scroll —
 * фиксируем body через `position:fixed` (сохраняем/возвращаем scrollY). Это и
 * залочивает фон (был баг «два скролла»), и не даёт iOS дёргать layout при
 * клавиатуре. Доп. защита: backdrop глотает touchmove, sheet — overscroll contain.
 *
 * Клавиатуру держит браузер (`interactive-widget=overlays-content`), без ручной
 * visualViewport-компенсации (она телепортировала модалку).
 */
export function Modal({ open, onClose, title, children, className }: {
    open: boolean;
    onClose: () => void;
    title?: string;
    children: ReactNode;
    className?: string;
}) {
    const [dragY, setDragY] = useState(0);
    const startY = useRef<number | null>(null);
    const dragging = useRef(false);

    useEffect(() => {
        if (!open) { setDragY(0); return; }
        const scrollY = window.scrollY;
        const body = document.body;
        const saved = {
            position: body.style.position, top: body.style.top,
            width: body.style.width, overflow: body.style.overflow,
        };
        body.style.position = "fixed";
        body.style.top = `-${scrollY}px`;
        body.style.width = "100%";
        body.style.overflow = "hidden";
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", onKey);
        return () => {
            body.style.position = saved.position;
            body.style.top = saved.top;
            body.style.width = saved.width;
            body.style.overflow = saved.overflow;
            window.scrollTo(0, scrollY);
            window.removeEventListener("keydown", onKey);
        };
    }, [open, onClose]);

    if (!open) return null;

    const onBackdrop = () => {
        const active = document.activeElement as HTMLElement | null;
        if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) { active.blur(); return; }
        onClose();
    };

    const onHandleDown = (e: React.PointerEvent) => {
        startY.current = e.clientY; dragging.current = true;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };
    const onHandleMove = (e: React.PointerEvent) => {
        if (!dragging.current || startY.current == null) return;
        const dy = e.clientY - startY.current;
        if (dy > 0) setDragY(dy);
    };
    const onHandleUp = () => {
        if (!dragging.current) return;
        dragging.current = false; startY.current = null;
        if (dragY > 90) onClose(); else setDragY(0);
    };

    return (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
            <div
                className="absolute inset-0 bg-black/50 animate-fade-in"
                style={{ touchAction: "none" }}
                onClick={onBackdrop}
                onTouchMove={(e) => e.preventDefault()}
            />
            <div
                onPointerDownCapture={focusGuard}
                style={{
                    overscrollBehavior: "contain",
                    transform: dragY ? `translateY(${dragY}px)` : undefined,
                    transition: dragging.current ? "none" : "transform 200ms cubic-bezier(.16,1,.3,1)",
                }}
                className={cn(
                    "absolute inset-x-0 bottom-0 mx-auto w-full max-w-md bg-card text-text rounded-t-2xl px-4",
                    "pb-[max(1.5rem,env(safe-area-inset-bottom))] max-h-[88vh] overflow-y-auto overflow-x-hidden shadow-2xl",
                    !dragY && "animate-slide-up",
                    className,
                )}
            >
                <div
                    onPointerDown={onHandleDown}
                    onPointerMove={onHandleMove}
                    onPointerUp={onHandleUp}
                    className="sticky top-0 z-10 -mx-4 px-4 pt-2.5 pb-3 bg-card touch-none flex justify-center cursor-grab active:cursor-grabbing"
                >
                    <div className="h-1.5 w-10 rounded-full bg-hint/40" />
                </div>
                {title && <h2 className="text-lg font-semibold mb-3">{title}</h2>}
                {children}
            </div>
        </div>
    );
}
