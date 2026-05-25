-- 0008_goals.sql — Stage 7: Цели / целевые фонды (SPEC-007)
--
-- Добавляет:
--   - goals: целевые фонды (name + target?+deadline?+emoji+color+status)
--   - goal_contributions: ручной ledger contributions (backfill, корректировки)
--   - incomes.goal_id: nullable FK для привязки income → goal
--
-- См. SPEC-007 §5 для семантики.

-- ─── Цели ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS goals (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    emoji           TEXT,
    color           TEXT,
    target_amount   REAL CHECK (target_amount IS NULL OR target_amount > 0),
    target_currency TEXT REFERENCES currencies(code),
    deadline        TEXT,                          -- YYYY-MM-DD
    note            TEXT,
    status          TEXT NOT NULL DEFAULT 'active', -- 'active' | 'achieved' | 'archived'
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status);
CREATE INDEX IF NOT EXISTS idx_goals_active ON goals(status, sort_order) WHERE deleted_at IS NULL;

-- ─── Ручные контрибуции в goal ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS goal_contributions (
    id              TEXT PRIMARY KEY,
    goal_id         TEXT NOT NULL REFERENCES goals(id),
    date            TEXT NOT NULL,
    amount          REAL NOT NULL CHECK (amount > 0),
    currency_code   TEXT NOT NULL REFERENCES currencies(code),
    account_id      TEXT REFERENCES accounts(id),
    note            TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_goal_contribs_goal   ON goal_contributions(goal_id);
CREATE INDEX IF NOT EXISTS idx_goal_contribs_date   ON goal_contributions(date);
CREATE INDEX IF NOT EXISTS idx_goal_contribs_active ON goal_contributions(goal_id, date)
    WHERE deleted_at IS NULL;

-- ─── Связь incomes ↔ goal ─────────────────────────────────────────────────
ALTER TABLE incomes ADD COLUMN goal_id TEXT REFERENCES goals(id);
CREATE INDEX IF NOT EXISTS idx_incomes_goal ON incomes(goal_id);
