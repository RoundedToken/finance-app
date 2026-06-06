import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { todayLocal } from "@/lib/utils";
import type {
    AccountsResponse,
    ContributionCreatePayload,
    ContributionUpdatePayload,
    ExpensesResponse,
    GoalCreatePayload,
    GoalDetail,
    GoalStatus,
    GoalUpdatePayload,
    GoalsResponse,
    IncomeCategoriesResponse,
    ManagedCategoriesResponse,
    CategoryCreatePayload,
    CategoryUpdatePayload,
    IncomeCreatePayload,
    IncomeUpdatePayload,
    IncomesResponse,
    MeResponse,
    ReferencesResponse,
    SnapshotCreatePayload,
    SnapshotUpdatePayload,
    SnapshotsResponse,
    TransactionCreatePayload,
    TransactionUpdatePayload,
    TransactionsResponse,
    DashboardResponse,
    BudgetsResponse,
    BudgetCreatePayload,
    BudgetUpdatePayload,
    BudgetRecommendationsResponse,
    BudgetRecommendation,
    BudgetArchetypesResponse,
    BudgetSettingsPatch,
    InvestmentsResponse,
    InvestmentSettingsPayload,
} from "./types";

export function useMe() {
    return useQuery({
        queryKey: ["me"],
        queryFn: () => apiFetch<MeResponse>("/v1/web/me"),
        retry: false,
        staleTime: 5 * 60_000,
    });
}

export function useReferences() {
    return useQuery({
        queryKey: ["references"],
        queryFn: () => apiFetch<ReferencesResponse>("/v1/web/references"),
        staleTime: 5 * 60_000,
    });
}

export function useExpenses() {
    return useQuery({
        queryKey: ["expenses"],
        queryFn: () => apiFetch<ExpensesResponse>("/v1/web/expenses?limit=20000"),
        staleTime: 60_000,
    });
}

export function useAccounts() {
    // SPEC-024: «сегодня» = локальный день клиента (asOf балансов «сейчас»), не UTC.
    // В queryKey → рефетч на локальной полуночи (балансы катятся в новый день).
    const today = todayLocal();
    return useQuery({
        queryKey: ["accounts", today],
        queryFn: () => apiFetch<AccountsResponse>(`/v1/web/accounts?today=${today}`),
        staleTime: 30_000,
    });
}

export function useSnapshots() {
    return useQuery({
        queryKey: ["snapshots"],
        queryFn: () => apiFetch<SnapshotsResponse>("/v1/web/snapshots?limit=20000"),
        staleTime: 30_000,
    });
}

export function useCreateSnapshot() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (payload: SnapshotCreatePayload) =>
            apiFetch<{ ok: true; id: string; inserted: boolean }>("/v1/web/snapshots", {
                method: "POST",
                body: JSON.stringify(payload),
            }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["snapshots"] });
            qc.invalidateQueries({ queryKey: ["accounts"] });
            qc.invalidateQueries({ queryKey: ["investments"] });   // SPEC-026: снапшот инвест-ведра = доход стейкинга
        },
    });
}

export function useUpdateSnapshot() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, patch }: { id: string; patch: SnapshotUpdatePayload }) =>
            apiFetch<{ ok: true; updated: boolean }>(`/v1/web/snapshots/${id}`, {
                method: "PUT",
                body: JSON.stringify(patch),
            }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["snapshots"] });
            qc.invalidateQueries({ queryKey: ["accounts"] });
            qc.invalidateQueries({ queryKey: ["investments"] });   // SPEC-026: снапшот инвест-ведра = доход стейкинга
        },
    });
}

export function useDeleteSnapshot() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) =>
            apiFetch<{ ok: true; deleted: boolean }>(`/v1/web/snapshots/${id}`, { method: "DELETE" }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["snapshots"] });
            qc.invalidateQueries({ queryKey: ["accounts"] });
            qc.invalidateQueries({ queryKey: ["investments"] });   // SPEC-026: снапшот инвест-ведра = доход стейкинга
        },
    });
}

