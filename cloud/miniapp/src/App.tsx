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

function Shell() {
    const { s } = useApp();
    const boot = useBootstrap();

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
