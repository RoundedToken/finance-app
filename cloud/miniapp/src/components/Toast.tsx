import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type ToastKind = "ok" | "err";
type ShowToast = (msg: string, kind?: ToastKind) => void;

const Ctx = createContext<ShowToast>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toast, setToast] = useState<{ msg: string; kind: ToastKind } | null>(null);
    const timer = useRef<number | undefined>(undefined);

    const show = useCallback<ShowToast>((msg, kind = "ok") => {
        setToast({ msg, kind });
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setToast(null), 2200);
    }, []);

    return (
        <Ctx.Provider value={show}>
            {children}
            {toast && (
                <div
                    role="status"
                    className={cn(
                        "fixed bottom-8 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-xl text-sm font-medium text-white shadow-lg animate-fade-in",
                        toast.kind === "err" ? "bg-danger" : "bg-black/85",
                    )}
                >
                    {toast.msg}
                </div>
            )}
        </Ctx.Provider>
    );
}

export function useToast(): ShowToast {
    return useContext(Ctx);
}
