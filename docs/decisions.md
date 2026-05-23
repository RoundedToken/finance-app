# Architecture decision records

Короткие записи о принятых архитектурных решениях. Формат: контекст → варианты → решение → следствия.

## ADR-001: SQLite как локальный источник правды (а не сам .xlsx)

**Контекст.** Изначально пользователь вёл финансы в одном `.xlsx`. С добавлением Telegram-канала ввода `.xlsx` перестал подходить: не транзакционный, не индексируемый, плохо переживает concurrent access, файл может быть открыт в Excel когда бот пишет.

**Варианты.**
- A) Оставить `.xlsx` как ground truth, бот пишет напрямую через openpyxl.
- B) SQLite как ground truth, `.xlsx` — генерируемый отчёт.
- C) PostgreSQL.

**Решение.** B — SQLite.

**Почему.**
- ACID + WAL — concurrent-safe.
- Один файл, легко бэкапить, копировать, версионировать.
- Не требует сервера/демона.
- Питон-нативный (`sqlite3` в стандартной библиотеке).
- Хватает на десятилетия personal finance (никаких миллионов строк).
- PostgreSQL — overkill для одного юзера; требует процесса.

**Следствия.**
- `.xlsx` теперь read-only артефакт, регенерируется из БД.
- Нужен механизм миграций схемы (`local/migrations/`).
- Нужен backup-механизм для `finances.db`.

## ADR-002: Cloudflare Workers + D1 для облачного канала

**Контекст.** Нужен endpoint, всегда доступный для iPhone, без VPS, без подписок, без обслуживания.

**Варианты.**
- A) MacBook как сервер (через cloudflared tunnel).
- B) Дешёвый VPS ($5/мес).
- C) Cloudflare Workers + D1.
- D) Firebase Firestore + Cloud Functions.
- E) Supabase free tier.
- F) Self-hosted на Raspberry Pi.

**Решение.** C — Cloudflare Workers + D1.

**Почему.**
- MacBook как сервер исключён: не всегда онлайн.
- VPS исключён пользователем (не хочет платить).
- Cloudflare D1: 5 GB storage + 5M reads/day + 100k writes/day **бесплатно**. Для personal — гигантский запас.
- Cloudflare Workers: 100k requests/day бесплатно. Хватает в 1000×.
- Edge globally — быстрее любого VPS.
- TypeScript-нативно (npm, wrangler).
- Cron Triggers встроены.
- Без обслуживания (это PaaS, не VPS).
- Firebase — Google-vendor-lock-in, политические риски, у RU-пользователей может блокироваться.
- Supabase — нормально, но это полноценный Postgres + auth, оверкилл для outbox-буфера.
- Raspberry Pi — железо + электричество + динамический IP + перезагрузки.

**Следствия.**
- Нужен Cloudflare-аккаунт (бесплатный).
- Worker деплоится через `wrangler` — нужен Node.js.
- Логика split: Worker (TS) + Local scripts (Python).
- Vendor lock-in на Cloudflare-API, но миграция возможна.

## ADR-003: Telegram Mini App как UI ввода

**Контекст.** Пользователь хочет UI «как у Расходы ОК» на iPhone, без App Store, без TestFlight, под своим контролем.

**Варианты.**
- A) Telegram bot — только текстовые сообщения / inline buttons.
- B) Telegram Mini App — полноценный HTML/JS внутри Telegram.
- C) PWA — Progressive Web App (Safari «добавить на главный экран»).
- D) iOS sideloading (AltStore + Apple ID).

**Решение.** B — Telegram Mini App.

**Почему.**
- Telegram уже установлен на iPhone, не нужно ничего ставить.
- Mini App = полноценный UI (HTML/CSS/JS), можно сверстать как «Расходы ОК».
- Telegram WebApp API даёт нативные кнопки, haptics, тему пользователя.
- HTTPS endpoint — Cloudflare Pages бесплатно.
- Авторизация через `initData` — встроено, безопасно.
- Bot — слабый UI для категорий и сеток.
- PWA на iOS ограничен: IndexedDB может очищаться, нет push-нотификаций, plain-page UX.
- iOS sideloading — нужен Mac с Xcode + переподпись каждые 7 дней (с free Apple ID).

