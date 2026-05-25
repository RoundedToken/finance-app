export interface Env {
    DB: D1Database;

    // Telegram
    TELEGRAM_BOT_TOKEN: string;

    // Bearer для миграционных endpoints (push references, bulk rates, migrate)
    SYNC_TOKEN: string;

    // Курсы валют (см. ADR-006)
    GOOGLE_RATES_LATEST_CSV: string;

    // Google OAuth для Web Admin (см. ADR-012). Пустые значения = OAuth отключён.
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    GOOGLE_REDIRECT_URI?: string;        // публичный, vars
    ADMIN_JWT_SECRET?: string;           // секрет для подписи сессий
    ADMIN_ALLOWED_EMAILS?: string;       // CSV, lowercased
    ADMIN_ALLOWED_ORIGINS?: string;      // CSV, для проверки return_to (https-origins)
    ADMIN_DEFAULT_RETURN_URL?: string;   // fallback если cookie не дошёл
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
