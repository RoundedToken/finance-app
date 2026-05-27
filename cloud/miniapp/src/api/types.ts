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

export interface Bootstrap {
    accounts: Account[];
    categories: Category[];
    currencies: Currency[];
    rates: Rates;
    expenses: Expense[];
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