**Следствия.**
- Нужен Telegram bot через @BotFather.
- Нужно настроить Mini App URL в @BotFather.
- Mini App хостится на Cloudflare Pages.
- iPhone должен быть в авторизованных users (whitelist по telegram_id).

## ADR-004: D1 — транзитный буфер, не архив

**Контекст.** D1 в Cloudflare бесплатен до 5 GB. Хочется ли хранить всю историю в облаке для удобства бэкапа?

**Варианты.**
- A) D1 как полная копия локальной БД (на случай потери MacBook).
- B) D1 как outbox (только не-засинхронизированные записи).

**Решение.** B — outbox.

**Почему.**
- Меньше данных в облаке = меньше surface for breach.
- Бэкап ground truth решаем через iCloud Drive (`finances.db` копия).
- Sync становится простой: тяни последние N дней, не вся история.
- Идемпотентность гарантирует, что повторный пул безопасен — нет смысла хранить старое.
- Cleanup по cron — `DELETE WHERE confirmed_at < now() - 7 days`.

**Следствия.**
- Параметр «окно безопасности» (7 дней) — настраиваемый.
- Если MacBook оффлайн дольше — рискуем потерять (поэтому подушка 7 дней).
- Нужен Cron Trigger на Worker.

## ADR-005: UUID на клиенте + INSERT OR IGNORE

**Контекст.** Sync должен быть идемпотентным на случай прерываний и повторов.

**Варианты.**
- A) Server-side ID (D1 генерит при INSERT).
- B) Client-side UUID (Mini App генерит, Worker и MacBook принимают).

**Решение.** B — UUID v4 на клиенте.

**Почему.**
- Идемпотентность: повторная отправка той же записи — `INSERT OR IGNORE` по PK не делает ничего.
- Mini App может работать офлайн: ID известен сразу, можно сохранить локально.
- Не нужен round-trip server → client → server.

**Следствия.**
- Все PK бизнес-сущностей — TEXT с UUID (или semantic kebab-case для справочников).

## ADR-006: Google Sheets как прокси к GOOGLEFINANCE

**Контекст.** Пользователь хочет курсы валют «как в Google». Это значит — котировки Morningstar Currency, которые показывает Google в поисковой строке и Google Finance.

**Варианты.**
- A) Скрейпинг Google Search HTML.
- B) Скрейпинг Google Finance страницы.
- C) Google Sheets с `=GOOGLEFINANCE("CURRENCY:USDEUR")`, опубликованный как CSV.
- D) Сторонние API (Frankfurter, exchangerate.host, OpenExchangeRates).
- E) ЦБ РФ для RUB + ЕЦБ для остальных.

**Решение.** C — Google Sheets-прокси, с fallback на D/E для крайних случаев.

**Почему.**
- Google никогда не банит свой же Google Sheets.
- Курсы — те же, что в Google Search.
- Минимум кода — просто `requests.get(<csv-url>)` и парсинг.
- Скрейпинг search/finance — хрупкий, ломается при изменениях HTML.
- Сторонние API не дают курс RUB из-за санкций.

**Следствия.**
- Пользователь один раз настраивает свой Google Sheet (5 минут).
- `local/scripts/fetch_rates.py` читает CSV URL.
- URL Google Sheet — в `.env` (это публичный URL, но всё равно прятать чтобы кто-то не нашёл).

## ADR-007: Python для локальной части, TypeScript для облачной

**Контекст.** На MacBook что писать на чём. Worker — однозначно TS (Cloudflare предписывает).

**Варианты для MacBook.**
- A) Python целиком.
- B) TypeScript / Node.js.
- C) Bash для скриптов + что-то для остального.

**Решение.** A — Python.

**Почему.**
- Python-нативный SQLite в стандартной библиотеке.
- openpyxl/xlsxwriter — best-in-class для Excel-генерации.
- pandas для аналитики.
- Богатая экосистема для CLI/TUI (click, rich, prompt_toolkit).
- Скрипты уже частично написаны на Python для inspect/backup в `finances/scripts/`.

**Следствия.**
- На MacBook два рантайма: Python + Node (для wrangler).
- Worker на TS, локально на Python — нет code sharing, но интерфейс REST.

