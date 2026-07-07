import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { useBootstrap } from "@/api/queries";
import { AppProvider, useApp } from "@/store";
import { ToastProvider } from "@/components/Toast";
import { MainScreen } from "@/screens/MainScreen";
import { HistoryScreen } from "@/screens/HistoryScreen";
import { StatsScreen } from "@/screens/StatsScreen";
import { EditScreen } from "@/screens/EditScreen";
import { NoteScreen } from "@/screens/NoteScreen";
import { Modals } from "@/components/Modals";
import { tg, haptic } from "@/lib/telegram";

function Shell() {
    const { s, d } = useApp();
    const boot = useBootstrap();

    // MA-03 (SPEC-048): драфт живёт только в памяти — «грязный» ввод (сумма/описание/
    // правка траты) защищаем штатным closing confirmation Telegram, чтобы случайное
    // закрытие (крестик, смена чата) не теряло набранное молча. Экран описания считаем
    // грязным всегда: его текст локален и в store попадает только по «Готово».
    const dirty = s.amount !== "0" || s.note !== "" || s.editingId !== null || s.screen === "note";
    useEffect(() => {
        const w = tg();
        if (!w) return;
        try {
            if (dirty) w.enableClosingConfirmation?.();
            else w.disableClosingConfirmation?.();
        } catch { /* старый клиент */ }
    }, [dirty]);

    // MA-10 (SPEC-048): нативная кнопка «Назад» в шапке Telegram на не-главных экранах
    // (на Android hardware-back иначе закрывает Mini App целиком). Семантика повторяет
    // in-app стрелки: note → edit/main (отмена), edit → исходный экран (MA-04), остальное → main.
    useEffect(() => {
        const bb = tg()?.BackButton;
        if (!bb) return;
        const onBack = () => {
            haptic("light");
            if (s.screen === "note") { d({ t: "screen", v: s.editingId ? "edit" : "main" }); return; }
            if (s.screen === "edit") { d({ t: "resetDraft" }); d({ t: "screen", v: s.returnScreen }); return; }
            d({ t: "screen", v: "main" });
        };
        try {
            if (s.screen === "main") { bb.hide(); return; }
            bb.onClick(onBack);
            bb.show();
        } catch { /* старый клиент */ return; }
        return () => { try { bb.offClick(onBack); } catch { /* noop */ } };
    }, [s.screen, s.editingId, s.returnScreen, d]);

    if (boot.isLoading) {
        return <div className="min-h-screen grid place-items-center text-hint animate-pulse">Загрузка…</div>;
    }
    if (boot.isError) {
        return (
            <div className="min-h-screen grid place-items-center p-6">
                <div className="text-center space-y-3">
                    <p className="text-hint">Не удалось загрузить данные</p>
                    <p className="text-hint text-xs">Если приложение открыто давно — закрой и открой его заново</p>
                    <button onClick={() => boot.refetch()} className="inline-flex items-center gap-2 text-accent font-medium">
                        <RefreshCw className="h-4 w-4" /> Повторить
                    </button>
                </div>
            </div>
        );
    }
    return (
        <>
            {s.screen === "main" && <MainScreen />}
            {s.screen === "history" && <HistoryScreen />}
            {s.screen === "stats" && <StatsScreen />}
            {s.screen === "edit" && <EditScreen />}
            {s.screen === "note" && <NoteScreen />}
            <Modals />
        </>
    );
}

export function App() {
    return (
        <ToastProvider>
            <AppProvider>
                <Shell />
            </AppProvider>
        </ToastProvider>
    );
}
