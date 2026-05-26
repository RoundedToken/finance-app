import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { tg } from "@/lib/telegram";

/** Focus-guard (SPEC-002 AC25/E7): тап на ДРУГОЕ поле при сфокусированном → blur,
 *  чтобы iOS не перепрыгивал клавиатурой между input'ами. */
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
 * Bottom-sheet модал. Senior-паттерны:
 *  - scroll-lock body, пока открыта (нельзя проскроллить фон под модалкой);
 *  - swipe-down-to-close за drag-handle;
 *  - keyboard-aware: поднимается над клавиатурой через visualViewport (не прыгает);
 *  - tap по backdrop при активном input → сначала blur (закрыть клавиатуру), и только
 *    повторный tap закрывает модалку;
 *  - закреплённые размеры, overflow-x hidden — не ползает.
 */
export function Modal({ open, onClose, title, children, className }: {
    open: boolean;
    onClose: () => void;
    title?: string;
    children: ReactNode;
    className?: string;
}) {
    const [dragY, setDragY] = useState(0);
    const [kb, setKb] = useState(0);            // высота клавиатуры (px)
    const startY = useRef<number | null>(null);
    const dragging = useRef(false);

    // scroll-lock фона + Escape + отключение Telegram-свайпа
    useEffect(() => {
        if (!open) return;
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        try { tg()?.disableVerticalSwipes?.(); } catch { /* noop */ }
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", onKey);
        return () => { document.body.style.overflow = prevOverflow; window.removeEventListener("keydown", onKey); };
    }, [open, onClose]);

    // keyboard-aware: поднимаем модалку на высоту клавиатуры
    useEffect(() => {
        if (!open) { setKb(0); setDragY(0); return; }
        const vv = window.visualViewport;
        if (!vv) return;
        const onResize = () => setKb(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
        onResize();
        vv.addEventListener("resize", onResize);
        vv.addEventListener("scroll", onResize);
        return () => { vv.removeEventListener("resize", onResize); vv.removeEventListener("scroll", onResize); };
    }, [open]);

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
            <div className="absolute inset-0 bg-black/50 animate-fade-in" onClick={onBackdrop} />
            <div
                onPointerDownCapture={focusGuard}
                style={{
                    bottom: kb,
                    transform: dragY ? `translateY(${dragY}px)` : undefined,
                    transition: dragging.current ? "bottom 150ms ease" : "transform 200ms cubic-bezier(.16,1,.3,1), bottom 150ms ease",
                }}
                className={cn(
                    "absolute left-0 right-0 mx-auto w-full max-w-md bg-card text-text rounded-t-2xl",
                    "px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] max-h-[88vh] overflow-y-auto overflow-x-hidden shadow-2xl",
                    !dragY && "animate-slide-up",
                    className,
                )}
            >
                <div
                    onPointerDown={onHandleDown}
                    onPointerMove={onHandleMove}
                    onPointerUp={onHandleUp}
                    className="sticky top-0 z-10 -mx-4 px-4 pt-2.5 pb-3 bg-card touch-none cursor-grab active:cursor-grabbing flex justify-center"
                >
                    <div className="h-1.5 w-10 rounded-full bg-hint/40" />
                </div>
                {title && <h2 className="text-lg font-semibold mb-3">{title}</h2>}
                {children}
            </div>
        </div>
    );
}
