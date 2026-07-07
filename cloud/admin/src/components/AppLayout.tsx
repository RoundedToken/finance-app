import { useEffect, useState } from "react";
import { Link, Outlet, useRouter, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, ListChecks, LogOut, Wallet, ArrowRightLeft, TrendingUp, PieChart, Sparkles, Target, FolderTree, Gauge, Coins, ShieldAlert } from "lucide-react";
import { useMe } from "@/api/queries";
import { apiFetch } from "@/api/client";
import { clearToken, decodeClaims, getToken, setToken } from "@/lib/auth";
import { cn } from "@/lib/utils";

type NavItem = {
    to: string;
    icon: typeof LayoutDashboard;
    label: string;
    disabled?: boolean;
};

const NAV: NavItem[] = [
    { to: "/", icon: LayoutDashboard, label: "Дашборд" },
    { to: "/accounts", icon: Wallet, label: "Счета" },
    { to: "/snapshots", icon: PieChart, label: "Снапшоты" },
    { to: "/expenses", icon: ListChecks, label: "Расходы" },
    { to: "/budgets", icon: Gauge, label: "Бюджеты" },
    { to: "/incomes", icon: TrendingUp, label: "Доходы" },
    { to: "/goals", icon: Target, label: "Цели" },
    { to: "/investments", icon: Coins, label: "Инвестиции" },
    { to: "/transactions", icon: ArrowRightLeft, label: "Обмены" },
    { to: "/categories", icon: FolderTree, label: "Категории" },
];

export function AppLayout() {
    const router = useRouter();
    const { data: me } = useMe();
    // useRouter().state — снапшот, не реактивный. Подписываемся через
    // useRouterState, иначе active pill «застревает» на стартовом маршруте.
    const path = useRouterState({ select: s => s.location.pathname });
    // Активность пункта: точное совпадение либо подмаршрут (для /goals/:id).
    const isActive = (to: string) => path === to || (to !== "/" && path.startsWith(to + "/"));

    const logout = () => {
        clearToken();
        router.navigate({ to: "/login" });
    };

    // ── Сессия истекла (ADM-03/08, SPEC-044) ────────────────────────────────
    const [sessionExpired, setSessionExpired] = useState(false);

    // ADM-03: apiFetch при 401 диспатчит событие вместо жёсткого reload'а —
    // показываем модал поверх текущего состояния, ввод в формах не теряется молча.
    useEffect(() => {
        const onExpired = () => setSessionExpired(true);
        window.addEventListener("admin:session-expired", onExpired);
        return () => window.removeEventListener("admin:session-expired", onExpired);
    }, []);

    // ADM-08: долгоживущая вкладка — JWT протухает без единой навигации (beforeLoad
    // не срабатывает). Таймер на exp − 60с показывает модал мягко, ДО фактического 401.
    useEffect(() => {
        let timer: number | undefined;
        const arm = () => {
            const token = getToken();
            const claims = token ? decodeClaims(token) : null;
            if (!claims) return;
            const msLeft = claims.exp * 1000 - Date.now() - 60_000;
            if (msLeft <= 0) { setSessionExpired(true); return; }
            // setTimeout ограничен int32 (~24.8 сут), JWT живёт дольше — клампим и перевзводим.
            timer = window.setTimeout(arm, Math.min(msLeft, 2_000_000_000));
        };
        arm();
        return () => window.clearTimeout(timer);
    }, []);

    // SEC-08 (волна 2): автопродление активной сессии. TTL сокращён до 72ч —
    // при остатке < половины TTL молча берём свежий токен; активный пользователь
    // не разлогинивается, украденный токен живёт максимум 72ч.
    useEffect(() => {
        const refreshIfStale = async () => {
            const token = getToken();
            const claims = token ? decodeClaims(token) : null;
            if (!claims) return;
            const ttlMs = (claims.exp - claims.iat) * 1000;
            const leftMs = claims.exp * 1000 - Date.now();
            if (leftMs > 0 && leftMs < ttlMs / 2) {
                try {
                    const r = await apiFetch<{ ok: boolean; token: string }>("/v1/web/session/refresh", { method: "POST" });
                    if (r.token) setToken(r.token);
                } catch { /* 401 обработает общий session-expired поток */ }
            }
        };
        refreshIfStale();
        const iv = window.setInterval(refreshIfStale, 60 * 60 * 1000);   // раз в час
        return () => window.clearInterval(iv);
    }, []);

    const relogin = () => {
        // return_to: после логина вернуть на страницу, с которой выкинуло (ADM-03).
        try {
            sessionStorage.setItem("admin.return_to", window.location.pathname + window.location.search);
        } catch { /* ignore */ }
        clearToken();
        setSessionExpired(false);
        router.navigate({ to: "/login" });
    };

    return (
        <div className="grid h-full grid-cols-[16rem_1fr]">
            <aside className="border-r bg-card flex flex-col">
                <div className="p-5 border-b">
                    <div className="flex items-center gap-2">
                        <div className="h-9 w-9 rounded-lg bg-primary text-primary-foreground grid place-items-center font-bold text-lg">€</div>
                        <div>
                            <div className="font-semibold leading-tight">Finances</div>
                            <div className="text-xs text-muted-foreground">Admin</div>
                        </div>
                    </div>
                </div>
                <nav className="flex-1 p-3 space-y-1">
                    {NAV.map(item => {
                        const Icon = item.icon;
                        const active = isActive(item.to);
                        if (item.disabled) {
                            return (
                                <div key={item.to} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground/60 cursor-not-allowed">
                                    <Icon className="h-4 w-4" />
                                    <span>{item.label}</span>
                                    <Sparkles className="ml-auto h-3 w-3 opacity-60" />
                                </div>
                            );
                        }
                        return (
                            <Link
                                key={item.to}
                                to={item.to}
                                className={cn(
                                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                                    active ? "bg-primary/15 text-primary font-medium" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                                )}
                            >
                                <Icon className="h-4 w-4" />
                                <span>{item.label}</span>
                            </Link>
                        );
                    })}
                </nav>
                <div className="border-t p-3 space-y-2">
                    <div className="px-3 py-1">
                        <div className="text-xs uppercase text-muted-foreground tracking-wider">Аккаунт</div>
                        <div className="text-sm truncate" title={me?.email}>{me?.email ?? "…"}</div>
                    </div>
                    <button onClick={logout} className="w-full btn-ghost justify-start">
                        <LogOut className="h-4 w-4" /> Выйти
                    </button>
                </div>
            </aside>
            <main className="overflow-y-auto">
                <div className="container max-w-7xl py-8 px-6 lg:px-10 animate-fade-in">
                    <Outlet />
                </div>
            </main>

            {/* Несносимый модал «Сессия истекла» (ADM-03/08): без Escape/backdrop-close —
                единственный выход «Войти». Обычный Modal не подходит (он закрываемый). */}
            {sessionExpired && (
                <div
                    className="fixed inset-0 z-[60] grid place-items-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in"
                    role="alertdialog"
                    aria-modal="true"
                    aria-label="Сессия истекла"
                >
                    <div className="card max-w-sm w-full p-6 space-y-4 animate-slide-up">
                        <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 grid place-items-center shrink-0">
                                <ShieldAlert className="h-5 w-5" />
                            </div>
                            <h2 className="text-lg font-semibold">Сессия истекла</h2>
                        </div>
                        <p className="text-sm text-muted-foreground">
                            Войди снова через Google — после входа вернёшься на эту же страницу.
                        </p>
                        <button onClick={relogin} className="btn-primary w-full py-2.5">Войти</button>
                    </div>
                </div>
            )}
        </div>
    );
}
