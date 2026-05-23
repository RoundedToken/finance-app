-- Migration 002: базовые категории расходов
-- Универсальный набор по образцу "Расходы ОК". Расширим/перенесём после миграции CSV из приложения (Этап 4).

INSERT OR IGNORE INTO categories (id, name, type, emoji, sort_order) VALUES
    ('food',          'Еда',          'expense', '🍔', 10),
    ('groceries',     'Продукты',     'expense', '🛒', 20),
    ('cafe',          'Кафе',         'expense', '☕', 30),
    ('transport',     'Транспорт',    'expense', '🚗', 40),
    ('shopping',      'Покупки',      'expense', '🛍️', 50),
    ('entertainment', 'Развлечения',  'expense', '🎬', 60),
    ('health',        'Здоровье',     'expense', '⚕️', 70),
    ('home',          'Дом',          'expense', '🏠', 80),
    ('subscriptions', 'Подписки',     'expense', '📺', 90),
    ('travel',        'Поездки',      'expense', '✈️', 100),
    ('education',     'Образование',  'expense', '📚', 110),
    ('gifts',         'Подарки',      'expense', '🎁', 120),
    ('fees',          'Комиссии',     'expense', '💳', 130),
    ('other',         'Прочее',       'expense', '❓', 999),
    ('salary',        'Зарплата',     'income',  '💰', 10),
    ('refund',        'Возврат',      'income',  '↩️',  20),
    ('gift_in',       'Подарок',      'income',  '🎁', 30),
    ('interest',      'Проценты',     'income',  '📈', 40),
    ('income_other',  'Прочий доход', 'income',  '💵', 99),
    ('fx_gain_loss',  'FX gain/loss', 'system',  '⚖️', 1),
    ('test',          'Тест',         'system',  '🧪', 999);

INSERT INTO _migrations (id, name) VALUES (2, '002_seed_basic_categories');
