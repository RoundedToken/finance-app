import { useEffect, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Bottom-sheet модал (slide-up снизу, backdrop). iOS-friendly. */
export function Modal({ open, onClose, title, children, className }: {
    open: boolean;
    onClose: () => void;
    title?: string;
    children: ReactNode;
    className?: string;
}) {
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, onClose]);

    if (!open) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true">
            <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={onClose} />
            <div className={cn(
                "relative w-full max-w-md bg-bg rounded-t-2xl px-4 pt-4 pb-[max(2rem,env(safe-area-inset-bottom))]",
                "animate-slide-up max-h-[85vh] overflow-y-auto shadow-2xl",
                className,
            )}>
                <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-hint/30" />
                {title && <h2 className="text-lg font-semibold mb-3">{title}</h2>}
                {children}
            </div>
        </div>
    );
}
