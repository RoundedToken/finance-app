import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider, MutationCache } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { consumeFragmentToken } from "@/lib/auth";
import { ApiError } from "@/api/client";
import { ToastProvider, toastBus } from "@/components/Toast";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { routeTree } from "./routeTree";
import "./styles.css";

consumeFragmentToken();

const queryClient = new QueryClient({
    // Любая упавшая мутация (overdraft-400, 5xx, обрыв сети) показывает тост с
    // server-message — раньше ошибки молча терялись в `await mutateAsync`.
    // 401 пропускаем: api/client уже редиректит на /login.
    mutationCache: new MutationCache({
        onError: (err) => {
            if (err instanceof ApiError && err.status === 401) return;
            toastBus.emit(err instanceof Error ? err.message : "Ошибка", "err");
        },
    }),
    defaultOptions: {
        queries: {
            refetchOnWindowFocus: false,
            retry: 1,
        },
    },
});

const router = createRouter({
    routeTree,
    defaultPreload: "intent",
    context: { queryClient },
});

declare module "@tanstack/react-router" {
    interface Register {
        router: typeof router;
    }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <ErrorBoundary>
            <QueryClientProvider client={queryClient}>
                <ToastProvider>
                    <RouterProvider router={router} />
                </ToastProvider>
            </QueryClientProvider>
        </ErrorBoundary>
    </React.StrictMode>,
);
