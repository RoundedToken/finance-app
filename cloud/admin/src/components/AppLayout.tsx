import { Link, Outlet, useRouter, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, ListChecks, LogOut, Wallet, ArrowRightLeft, TrendingUp, PieChart, Sparkles } from "lucide-react";
import { useMe } from "@/api/queries";
import { clearToken } from "@/lib/auth";
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
    { to: "/incomes", icon: TrendingUp, label: "Доходы" },
    { to: "/transactions", icon: ArrowRightLeft, label: "Обмены", disabled: true },
];

export function AppLayout() {
    const router = useRouter();
    const { data: me } = useMe();
    // useRouter().state — снапшот, не реактивный. Подписываемся через
    // useRouterState, иначе active pill «застревает» на стартовом маршруте.
    const path = useRouterState({ select: s => s.location.pathname });

    const logout = () => {
        clearToken();
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
                        const active = path === item.to;
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
        </div>
    );
}
