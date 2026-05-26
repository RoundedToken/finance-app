import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
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
    return useQuery({
        queryKey: ["accounts"],
        queryFn: () => apiFetch<AccountsResponse>("/v1/web/accounts"),
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
    const qs = new URLSearchParams();
    if (params?.from) qs.set("from", params.from);
    if (params?.to) qs.set("to", params.to);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return useQuery({
        queryKey: ["dashboard", params?.from ?? null, params?.to ?? null],
        queryFn: () => apiFetch<DashboardResponse>(`/v1/web/dashboard${suffix}`),
        staleTime: 30_000,
    });
}

