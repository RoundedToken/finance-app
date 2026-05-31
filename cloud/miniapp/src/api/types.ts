/** Типы данных из Worker'а (см. docs/data-model.md). */

export interface Account {
    id: string;
    name: string;
    type: string;
    currency: string;
    form?: string;            // 'cash' | 'digital' | 'external'
    is_active?: number;
    color?: string | null;
    sort_order?: number;
}

export interface Category {
    id: string;
    name: string;
    type: string;             // 'expense' | 'income'
    parent_id: string | null;
    emoji: string | null;
    color: string | null;
    sort_order: number;
    is_active: number;
}

export interface Currency {
    code: string;
    name: string;
    emoji: string | null;
    is_crypto: number;
    decimals: number;
}

export interface Rates {
    date: string | null;
    base: string;             // 'EUR'
    quotes: Record<string, number>;   // 1 EUR = rate * quote
}

export interface Expense {
    id: string;
    date: string;             // YYYY-MM-DD
    account_id: string | null;
    amount: number;
    currency: string;
    amount_eur?: number | null;   // date-aware EUR-эквивалент (курс даты траты, SPEC-016)
    category_id: string | null;
    note: string | null;
    source: string | null;
    created_at: string;
    updated_at?: string;
}

/** Бюджеты (SPEC-020) — read-only подсказка остатка при вводе траты. */
export type BudgetStatus = "good" | "warn" | "over";

export interface BudgetCategoryProgress {
    budget_id: string;
    category_id: string;
    name: string;
    emoji: string | null;
    color: string | null;
    limit_eur: number;
    spent_eur: number;
    remaining_eur: number;
    pct: number;
    status: BudgetStatus;
    missing_rates: number;
}

export interface BudgetTotalProgress {
    budget_id: string;
    limit_eur: number;
    spent_eur: number;
    remaining_eur: number;
    pct: number;
    status: BudgetStatus;
    missing_rates: number;
}

export interface Budgets {
    month: string;            // "YYYY-MM"
    currency: "EUR";
    total: BudgetTotalProgress | null;
    categories: BudgetCategoryProgress[];
}

export interface Bootstrap {
    accounts: Account[];
    categories: Category[];
    currencies: Currency[];
    rates: Rates;
    expenses: Expense[];
    budgets: Budgets | null;
}

/** Payload для POST/PUT /v1/expenses. account_id — новое (SPEC-014). */
export interface ExpenseInput {
    id: string;
    date: string;
    amount: number;
    currency: string;
    category_id: string | null;
    account_id?: string | null;
    note?: string | null;
    created_at?: string;
}
