import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ModalProps {
    open: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
    size?: "sm" | "md" | "lg";
}

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
 */
export function Modal({ open, onClose, title, children, size = "md" }: ModalProps) {
    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", handler);
        document.body.style.overflow = "hidden";
        return () => {
            window.removeEventListener("keydown", handler);
            document.body.style.overflow = "";
        };
    }, [open, onClose]);

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
                        className={cn(
                            "relative card p-0 w-full shadow-2xl animate-slide-up my-auto",
                            size === "sm" && "max-w-sm",
                            size === "md" && "max-w-md",
                            size === "lg" && "max-w-2xl",
                        )}
                        role="dialog"
                        aria-modal="true"
                    >
                        <div className="flex items-center justify-between p-5 border-b sticky top-0 bg-card z-10 rounded-t-2xl">
                            <h2 className="text-lg font-semibold">{title}</h2>
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
