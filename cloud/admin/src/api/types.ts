/**
 * Типы payload'ов из Worker'а. Должны совпадать со схемой D1 (см. docs/data-model.md).
 */

export interface Expense {
    id: string;
    date: string;                     // YYYY-MM-DD
    account_id: string | null;
    amount: number;
    currency: string;
    category_id: string | null;
    note: string | null;
    source: string | null;
    created_at: string;
    updated_at: string;
}

export interface Category {
    id: string;
    name: string;
    type: string;
    parent_id: string | null;
    emoji: string | null;
    color: string | null;
    sort_order: number;
    is_active: number;
}

export interface Account {
    id: string;
    name: string;
    type: string;
    currency: string;
    is_active: number;
    color: string | null;
    form?: "cash" | "digital" | "external";
    sort_order?: number;
    latest_snapshot?: { id: string; date: string; amount: number } | null;
}

export interface Snapshot {
    id: string;
    date: string;                 // YYYY-MM-DD
    account_id: string;
    amount: number;
    note: string | null;
    source: string;               // 'manual' | 'auto_transaction'
    transaction_id: string | null;
    created_at: string;
    updated_at: string;
}

export interface Currency {
    code: string;
    name: string;
    emoji: string | null;
    is_crypto: number;
    decimals: number;
}

export interface RatesPayload {
    date: string | null;
    base: "EUR";
    quotes: Record<string, number>;
}

export interface ReferencesResponse {
    accounts: Account[];
    categories: Category[];
    currencies: Currency[];
    rates: RatesPayload;
}

export interface ExpensesResponse {
    expenses: Expense[];
}

export interface MeResponse {
    ok: true;
    email: string;
}

export interface AccountsResponse {
    accounts: Account[];
}

export interface SnapshotsResponse {
    snapshots: Snapshot[];
}

export interface SnapshotCreatePayload {
    date: string;
    account_id: string;
    amount: number;
    note?: string | null;
}

export interface SnapshotUpdatePayload {
    date?: string;
    account_id?: string;
    amount?: number;
    note?: string | null;
}

export interface Income {
    id: string;
    date: string;                  // YYYY-MM-DD
    account_id: string;
    amount: number;
    currency_code: string;
    category_id: string;
    source: string | null;
    note: string | null;
    goal_id: string | null;
    created_at: string;
    updated_at: string;
}

export interface IncomeCategory {
    id: string;
    name: string;
    emoji: string | null;
    color: string | null;
    sort_order: number;
}

export interface IncomesResponse {
    incomes: Income[];
}

export interface IncomeCategoriesResponse {
    categories: IncomeCategory[];
}

export interface IncomeCreatePayload {
    id?: string;
    date: string;
    account_id: string;
    amount: number;
    category_id: string;
    source?: string | null;
    note?: string | null;
    goal_id?: string | null;
}

export interface IncomeUpdatePayload {
    date?: string;
    account_id?: string;
    amount?: number;
    category_id?: string;
    source?: string | null;
    note?: string | null;
    goal_id?: string | null;
}

export type GoalStatus = "active" | "achieved" | "archived";

export interface Goal {
    id: string;
    name: string;
    emoji: string | null;
    color: string | null;
    target_amount: number | null;
    target_currency: string | null;
    deadline: string | null;
    note: string | null;
    status: GoalStatus;
    sort_order: number;
    balance: number;
    balance_missing_rates: number;
    contribution_count: number;
    created_at: string;
    updated_at: string;
}

export interface GoalContribution {
    id: string;
    source: "income" | "manual";
    income_id?: string;
    date: string;
    amount: number;
    currency_code: string;
    account_id: string | null;
    note: string | null;
    created_at: string;
}

export interface GoalDetail {
    goal: Goal;
    contributions: GoalContribution[];
}

export interface GoalsResponse {
    goals: Goal[];
}

export interface GoalCreatePayload {
    id?: string;
    name: string;
    emoji?: string | null;
    color?: string | null;
    target_amount?: number | null;
    target_currency?: string | null;
    deadline?: string | null;
    note?: string | null;
}

export interface GoalUpdatePayload {
    name?: string;
    emoji?: string | null;
    color?: string | null;
    target_amount?: number | null;
    target_currency?: string | null;
    deadline?: string | null;
    note?: string | null;
}

export interface ContributionCreatePayload {
    id?: string;
    goal_id: string;
    date: string;
    amount: number;
    currency_code: string;
    account_id?: string | null;
    note?: string | null;
}

export interface ContributionUpdatePayload {
    goal_id?: string;
    date?: string;
    amount?: number;
    currency_code?: string;
    account_id?: string | null;
    note?: string | null;
}

export type TransactionType = "exchange" | "transfer";

export interface Transaction {
    id: string;
    type: TransactionType;
    date: string;
    from_account_id: string;
    to_account_id: string;
    from_amount: number;
    from_currency: string;
    to_amount: number;
    to_currency: string;
    fee_amount: number | null;
    fee_currency: string | null;
    note: string | null;
    chain_id: string | null;
    chain_sequence: number | null;
    goal_id: string | null;
    created_at: string;
    updated_at: string;
}

export interface TransactionsResponse {
    transactions: Transaction[];
}

export interface ChainDetail {
    chain_id: string;
    transactions: Transaction[];
    initial: { account_id: string; amount: number; currency: string } | null;
    final: { account_id: string; amount: number; currency: string } | null;
    effective_rate: number | null;
    step_count: number;
}

export interface TransactionCreatePayload {
    id?: string;
    type: TransactionType;
    date: string;
    from_account_id: string;
    to_account_id: string;
    from_amount: number;
    to_amount: number;
    fee_amount?: number | null;
    fee_currency?: string | null;
    note?: string | null;
}

export interface ChainStepPayload {
    type: TransactionType;
    from_account_id: string;
    to_account_id: string;
    from_amount: number;
    to_amount: number;
    fee_amount?: number | null;
    fee_currency?: string | null;
}

export interface ChainCreatePayload {
    chain_id?: string;
    date: string;
    note?: string | null;
    steps: ChainStepPayload[];
}
