import { Component, type ErrorInfo, type ReactNode } from "react";

/** Ловит render-time исключения SPA (неожиданная форма данных, undefined в ECharts
 *  и т.п.) → fallback с перезагрузкой вместо «белого экрана». Data-fetch ошибки
 *  ловит TanStack (isError), мутации — MutationCache.onError → toast. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
    state: { error: Error | null } = { error: null };

    static getDerivedStateFromError(error: Error) {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error("ErrorBoundary caught:", error, info.componentStack);
    }

    render() {
        if (this.state.error) {
            return (
                <div className="min-h-screen grid place-items-center p-6 text-center">
                    <div className="space-y-3 max-w-md">
                        <p className="text-lg font-semibold">Что-то сломалось</p>
                        <p className="text-sm text-muted-foreground break-words">{this.state.error.message}</p>
                        <button className="btn-ghost" onClick={() => window.location.reload()}>Перезагрузить</button>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}
