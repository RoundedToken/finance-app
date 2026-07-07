import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import type { Bootstrap, Expense, ExpenseInput } from "./types";

/** Справочники + начальный список расходов (для recent на главной). */
export function useBootstrap() {
    return useQuery({
        queryKey: ["bootstrap"],
        queryFn: () => api<Bootstrap>("/v1/bootstrap"),
        staleTime: 5 * 60_000,
    });
}

/** Полный список расходов (для истории, lazy-рендер на клиенте). */
export function useExpenses() {
    return useQuery({
        queryKey: ["expenses"],
        queryFn: () => api<{ expenses: Expense[] }>("/v1/expenses?limit=20000"),   // SPC-06 (волна 2): симметрия с bootstrap — тихий потолок 5000 резал Историю/Статистику «Всё»
        staleTime: 30_000,
    });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
    qc.invalidateQueries({ queryKey: ["expenses"] });
    qc.invalidateQueries({ queryKey: ["bootstrap"] });
}

export function useCreateExpense() {
    const qc = useQueryClient();
    return useMutation({
        // inserted:false = ретрай уже записанной траты (MA-01) — UI показывает «Уже сохранено».
        mutationFn: (e: ExpenseInput) => api<{ ok: boolean; inserted: boolean }>("/v1/expenses", { method: "POST", body: JSON.stringify(e) }),
        onSuccess: () => invalidate(qc),
    });
}

export function useUpdateExpense() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, patch }: { id: string; patch: Partial<ExpenseInput> }) =>
            api(`/v1/expenses/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
        onSuccess: () => invalidate(qc),
    });
}

export function useDeleteExpense() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api(`/v1/expenses/${id}`, { method: "DELETE" }),
        onSuccess: () => invalidate(qc),
    });
}
