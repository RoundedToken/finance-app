import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type ToastKind = "ok" | "err";
type Show = (msg: string, kind?: ToastKind) => void;

// Module-level bus: позволяет НЕ-React коду (queryClient MutationCache, создаётся до
// рендера) показать тост, не имея доступа к React-контексту. ToastProvider
// подписывается на него при монтировании.
let busListener: ((msg: string, kind: ToastKind) => void) | null = null;
export const toastBus = {
    emit(msg: string, kind: ToastKind = "ok") { busListener?.(msg, kind); },
};

const Ctx = createContext<Show>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toast, setToast] = useState<{ msg: string; kind: ToastKind } | null>(null);
    const timer = useRef<number | undefined>(undefined);

    const show = useCallback<Show>((msg, kind = "ok") => {
        setToast({ msg, kind });
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setToast(null), 3200);
    }, []);

    useEffect(() => {
        busListener = (msg, kind) => show(msg, kind);
        return () => { busListener = null; };
    }, [show]);

    return (
        <Ctx.Provider value={show}>
            {children}
            {toast && (
                <div
                    role={toast.kind === "err" ? "alert" : "status"}   /* ADM-21: ошибки анонсируются скринридером сразу */
                    className={cn(
                        "fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] max-w-[90vw] px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg animate-in fade-in slide-in-from-bottom-2",
                        toast.kind === "err" ? "bg-destructive text-destructive-foreground" : "bg-foreground text-background",
                    )}
                >
                    {toast.msg}
                </div>
            )}
        </Ctx.Provider>
    );
}

/** Явный тост из компонента (для success-подтверждений по месту). Ошибки мутаций
 *  тостятся глобально через MutationCache.onError (см. main.tsx). */
export function useToast(): Show {
    return useContext(Ctx);
}