export function useIncomeCategories() {
    return useQuery({
        queryKey: ["income-categories"],
        queryFn: () => apiFetch<IncomeCategoriesResponse>("/v1/web/income-categories"),
        staleTime: 5 * 60_000,
    });
}

export function useIncomes() {
    return useQuery({
        queryKey: ["incomes"],
        queryFn: () => apiFetch<IncomesResponse>("/v1/web/incomes?limit=20000"),
        staleTime: 30_000,
    });
}

function invalidateOnIncomeMutation(qc: ReturnType<typeof useQueryClient>) {
    // Доход — это «событие» для счёта (snapshots.ts: incomes +amount): влияет на
    // effective_balance и events_count на странице «Счета». Без инвалидации
    // ["accounts"] баланс/счётчик событий не обновляются до перезагрузки страницы.
    qc.invalidateQueries({ queryKey: ["incomes"] });
    qc.invalidateQueries({ queryKey: ["accounts"] });
}

export function useCreateIncome() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (payload: IncomeCreatePayload) =>
            apiFetch<{ ok: true; id: string; inserted: boolean }>("/v1/web/incomes", {
                method: "POST",
                body: JSON.stringify(payload),
            }),
        onSuccess: (_d, payload) => {
            invalidateOnIncomeMutation(qc);
            // Если income привязан к цели — обновляем goal balance.
            if (payload.goal_id) {
                qc.invalidateQueries({ queryKey: ["goals"] });
                qc.invalidateQueries({ queryKey: ["goal", payload.goal_id] });
            }
        },
    });
}

export function useUpdateIncome() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, patch }: { id: string; patch: IncomeUpdatePayload }) =>
            apiFetch<{ ok: true; updated: boolean }>(`/v1/web/incomes/${id}`, {
                method: "PUT",
                body: JSON.stringify(patch),
            }),
        onSuccess: (_d, { patch }) => {
            invalidateOnIncomeMutation(qc);
            // Goal attachment изменился или amount/account/date — пересчитать
            // balance во всех goals; конкретный goal-detail тоже.
            qc.invalidateQueries({ queryKey: ["goals"] });
            if (patch.goal_id) qc.invalidateQueries({ queryKey: ["goal", patch.goal_id] });
        },
    });
}

export function useDeleteIncome() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) =>
            apiFetch<{ ok: true; deleted: boolean }>(`/v1/web/incomes/${id}`, { method: "DELETE" }),
        onSuccess: () => {
            invalidateOnIncomeMutation(qc);
            qc.invalidateQueries({ queryKey: ["goals"] });
        },
    });
}

// ── Goals ──────────────────────────────────────────────────────────────────

export function useGoals(status: GoalStatus | "all" = "active") {
    return useQuery({
        queryKey: ["goals", status],
        queryFn: () => apiFetch<GoalsResponse>(`/v1/web/goals?status=${status}`),
        staleTime: 30_000,
    });
}

export function useGoalDetail(id: string | undefined) {
    return useQuery({
        queryKey: ["goal", id],
        queryFn: () => apiFetch<GoalDetail>(`/v1/web/goals/${id}`),
        enabled: !!id,
        staleTime: 30_000,
    });
}

export function useCreateGoal() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (payload: GoalCreatePayload) =>
            apiFetch<{ ok: true; id: string; inserted: boolean }>("/v1/web/goals", {
                method: "POST",
                body: JSON.stringify(payload),
            }),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["goals"] }); },
    });
}

export function useUpdateGoal() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, patch }: { id: string; patch: GoalUpdatePayload }) =>
            apiFetch<{ ok: true; updated: boolean }>(`/v1/web/goals/${id}`, {
                method: "PUT",
                body: JSON.stringify(patch),
            }),
        onSuccess: (_d, { id }) => {
            qc.invalidateQueries({ queryKey: ["goals"] });
            qc.invalidateQueries({ queryKey: ["goal", id] });
        },
    });
}

