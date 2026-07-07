# Personal Finance System

Личная финансовая система для одного пользователя: Telegram Mini App для ввода с телефона, Web Admin для управления и аналитики, Cloudflare D1 как единственный источник правды (ADR-011/012). Без VPS, без подписок, под полным контролем.

## Зачем

- Ввод расходов с iPhone в Telegram — UI похож на «Расходы ОК», но свой.
- Снапшоты балансов по всем счетам (банк, Cash EUR/RSD, биржи, кошельки).
- Обмены валют (RUB → USDT → EUR) — с фиксацией курса и подсчётом потерь на спреде.
- Курсы валют — из Google автоматически, фиксируются на момент операции.
- Web Admin-дашборды: динамика капитала, аллокация по валютам/счетам, savings rate, бюджеты, цели, крипто-портфель.

## Архитектура

```
iPhone (Telegram Mini App)      Desktop browser (Web Admin)
        │ HTTPS (initData HMAC)         │ HTTPS (Google OAuth → JWT)
        ▼                               ▼
Cloudflare Worker  ── единственный API (REST + bot + cron)
        │
        ▼
Cloudflare D1      ← ИСТОЧНИК ПРАВДЫ (ADR-011)
        │ wrangler d1 export (daily, launchd)
        ▼
MacBook            ← только backup (local/backups/ + iCloud)
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

TypeScript (Worker + два React SPA), Cloudflare Workers + D1 + Pages, Telegram Mini Apps, Google Sheets как прокси к Google Finance. Python 3.13 — только backup D1 и локальные UI-тест-харнесы.

## Стоимость

$0/мес. Все облачные сервисы (Cloudflare, Telegram) — бесплатные тарифы, лимиты в 1000× больше реальной нагрузки.
