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
    // SPEC-011: computed effective balance + manual baseline.
    manual_snapshot?: { id: string; date: string; amount: number } | null;
    effective_balance?: number;
    events_count?: number;
    /** @deprecated SPEC-011: backend больше не возвращает latest_snapshot. */
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
    amount_eur?: number | null;    // date-aware EUR-эквивалент (по курсу даты дохода)
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
    source: "income" | "manual";           // SPEC-012: exchange/transfer убраны.
    income_id?: string;
    date: string;
    amount: number;
    currency_code: string;
    delta_in_target?: number | null;       // вклад в target_currency
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
    /** @deprecated SPEC-012: chain_id/sequence/goal_id больше не записываются. Поля в БД сохранены как «спящие». */
    chain_id?: string | null;
    chain_sequence?: number | null;
    goal_id?: string | null;
    created_at: string;
    updated_at: string;
}

export interface TransactionsResponse {
    transactions: Transaction[];
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



export interface TransactionUpdatePayload {
    date?: string;
    from_account_id?: string;
    to_account_id?: string;
    from_amount?: number;
    to_amount?: number;
    fee_amount?: number | null;
    fee_currency?: string | null;
    note?: string | null;
}

// ── Dashboard (SPEC-013) ─────────────────────────────────────────────────────

export interface DashboardKpi {
    net_worth_eur: number;
    free_net_worth_eur: number;
    targeted_eur: number;
    monthly_burn_eur: number;
    monthly_income_eur: number;
    savings_rate: number | null;          // null если доход = 0
    runway_months: number | null;         // по свободным; null если burn = 0
    runway_months_total: number | null;   // по полному net worth
    burn_window_months: number;
    buckets_without_baseline: number;
    missing_rates: number;
    // SPEC-015: линза «свободные деньги» + Δ к предыдущему окну
    monthly_income_free_eur: number;       // доход за окно без goal-помеченного, /мес
    savings_rate_free: number | null;      // (income_free − burn)/income_free; null если ≤ 0
    prev_monthly_burn_eur: number;
    prev_monthly_income_eur: number;
    prev_monthly_income_free_eur: number;
    prev_net_worth_eur: number;            // net worth на конец окна назад (для Δ)
    prev_free_net_worth_eur: number;
}

export interface NetWorthPoint {
    month: string;                         // "YYYY-MM"
    total_eur: number;
    by_bucket: Record<string, number>;     // account_id → EUR
    by_form: Record<string, number>;       // cash/digital/crypto → EUR
    by_currency: Record<string, number>;   // EUR/RSD/... → EUR
}

export interface CashflowPoint {
    month: string;
    income_eur: number;
    expense_eur: number;
}

export interface ExpenseCategorySlice {
    category_id: string;
    name: string;
    emoji: string | null;
    color: string | null;
    total_eur: number;
    share: number;                         // 0..1
}

export interface DashboardBucket {
    id: string;
    name: string;
    form: string;
    type: string;
    currency: string;
    color: string | null;
    sort_order: number;
}

export interface DashboardResponse {
    as_of: string;
    base: "EUR";
    rates_date: string | null;
    window: { from: string; to: string; months: number };
    kpi: DashboardKpi;
    net_worth_series: NetWorthPoint[];
    cashflow_series: CashflowPoint[];
    expenses_by_category: ExpenseCategorySlice[];
    buckets: DashboardBucket[];
}

