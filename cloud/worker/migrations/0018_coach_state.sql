-- SPEC-040: coach cooldown — один сигнал не повторяется чаще COOLDOWN_DAYS.
CREATE TABLE IF NOT EXISTS coach_state (
    signal_key  TEXT PRIMARY KEY,   -- 'gap_no_expenses' | 'budget_over' | 'bucket_no_baseline' | ...
    last_fired  TEXT NOT NULL,      -- YYYY-MM-DD последней отправки
    last_detail TEXT                -- опц. снимок значения (под будущую change-детекцию)
);