export function useSetGoalStatus() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, status }: { id: string; status: GoalStatus }) =>
            apiFetch<{ ok: true; updated: boolean }>(`/v1/web/goals/${id}/status`, {
                method: "POST",
                body: JSON.stringify({ status }),
            }),
        onSuccess: (_d, { id }) => {
            qc.invalidateQueries({ queryKey: ["goals"] });
            qc.invalidateQueries({ queryKey: ["goal", id] });
        },
    });
}

export function useDeleteGoal() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) =>
            apiFetch<{ ok: true; deleted: boolean }>(`/v1/web/goals/${id}`, { method: "DELETE" }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["goals"] });
            qc.invalidateQueries({ queryKey: ["incomes"] });
        },
    });
}

export function useCreateContribution() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (payload: ContributionCreatePayload) =>
            apiFetch<{ ok: true; id: string; inserted: boolean }>("/v1/web/goal-contributions", {
                method: "POST",
                body: JSON.stringify(payload),
            }),
        onSuccess: (_d, payload) => {
            qc.invalidateQueries({ queryKey: ["goals"] });
            qc.invalidateQueries({ queryKey: ["goal", payload.goal_id] });
        },
    });
}

export function useUpdateContribution() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, patch }: { id: string; patch: ContributionUpdatePayload }) =>
            apiFetch<{ ok: true; updated: boolean }>(`/v1/web/goal-contributions/${id}`, {
                method: "PUT",
                body: JSON.stringify(patch),
            }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["goals"] });
            qc.invalidateQueries({ queryKey: ["goal"] });
        },
    });
}

export function useDeleteContribution() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) =>
            apiFetch<{ ok: true; deleted: boolean }>(`/v1/web/goal-contributions/${id}`, { method: "DELETE" }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["goals"] });
            qc.invalidateQueries({ queryKey: ["goal"] });
        },
    });
}

// ── Transactions / chains ──────────────────────────────────────────────────

export function useTransactions() {
    return useQuery({
        queryKey: ["transactions"],
        queryFn: () => apiFetch<TransactionsResponse>("/v1/web/transactions?limit=20000"),
        staleTime: 30_000,
    });
}

function invalidateOnTxMutation(qc: ReturnType<typeof useQueryClient>) {
    qc.invalidateQueries({ queryKey: ["transactions"] });
    qc.invalidateQueries({ queryKey: ["snapshots"] });
    qc.invalidateQueries({ queryKey: ["accounts"] });
    qc.invalidateQueries({ queryKey: ["investments"] });   // SPEC-026: покупка USDT→ETH меняет позицию
    qc.invalidateQueries({ queryKey: ["dashboard"] });     // invested/free
}

export function useCreateTransaction() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (payload: TransactionCreatePayload) =>
            apiFetch<{ ok: true; id: string; inserted: boolean; snapshot_ids: string[] }>("/v1/web/transactions", {
                method: "POST",
                body: JSON.stringify(payload),
            }),
        onSuccess: () => { invalidateOnTxMutation(qc); },
    });
}

export function useUpdateTransaction() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, patch }: { id: string; patch: TransactionUpdatePayload }) =>
            apiFetch<{ ok: true; updated: boolean; new_snapshot_ids?: string[] }>(`/v1/web/transactions/${id}`, {
                method: "PUT",
                body: JSON.stringify(patch),
            }),
        onSuccess: () => { invalidateOnTxMutation(qc); qc.invalidateQueries({ queryKey: ["goals"] }); qc.invalidateQueries({ queryKey: ["goal"] }); },
    });
}

export function useDeleteTransaction() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) =>
            apiFetch<{ ok: true; deleted: boolean; deleted_snapshots: number }>(`/v1/web/transactions/${id}`, { method: "DELETE" }),
        onSuccess: () => { invalidateOnTxMutation(qc); },
    });
}