## ADR-010: Структура — data/ для source, reports/ для generated, tools/ для xlsx-утилит

**Контекст.** На раннем этапе всё лежало в одной папке `finances/`: и Legacy xlsx, и скрипты, и regenerated файлы. После того как появился Mini App + CSV-импорт + скрины — стало тесно и путано.

**Решение.**
- `data/` — все source-данные (Legacy xlsx, CSV из «ОК», скрины). **Целиком gitignored**, только `README.md` в git.
- `reports/` — generated артефакты (`Finances.generated.xlsx`). Регенерируются, не комитятся.
- `tools/` — Python-утилиты для работы с `.xlsx`. Переехало из `finances/scripts/`.
- `local/` — SQLite ground truth + sync + миграции (без изменений).
- `cloud/` — Worker + Mini App (без изменений).

**Почему.**
- Privacy: личные финансы не в git history.
- Чистота: понятно где input, где код, где output.
- Имя `finances/` конфликтовало с темой всего проекта.
- `inspect.py` переименован в `inspect_xlsx.py` — конфликтовал со stdlib `inspect`.

**Следствия.**
- Пути в `tools/excel/_common.py` теперь резолвят `data/legacy/Finances.xlsx`.
- `local/scripts/regenerate_xlsx.py` пишет в `reports/`.
- `.gitignore` уровня директорий: `data/**` и `reports/**` с исключениями для README.

## ADR-009: Bot полностью молчит для не-whitelist пользователей

**Контекст.** Telegram-бот публичный по самой природе Telegram (любой может найти `@finance_stepan_bot` и написать ему). Что бот должен делать с этими сообщениями?

**Варианты.**
- A) Отвечать всем приветствием с инструкциями и показывать Telegram ID.
- B) Отвечать всем «вы не авторизованы», но без деталей.
- C) **Полное молчание для всех, кого нет в `authorized_users`.** Никакого ответа в чат. Логирование в Worker logs для аудита.

**Решение.** C — полное молчание.

**Почему.**
- Минимум поверхности атаки: нет echo, нет утечки наличия системы.
- Сторонние пользователи, случайно нашедшие бота, не получают подтверждения, что он жив. Это снижает интерес к попыткам fuzz/social engineering.
- Telegram ID не является секретом, но его эхо-ответ ботом — лишний сигнал атакующему, что бот «активен».
- Owner логи всё равно видит через `wrangler tail` — если кто-то стучится, видно `event: unauthorized_attempt` с user_id/username.
- Whitelist изначально содержит только владельца — добавление новых требует ручного `wrangler d1 execute INSERT`.

**Следствия.**
- Bootstrap-цепочка: владельцу нужно узнать **свой** Telegram ID до первого взаимодействия с ботом. Способы: `@userinfobot`, Telegram Settings → @username (не ID, нужен ID), `wrangler tail` (один раз посмотреть как сообщение приходит и взять `from.id` из update).
- Документация setup-флоу: после первичной авторизации owner'а — bot отвечает только ему. Для добавления нового пользователя — узнать его ID отдельно, добавить в whitelist через wrangler.
- Тестирование: если bot не отвечает — первая проверка `wrangler d1 execute --command="SELECT * FROM authorized_users"`.

## ADR-008: Excel остаётся как «human-friendly view»

**Контекст.** SQLite ground truth — но смотреть на цифры приятнее в Excel.

**Варианты.**
- A) Заменить Excel на веб-дашборд (HTML).
- B) Использовать Jupyter notebooks.
- C) Регенерировать `.xlsx` из SQLite.

**Решение.** C — регенерация .xlsx.

**Почему.**
- Пользователь уже привык к Excel и любит этот формат.
- Можно открыть на телефоне через Numbers/Microsoft Office.
- Графики, форматирование, conditional formatting — мощно и красиво.
- xlsxwriter позволяет делать это программно с богатыми возможностями.

**Следствия.**
- `regenerate_xlsx.py` запускается после каждого sync.
- `Finances.xlsx` — не редактировать руками (изменения затрутся при следующей регенерации).
- Старый `Finances.xlsx` сохраняется как `Legacy` лист или отдельный файл `finances/Legacy.xlsx`.
