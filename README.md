# Personal Finance System

Личная финансовая система для одного пользователя: Telegram Mini App для ввода с телефона, локальная SQLite-база как источник правды, Excel как красивый дашборд. Без VPS, без подписок, под полным контролем.

## Зачем

- Ввод расходов с iPhone в Telegram — UI похож на «Расходы ОК», но свой.
- Снапшоты балансов по всем счетам (Сбер, Cash EUR/RSD, биржи, кошельки).
- Обмены валют и цепочки операций (RUB → USDT → EUR) — с фиксацией курса и подсчётом потерь на спреде.
- Курсы валют — из Google автоматически, фиксируются на момент операции.
- Excel-дашборд: динамика капитала, аллокация по валютам/счетам, savings rate.

## Архитектура

```
iPhone (Telegram Mini App)
        │ HTTPS
        ▼
Cloudflare Worker + D1     ← бесплатно, всегда онлайн (не VPS)
        │ REST API
        ▼ при пробуждении MacBook
Локальный SQLite           ← источник правды
        │ regenerate_xlsx.py
        ▼
Finances.xlsx              ← read-only dashboard
```

## Где начать

| Хочу | Документ |
|---|---|
| Поднять проект с нуля | [`docs/setup.md`](docs/setup.md) |
| Понять общую архитектуру | [`docs/architecture.md`](docs/architecture.md) |
| Увидеть текущий статус | [`docs/roadmap.md`](docs/roadmap.md) |
| Узнать почему такие технологии | [`docs/decisions.md`](docs/decisions.md) |
| Работать с агентами Claude | [`CLAUDE.md`](CLAUDE.md) |

## Стек

Python 3.13, SQLite, TypeScript, Cloudflare Workers + D1 + Pages, Telegram Mini Apps, openpyxl/xlsxwriter, Google Sheets как прокси к Google Finance.

## Стоимость

$0/мес. Все облачные сервисы (Cloudflare, Telegram) — бесплатные тарифы, лимиты в 1000× больше реальной нагрузки.