// ── Dashboard (SPEC-013) ────────────────────────────────────────────────────

export function useDashboard(params?: { from?: string; to?: string }) {
    // SPEC-024: KPI «сейчас» / asOf — локальный день клиента (не UTC).
    const today = todayLocal();
    const qs = new URLSearchParams();
    if (params?.from) qs.set("from", params.from);
    if (params?.to) qs.set("to", params.to);
    qs.set("today", today);
    return useQuery({
        queryKey: ["dashboard", params?.from ?? null, params?.to ?? null, today],
        queryFn: () => apiFetch<DashboardResponse>(`/v1/web/dashboard?${qs.toString()}`),
        staleTime: 30_000,
    });
}

// ── Budgets (SPEC-020) ───────────────────────────────────────────────────────

export function useBudgets() {
    return useQuery({
        queryKey: ["budgets"],
        queryFn: () => apiFetch<BudgetsResponse>("/v1/web/budgets"),
        staleTime: 30_000,
    });
}

function invalidateBudgets(qc: ReturnType<typeof useQueryClient>) {
    qc.invalidateQueries({ queryKey: ["budgets"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });   // бюджеты — линза на те же траты
}

export function useCreateBudget() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (payload: BudgetCreatePayload) =>
            apiFetch<{ ok: true; id: string; inserted: boolean }>("/v1/web/budgets", {
                method: "POST",
                body: JSON.stringify(payload),
            }),
        onSuccess: () => invalidateBudgets(qc),
    });
}

export function useUpdateBudget() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, patch }: { id: string; patch: BudgetUpdatePayload }) =>
            apiFetch<{ ok: true; updated: boolean }>(`/v1/web/budgets/${id}`, {
                method: "PUT",
                body: JSON.stringify(patch),
            }),
        onSuccess: () => invalidateBudgets(qc),
    });
}

export function useDeleteBudget() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) =>
            apiFetch<{ ok: true; deleted: boolean }>(`/v1/web/budgets/${id}`, { method: "DELETE" }),
        onSuccess: () => invalidateBudgets(qc),
    });
}

// ── Adaptive budgets RBAR (SPEC-023) — advisory ──────────────────────────────

export function useBudgetRecommendations() {
    return useQuery({
        queryKey: ["budget-recommendations"],
        queryFn: () => apiFetch<BudgetRecommendationsResponse>("/v1/web/budgets/recommendations"),
        staleTime: 60_000,
    });
}

export function useBudgetArchetypes() {
    return useQuery({
        queryKey: ["budget-archetypes"],
        queryFn: () => apiFetch<BudgetArchetypesResponse>("/v1/web/budgets/archetypes"),
        staleTime: 60_000,
    });
}

function invalidateAdaptive(qc: ReturnType<typeof useQueryClient>) {
    qc.invalidateQueries({ queryKey: ["budgets"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["budget-recommendations"] });
    qc.invalidateQueries({ queryKey: ["budget-archetypes"] });
}

/**
 * Применить рекомендацию (advisory G5): создаёт/обновляет ручной лимит SPEC-020
 * + логирует решение. Сама система лимит не двигает — это явное действие.
 */
export function useApplyRecommendation() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ rec, period }: { rec: BudgetRecommendation; period: string }) => {
            const limit = rec.recommended_limit_eur;
            if (limit == null || limit <= 0) throw new Error("Нет рекомендованного лимита для применения");
            if (rec.budget_id) {
                await apiFetch(`/v1/web/budgets/${rec.budget_id}`, { method: "PUT", body: JSON.stringify({ limit_eur: limit }) });
            } else {
                await apiFetch(`/v1/web/budgets`, { method: "POST", body: JSON.stringify({ scope: "category", category_id: rec.category_id, limit_eur: limit }) });
            }
            await apiFetch(`/v1/web/budgets/recommendations/decision`, {
                method: "POST",
                body: JSON.stringify({
                    category_id: rec.category_id, period, archetype: rec.archetype,
                    prev_limit_eur: rec.current_limit_eur, reco_limit_eur: limit,
                    reason_code: rec.reason_code ?? "TRACKING_DOWN", decision: "accepted",
                }),
            });
        },
        onSuccess: () => invalidateAdaptive(qc),
    });
}

