import { createRootRoute, createRoute, Outlet, redirect } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { getToken, isExpired } from "@/lib/auth";
import { AppLayout } from "@/components/AppLayout";
import { LoginPage } from "@/routes/LoginPage";
import { DashboardPage } from "@/routes/DashboardPage";
import { ExpensesPage } from "@/routes/ExpensesPage";
import { AccountsPage } from "@/routes/AccountsPage";
import { SnapshotsPage } from "@/routes/SnapshotsPage";
import { IncomesPage } from "@/routes/IncomesPage";
import { GoalsPage } from "@/routes/GoalsPage";
import { GoalDetailPage } from "@/routes/GoalDetailPage";
import { TransactionsPage } from "@/routes/TransactionsPage";
import { CategoriesPage } from "@/routes/CategoriesPage";

interface RouterContext { queryClient: QueryClient }

const rootRoute = createRootRoute<RouterContext>({
    component: () => <Outlet />,
});

const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/login",
    component: LoginPage,
});

const authedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "authed",
    beforeLoad: () => {
        const token = getToken();
        if (!token || isExpired(token)) {
            throw redirect({ to: "/login" });
        }
    },
    component: AppLayout,
});

const indexRoute = createRoute({
    getParentRoute: () => authedRoute,
    path: "/",
    component: DashboardPage,
});

const expensesRoute = createRoute({
    getParentRoute: () => authedRoute,
    path: "/expenses",
    component: ExpensesPage,
});

const accountsRoute = createRoute({
    getParentRoute: () => authedRoute,
    path: "/accounts",
    component: AccountsPage,
});

const snapshotsRoute = createRoute({
    getParentRoute: () => authedRoute,
    path: "/snapshots",
    component: SnapshotsPage,
});

const incomesRoute = createRoute({
    getParentRoute: () => authedRoute,
    path: "/incomes",
    component: IncomesPage,
});

const goalsRoute = createRoute({
    getParentRoute: () => authedRoute,
    path: "/goals",
    component: GoalsPage,
});

const goalDetailRoute = createRoute({
    getParentRoute: () => authedRoute,
    path: "/goals/$goalId",
    component: GoalDetailPage,
});

const transactionsRoute = createRoute({
    getParentRoute: () => authedRoute,
    path: "/transactions",
    component: TransactionsPage,
});

const categoriesRoute = createRoute({
    getParentRoute: () => authedRoute,
    path: "/categories",
    component: CategoriesPage,
});

export const routeTree = rootRoute.addChildren([
    loginRoute,
    authedRoute.addChildren([
        indexRoute, accountsRoute, snapshotsRoute, expensesRoute,
        incomesRoute, goalsRoute, goalDetailRoute,
        transactionsRoute, categoriesRoute,
    ]),
]);
