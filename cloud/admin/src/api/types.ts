/**
 * Типы payload'ов из Worker'а. Должны совпадать со схемой D1 (см. docs/data-model.md).
 */

export interface Expense {
    id: string;
    date: string;                     // YYYY-MM-DD
    account_id: string | null;
    amount: number;
    currency: string;
    amount_eur?: number | null;       // date-aware EUR-эквивалент (по курсу даты траты, SPEC-016)
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
    is_investment?: boolean;          // SPEC-026: ведро-актив (входит в net, исключается из free)
    // SPEC-011: computed effective balance + manual baseline.
    manual_snapshot?: { id: string; date: string; amount: number } | null;
    effective_balance?: number;
    effective_balance_eur?: number | null;   // SPEC-016: EUR по курсу на сегодня (worker-side, mark-to-market)
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

export interface AccountsSummary {
    net_worth_eur: number;
    targeted_eur: number;
    invested_eur: number;             // SPEC-026: Σ EUR инвест-вёдер (mark-to-market)
    free_eur: number;                 // = net − targeted − invested
    missing_rates: number;
    rates_date: string | null;
}

export interface AccountsResponse {
    accounts: Account[];
    summary?: AccountsSummary;
}

export interface SnapshotsResponse {
    snapshots: Snapshot[];
}

export interface SnapshotCreatePayload {
    id?: string;                   // ADM-02 (SPEC-044): клиентский UUID для идемпотентного ретрая
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
    is_active?: number;
}

export interface IncomesResponse {
    incomes: Income[];
}

export interface IncomeCategoriesResponse {
    categories: IncomeCategory[];
}

// ── Category management (SPEC-017) ──
export interface ManagedCategory {
    id: string;
    name: string;
    type?: string;
    parent_id?: string | null;
    emoji: string | null;
    color: string | null;
    sort_order: number;
    is_active: number;
}

export interface ManagedCategoriesResponse {
    categories: ManagedCategory[];
}

export interface CategoryCreatePayload {
    id?: string;
    name: string;
    emoji?: string | null;
    color?: string | null;
    sort_order?: number | null;
}

export interface CategoryUpdatePayload {
    name?: string;
    emoji?: string | null;
    color?: string | null;
    sort_order?: number | null;
    is_active?: boolean | number;
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
    balance_eur?: number | null;          // SPEC-017: mark-to-market today (worker-side)
    target_amount_eur?: number | null;
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
    invested_eur: number;                  // SPEC-026: Σ EUR инвест-вёдер (исключено из free)
    prev_invested_eur: number;             // на конец окна назад (для корректного Δ свободных)
}

export interface NetWorthPoint {
    month: string;                         // "YYYY-MM"
    total_eur: number;
    invested_eur?: number;                 // SPEC-026: слой «инвестиции» (опц. для обратной совместимости)
    by_bucket: Record<string, number>;        // account_id → EUR
    by_bucket_native: Record<string, number>; // SPEC-021: account_id → native-валюта ведра (для спарклайнов /accounts)
    by_form: Record<string, number>;       // cash/digital/crypto → EUR
    by_currency: Record<string, number>;   // EUR/RSD/... → EUR
}

export interface CashflowPoint {
    month: string;
    income_eur: number;
    income_free_eur: number;          // SPEC-018: линза «Свободные» — доход без goal-помеченного per month
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
    data_trust_from: string | null;
    window: { from: string; to: string; months: number };
    kpi: DashboardKpi;
    net_worth_series: NetWorthPoint[];
    cashflow_series: CashflowPoint[];
    expenses_by_category: ExpenseCategorySlice[];
    buckets: DashboardBucket[];
}

// ── Budgets (SPEC-020) ───────────────────────────────────────────────────────

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

export interface BudgetsResponse {
    month: string;                 // "YYYY-MM"
    currency: "EUR";
    total: BudgetTotalProgress | null;
    categories: BudgetCategoryProgress[];
}

export interface BudgetCreatePayload {
    id?: string;
    scope?: "category" | "total";
    category_id?: string | null;
    limit_eur: number;
}

export interface BudgetUpdatePayload {
    limit_eur: number;
}

// ── Adaptive budgets RBAR (SPEC-023) ────────────────────────────────────────

export type Archetype = "fixed" | "recurring" | "seasonal" | "lumpy" | "intermittent" | "cold-start";

export interface BudgetEnvelope {
    annual_eur: number;
    accrual_monthly_eur: number;
    accrued_eur: number;
    spent_trailing_12m_eur: number;
    alert: boolean;
}

export interface BudgetRecommendation {
    category_id: string;
    name: string;
    emoji: string | null;
    color: string | null;
    archetype: Archetype;
    archetype_override: Archetype | null;
    budget_id: string | null;
    current_limit_eur: number | null;
    recommended_limit_eur: number | null;
    delta_pct: number | null;
    baseline_eur: number | null;
    floor_eur: number | null;
    reason_code: string | null;
    reason_text: string | null;
    confidence: "ok" | "low";
    envelope: BudgetEnvelope | null;
    dismissed: boolean;
}

export interface BudgetRecommendationsResponse {
    period: string;        // "YYYY-MM"
    currency: "EUR";
    recommendations: BudgetRecommendation[];
}

export interface ArchetypeMetrics {
    n_months: number;
    median_eur: number;
    mean_eur: number;
    cov_resid: number;
    zero_frac: number;
    trend_pct_mo: number;
    spike: boolean;
}

export interface BudgetArchetypeRow {
    category_id: string;
    name: string;
    emoji: string | null;
    color: string | null;
    detected_archetype: Archetype;
    archetype_override: Archetype | null;
    floor_eur: number | null;
    adaptive_enabled: boolean;
    metrics: ArchetypeMetrics;
}

export interface BudgetArchetypesResponse {
    categories: BudgetArchetypeRow[];
}

export interface BudgetSettingsPatch {
    archetype_override?: Archetype | null;
    floor_eur?: number | null;
    adaptive_enabled?: boolean;
}

// ── Investments / крипто-портфель (SPEC-026) ─────────────────────────────────

export interface InvestmentSeriesPoint {
    date: string;            // конец месяца (или today для текущего)
    value_eur: number;
    qty: number;
}

export interface InvestmentPosition {
    account_id: string;
    name: string;
    currency: string;
    color: string | null;
    qty: number;
    price_eur: number | null;
    price_usdt: number | null;           // SPEC-027
    value_eur: number | null;
    value_usdt: number | null;           // SPEC-027
    cost_basis_eur: number | null;       // null если cost_basis_known=false
    cost_basis_known: boolean;
    unrealized_pl_eur: number | null;
    unrealized_pl_pct: number | null;
    is_staked: boolean;
    staked_qty: number;                  // SPEC-027: сколько в стейкинге
    liquid_qty: number;                  // SPEC-027: свободно = qty − staked
    staking_apr_pct: number | null;      // эффективный (override ?? авто Lido)
    staking_apr_override: number | null; // SPEC-027: ручной override
    staking_apr_auto: number | null;     // SPEC-027: авто из Lido
    staking_income_qty: number | null;   // факт: прирост qty, не объяснённый покупками
    staking_income_eur: number | null;
    staking_forecast_eur: number | null;          // SPEC-030: накопл. прогноз по APR
    staking_expected_annual_eur: number | null;   // SPEC-030: ожидаемый €/год
    staked_since: string | null;                  // SPEC-030: дата отсчёта прогноза
    note: string | null;
    last_snapshot_date: string | null;
    value_series: InvestmentSeriesPoint[];
}

export interface InvestmentsSummary {
    value_eur: number;
    value_usdt: number;                  // SPEC-027
    cost_basis_eur: number;
    cost_basis_known: boolean;
    unrealized_pl_eur: number;
    unrealized_pl_pct: number | null;
    staking_income_eur: number;
    staking_forecast_eur: number;                 // SPEC-030
    staking_expected_annual_eur: number;
    missing_rates: number;
}

export interface InvestmentsResponse {
    ok: true;
    as_of: string;
    currency: "EUR";
    rates_date: string | null;
    rate_fetched_at: string | null;   // SPEC-028: момент последнего фетча курса (свежесть)
    summary: InvestmentsSummary;
    positions: InvestmentPosition[];
}

export interface InvestmentSettingsPayload {
    staked_qty?: number | null;          // SPEC-027: сколько в стейкинге (0 = убрать)
    staking_apr_pct?: number | null;     // ручной override; null = авто Lido
    note?: string | null;
}