export function useDismissRecommendation() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ rec, period }: { rec: BudgetRecommendation; period: string }) =>
            apiFetch(`/v1/web/budgets/recommendations/decision`, {
                method: "POST",
                body: JSON.stringify({
                    category_id: rec.category_id, period, archetype: rec.archetype,
                    prev_limit_eur: rec.current_limit_eur, reco_limit_eur: rec.recommended_limit_eur ?? 0,
                    reason_code: rec.reason_code ?? "HOLD", decision: "dismissed",
                }),
            }),
        onSuccess: () => qc.invalidateQueries({ queryKey: ["budget-recommendations"] }),
    });
}

export function useUpdateBudgetSettings() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ categoryId, patch }: { categoryId: string; patch: BudgetSettingsPatch }) =>
            apiFetch<{ ok: true; updated: boolean }>(`/v1/web/budgets/settings/${categoryId}`, {
                method: "PUT",
                body: JSON.stringify(patch),
            }),
        onSuccess: () => invalidateAdaptive(qc),
    });
}

// ── Investments / крипто-портфель (SPEC-026) ────────────────────────────────

export function useInvestments() {
    const today = todayLocal();   // SPEC-024: «сегодня» — локальный день клиента
    return useQuery({
        queryKey: ["investments", today],
        queryFn: () => apiFetch<InvestmentsResponse>(`/v1/web/investments?today=${today}`),
        staleTime: 30_000,
    });
}

export function useUpdateInvestmentSettings() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ accountId, patch }: { accountId: string; patch: InvestmentSettingsPayload }) =>
            apiFetch<{ ok: true; updated: boolean }>(`/v1/web/investments/settings/${accountId}`, {
                method: "PUT",
                body: JSON.stringify(patch),
            }),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["investments"] }); },
    });
}

// ── Category management (SPEC-017) ──────────────────────────────────────────

type CategoryKind = "expense" | "income";
const catPath = (kind: CategoryKind) => kind === "expense" ? "/v1/web/categories" : "/v1/web/income-categories";

export function useManagedCategories(kind: CategoryKind) {
    return useQuery({
        queryKey: ["managed-categories", kind],
        queryFn: () => apiFetch<ManagedCategoriesResponse>(`${catPath(kind)}?include_inactive=1`),
        staleTime: 30_000,
    });
}

function invalidateCategories(qc: ReturnType<typeof useQueryClient>, kind: CategoryKind) {
    qc.invalidateQueries({ queryKey: ["managed-categories", kind] });
    if (kind === "expense") {
        qc.invalidateQueries({ queryKey: ["references"] });   // refs.categories — Expenses/Dashboard
        qc.invalidateQueries({ queryKey: ["expenses"] });
    } else {
        qc.invalidateQueries({ queryKey: ["income-categories"] });
        qc.invalidateQueries({ queryKey: ["incomes"] });
    }
}

export function useCreateCategory(kind: CategoryKind) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (payload: CategoryCreatePayload) =>
            apiFetch<{ ok: true; id: string; inserted: boolean }>(catPath(kind), { method: "POST", body: JSON.stringify(payload) }),
        onSuccess: () => invalidateCategories(qc, kind),
    });
}

export function useUpdateCategory(kind: CategoryKind) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, patch }: { id: string; patch: CategoryUpdatePayload }) =>
            apiFetch<{ ok: true; updated: boolean }>(`${catPath(kind)}/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
        onSuccess: () => invalidateCategories(qc, kind),
    });
}

