export interface Env {
    DB: D1Database;
    TELEGRAM_BOT_TOKEN: string;
    SYNC_TOKEN: string;
}

export interface ExpensePayload {
    id: string;
    date: string;
    account_id?: string | null;
    amount: number;
    currency: string;
    category_id?: string | null;
    note?: string | null;
    created_at: string;
}

export interface ExpenseRow extends ExpensePayload {
    user_id: string;
    confirmed_at: string | null;
}

export interface SyncResponse {
    expenses: ExpenseRow[];
    next_since: string;
    has_more: boolean;
}

export interface ConfirmRequest {
    ids: string[];
}
