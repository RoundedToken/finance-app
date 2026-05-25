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
 * Универсальный модал с поддержкой коротких viewport'ов:
 *  - outer container скроллится (overflow-y-auto) если контент модала
 *    превышает высоту экрана,
 *  - на коротком экране модал прижат к верху (items-start) с p-4
 *    отступом, чтобы не «обрезался» сверху,
 *  - sticky-header с close-button — close всегда виден даже при скролле,
 *  - body модала естественно «течёт» внутри карточки.
 *
 * Esc + клик по бэкдропу закрывают.
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

    return (
        <div className="fixed inset-0 z-50 overflow-y-auto animate-fade-in">
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
                aria-hidden
            />
            <div className="relative min-h-full flex items-start sm:items-center justify-center p-4">
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
    );
}
