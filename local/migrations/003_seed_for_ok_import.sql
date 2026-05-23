-- Migration 003: расширение справочников под импорт CSV из «Расходы ОК»
-- Добавляет недостающие категории + аккаунт-источник для исторических трат.

-- Новые категории, которых не было в 002.
INSERT OR IGNORE INTO categories (id, name, type, emoji, sort_order) VALUES
    ('sport',       'Спорт',      'expense', '⚽', 25),
    ('housing',     'Жильё',      'expense', '🏘️', 85),
    ('utilities',   'Коммуналка', 'expense', '💡', 95),
    ('electronics', 'Техника',    'expense', '📱', 55),
    ('leisure',     'Досуг',      'expense', '🎳', 65),
    ('clothing',    'Одежда',     'expense', '👕', 45),
    ('beauty',      'Красота',    'expense', '💄', 75);

-- Аккаунт-источник для импорта. Все исторические RSD-траты до миграции
-- лежат здесь. Это синтетический cash-счёт; реальные source — это статьи
-- в CSV без отдельной типизации.
INSERT OR IGNORE INTO accounts (id, name, type, currency, owner_id, group_name, notes) VALUES
    ('acc_money_ok_rsd', 'Деньги (Расходы ОК)', 'cash', 'RSD', 'self', 'Cash',
     'Историка из приложения «Расходы ОК». Все траты до миграции — на этом счёте.');

INSERT INTO _migrations (id, name) VALUES (3, '003_seed_for_ok_import');
