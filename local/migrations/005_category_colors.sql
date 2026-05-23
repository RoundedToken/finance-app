-- Migration 005: пастельные цвета категорий (для UI Mini App).
-- Цвет — это hex-строка #RRGGBB, мягкая пастельная палитра.

UPDATE categories SET color = '#FFB199' WHERE id = 'food';            -- peach
UPDATE categories SET color = '#B5E3C5' WHERE id = 'groceries';       -- mint
UPDATE categories SET color = '#D7B894' WHERE id = 'cafe';            -- latte
UPDATE categories SET color = '#A8C8F0' WHERE id = 'transport';       -- sky
UPDATE categories SET color = '#F2A8C8' WHERE id = 'shopping';        -- pink
UPDATE categories SET color = '#C9A8E8' WHERE id = 'entertainment';   -- lavender
UPDATE categories SET color = '#FAA8A8' WHERE id = 'health';          -- coral
UPDATE categories SET color = '#E8D29B' WHERE id = 'home';            -- sand
UPDATE categories SET color = '#B8C2D9' WHERE id = 'subscriptions';   -- cool grey
UPDATE categories SET color = '#9ED5D5' WHERE id = 'travel';          -- teal
UPDATE categories SET color = '#C9E0B5' WHERE id = 'education';       -- sage
UPDATE categories SET color = '#E8B6E0' WHERE id = 'gifts';           -- lilac
UPDATE categories SET color = '#D5D5D5' WHERE id = 'fees';            -- neutral
UPDATE categories SET color = '#BDBDBD' WHERE id = 'other';           -- grey
UPDATE categories SET color = '#F4C97A' WHERE id = 'sport';           -- amber
UPDATE categories SET color = '#A0B8D9' WHERE id = 'housing';         -- slate
UPDATE categories SET color = '#F8DE7E' WHERE id = 'utilities';       -- yellow
UPDATE categories SET color = '#B0AFE0' WHERE id = 'electronics';     -- periwinkle
UPDATE categories SET color = '#D6B894' WHERE id = 'leisure';         -- tan
UPDATE categories SET color = '#E6B5D6' WHERE id = 'clothing';        -- mauve
UPDATE categories SET color = '#F4B8C2' WHERE id = 'beauty';          -- rose
UPDATE categories SET color = '#D9E6A8' WHERE id = 'tips';            -- lime
UPDATE categories SET color = '#C4C4D4' WHERE id = 'government';      -- steel
UPDATE categories SET color = '#E6A8A8' WHERE id = 'debts';           -- terracotta
UPDATE categories SET color = '#D9A8C2' WHERE id = 'adult';           -- dusty rose

-- Income / system категории — нейтральные холодные тона
UPDATE categories SET color = '#A8E0B8' WHERE id = 'salary';
UPDATE categories SET color = '#B8DBE6' WHERE id = 'refund';
UPDATE categories SET color = '#D5C9E8' WHERE id = 'gift_in';
UPDATE categories SET color = '#C9E0B5' WHERE id = 'interest';
UPDATE categories SET color = '#CCD2DD' WHERE id = 'income_other';
UPDATE categories SET color = '#D5D5D5' WHERE id = 'fx_gain_loss';
UPDATE categories SET color = '#E8E8E8' WHERE id = 'test';

-- Также обновим эмодзи currencies для флагов (RSD не получил emoji в 001)
UPDATE currencies SET emoji = '🇪🇺' WHERE code = 'EUR';
UPDATE currencies SET emoji = '🇺🇸' WHERE code = 'USD';
UPDATE currencies SET emoji = '🇷🇺' WHERE code = 'RUB';
UPDATE currencies SET emoji = '🇷🇸' WHERE code = 'RSD';
UPDATE currencies SET emoji = '💎' WHERE code = 'USDT';

INSERT INTO _migrations (id, name) VALUES (5, '005_category_colors');
