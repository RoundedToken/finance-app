import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ModalProps {
    open: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
    size?: "sm" | "md" | "lg";
}

/** Селектор фокусируемых элементов внутри карточки модала (ADM-11). */
const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Универсальный модал с корректной прокруткой и backdrop'ом.
 *
 * Архитектура (важно — почему два fixed inset-0 ребёнка):
 *
 *   <div fixed inset-0 z-50>                      ← stacking root
 *     <div fixed inset-0 backdrop pointer-events-none />   ← visual only
 *     <div fixed inset-0 overflow-y-auto onClick=outside>  ← catches clicks +
 *       <div min-h-full flex justify-center p-4>   ← scrollable region
 *         <div card>...</div>                      ← карточка модала
 *       </div>
 *     </div>
 *   </div>
 *
 * Главные инварианты:
 *  - **backdrop остаётся на viewport** независимо от скролла модала —
 *    он `position: fixed`, не `absolute` (раньше absolute прокручивался
 *    вместе с контентом, обнажая голый экран снизу).
 *  - backdrop НЕ ловит клики (`pointer-events-none`) — это просто слой
 *    с цветом и blur'ом. Клики ловит scroll-container выше.
 *  - **scroll-container ловит outside-click**: если e.target ===
 *    e.currentTarget (клик попал в padding, не в карточку) — закрываем.
 *  - **header sticky** — close-button и заголовок всегда видны при
 *    прокрутке длинной формы.
 *  - на коротком экране карточка прижата к верху (`items-start`), на
 *    нормальном centered.
 *  - **focus trap (ADM-11)**: фокус входит в модал при открытии, Tab
 *    циклится внутри карточки, при закрытии фокус возвращается на
 *    элемент-триггер. Заголовок связан через aria-labelledby.
 */
export function Modal({ open, onClose, title, children, size = "md" }: ModalProps) {
    const titleId = useId();
    const cardRef = useRef<HTMLDivElement>(null);
    // onClose в ref: эффект focus-trap зависит только от `open` — иначе каждый
    // re-render родителя (новая identity inline-стрелки) пересоздавал бы эффект
    // и cleanup возвращал бы фокус на триггер прямо посреди ввода.
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        if (!open) return;
        const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

        const focusables = (): HTMLElement[] => {
            const card = cardRef.current;
            if (!card) return [];
            return [...card.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => el.offsetParent !== null);
        };

        // autoFocus дочерних инпутов срабатывает при монтировании раньше этого эффекта —
        // не перебиваем его: фокусируем первый контрол только если фокус ещё вне модала.
        const raf = requestAnimationFrame(() => {
            if (cardRef.current && !cardRef.current.contains(document.activeElement)) {
                focusables()[0]?.focus();
            }
        });

        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") { onCloseRef.current(); return; }
            if (e.key !== "Tab") return;
            const items = focusables();
            if (items.length === 0) return;
            const first = items[0];
            const last = items[items.length - 1];
            const active = document.activeElement;
            const inside = cardRef.current?.contains(active) ?? false;
            if (e.shiftKey ? (active === first || !inside) : (active === last || !inside)) {
                e.preventDefault();
                (e.shiftKey ? last : first).focus();
            }
        };
        window.addEventListener("keydown", handler);
        document.body.style.overflow = "hidden";
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener("keydown", handler);
            document.body.style.overflow = "";
            opener?.focus();   // возврат фокуса на триггер (ADM-11)
        };
    }, [open]);

    if (!open) return null;

    const handleScrollAreaClick: React.MouseEventHandler<HTMLDivElement> = (e) => {
        if (e.target === e.currentTarget) onClose();
    };

    return (
        <div className="fixed inset-0 z-50 animate-fade-in">
            <div
                className="fixed inset-0 bg-black/60 backdrop-blur-sm pointer-events-none"
                aria-hidden
            />
            <div
                className="fixed inset-0 overflow-y-auto overscroll-contain"
                onClick={handleScrollAreaClick}
            >
                <div
                    className="min-h-full flex items-start sm:items-center justify-center p-4"
                    onClick={handleScrollAreaClick}
                >
                    <div
                        ref={cardRef}
                        className={cn(
                            "relative card p-0 w-full shadow-2xl animate-slide-up my-auto",
                            size === "sm" && "max-w-sm",
                            size === "md" && "max-w-md",
                            size === "lg" && "max-w-2xl",
                        )}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby={titleId}
                    >
                        <div className="flex items-center justify-between p-5 border-b sticky top-0 bg-card z-10 rounded-t-2xl">
                            <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
                            <button onClick={onClose} className="btn-icon" aria-label="Закрыть">
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="p-5">{children}</div>
                    </div>
                </div>
            </div>
        </div>
    );
}
