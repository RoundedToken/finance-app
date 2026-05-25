import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type {
    AccountsResponse,
    ExpensesResponse,
    IncomeCategoriesResponse,
    IncomeCreatePayload,
    IncomeUpdatePayload,
    IncomesResponse,
    MeResponse,
    ReferencesResponse,
    SnapshotCreatePayload,
    SnapshotUpdatePayload,
    SnapshotsResponse,
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

export function useCreateIncome() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (payload: IncomeCreatePayload) =>
            apiFetch<{ ok: true; id: string; inserted: boolean }>("/v1/web/incomes", {
                method: "POST",
                body: JSON.stringify(payload),
            }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["incomes"] });
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
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["incomes"] });
        },
    });
}

export function useDeleteIncome() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) =>
            apiFetch<{ ok: true; deleted: boolean }>(`/v1/web/incomes/${id}`, { method: "DELETE" }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["incomes"] });
        },
    });
}
