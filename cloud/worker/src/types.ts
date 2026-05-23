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
    source?: string;
    source_record_id?: string | null;
    created_at: string;
}
