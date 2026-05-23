-- Migration 004: добавляем категории, обнаруженные при импорте CSV (статьи без маппинга).

INSERT OR IGNORE INTO categories (id, name, type, emoji, sort_order) VALUES
    ('tips',       'Чаевые',     'expense', '💵', 33),
    ('government', 'Гос услуги', 'expense', '🏛️', 96),
    ('debts',      'Долги',      'expense', '💳', 97),
    ('adult',      '18+',        'expense', '🔞', 999);

INSERT INTO _migrations (id, name) VALUES (4, '004_extend_categories_v2');
