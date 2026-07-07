# Sync protocol

> ⚠️ **HISTORICAL (до-D1 эпоха, ADR-011): описанное ниже не соответствует текущей архитектуре.**
> Протокол outbox-синхронизации целиком отменён ADR-011 — **D1 стал единственным источником
> правды**, локального SQLite и `sync.py` больше нет, MacBook — только daily backup
> (`local/scripts/backup_d1.py`). Из перечисленных ниже endpoint'ов сегодня существует только
> `POST /v1/expenses` (пишет напрямую в `expenses`, не в outbox); `/v1/sync/*`, `sync_state`,
> `device_heartbeats`, cron-cleanup — удалены; `POST /v1/admin/references` удалён SPEC-043
> (аудит 2026-07, FIN-02). Актуальная картина — `docs/architecture.md`. Документ сохранён
> как архив решения.

Документ детально описывает, как данные перемещаются между Mini App, Cloudflare D1 и локальным SQLite.

## Принципы

1. **Идемпотентность.** Каждая запись имеет UUID, генерируемый на клиенте (Mini App). Повторный sync безопасен: `INSERT OR IGNORE` по PK.
2. **Append-only в D1.** Запись в outbox не редактируется, только удаляется через cron после подтверждения.
3. **Двухфазное подтверждение.** MacBook сначала commits локально, потом подтверждает в D1. Если что-то прервалось — повторный sync безопасен.
4. **Tracked sync state на MacBook.** `sync_state.last_synced_at` — high watermark, до какого момента уже забрали.
5. **D1 = buffer, не архив.** Cron-cleanup гарантирует, что D1 не разрастается.

## Endpoints Worker

### `POST /v1/expenses` — Mini App → Worker
Body:
```json
{
  "id": "uuid-v4",
  "date": "2026-05-23",
  "account_id": "acc_cash_eur",
  "amount": 12.50,
  "currency": "EUR",
  "category_id": "cat_food_groceries",
  "note": "Maxi",
  "created_at": "2026-05-23T10:42:01Z"
}
```

Headers: `X-Telegram-Init-Data: <initData>` (Telegram Mini App auth).

Действия Worker:
1. Валидирует `initData` (HMAC от bot token).
2. Извлекает `user_id`, проверяет в `authorized_users`.
3. `INSERT INTO expenses_outbox` — `OR IGNORE` если UUID уже есть.
4. Возвращает `200 {"ok": true, "id": "uuid"}`.

Если ошибка валидации — `401`. Если ошибка БД — `500` с детальным сообщением (Mini App покажет toast).

### `GET /v1/sync?since=<timestamp>` — MacBook → Worker
Headers: `Authorization: Bearer <SYNC_TOKEN>` (хранится в `wrangler secret` и в локальном `.env`).

Возвращает:
```json
{
  "expenses": [ ... записи с created_at > since, упорядочены по created_at ASC ... ],
  "next_since": "2026-05-23T11:00:00Z",
  "has_more": false
}
```

Лимит — 500 записей за запрос (с пагинацией если has_more=true).

### `POST /v1/sync/confirm` — MacBook → Worker
Body:
```json
{
  "ids": ["uuid-1", "uuid-2", ...]
}
```

Действия Worker:
- `UPDATE expenses_outbox SET confirmed_at = now() WHERE id IN (...)`.
- Возвращает `200 {"confirmed": N}`.

### `POST /v1/admin/references` — MacBook → Worker (push справочников)
Когда добавили новый Account или Category локально, нужно обновить D1, чтобы Mini App их увидел. MacBook раз в N синков отправляет полный список accounts/categories/currencies/owners.

Body:
```json
{
  "accounts": [ ... ],
  "categories": [ ... ],
  "currencies": [ ... ],
  "owners": [ ... ]
}
```

Worker: `BEGIN TRANSACTION; DELETE FROM accounts/categories/...; INSERT ...; COMMIT;` — атомарная замена.

### `POST /v1/sync/heartbeat` — MacBook → Worker
После каждого `sync.py --once` MacBook шлёт свой статус в D1, чтобы бот мог его показать пользователю.

Headers: `Authorization: Bearer <SYNC_TOKEN>`.

Body:
```json
{
  "device_id": "macbook",
  "last_sync_attempt_at": "2026-05-23T14:55:41Z",
  "last_sync_success_at": "2026-05-23T14:55:41Z",
  "last_pulled": 0,
  "last_inserted": 0,
  "last_confirmed": 0,
  "last_error": null
}
```

Worker: UPSERT в `device_heartbeats` по `device_id`. Если sync прервался — heartbeat best-effort, ошибки не валят основной flow.

### `GET /v1/sync/status` — bot / Mini App → Worker
Возвращает текущее состояние outbox и последний heartbeat от MacBook. Используется командой `/sync` в боте и кнопкой «Sync now» в Mini App.

Headers: `Authorization: Bearer <SYNC_TOKEN>` (через bot) **или** `X-Telegram-Init-Data` (через Mini App).

Возвращает:
```json
{
  "heartbeat": {
    "device_id": "macbook",
    "last_seen": "2026-05-23 14:55:41",
    "last_sync_attempt_at": "2026-05-23T14:55:41Z",
    "last_sync_success_at": "2026-05-23T14:55:41Z",
    "last_pulled": 0,
    "last_inserted": 0,
    "last_confirmed": 0,
    "last_error": null
  },
  "outbox": { "total": 1, "pending": 0, "confirmed": 1 }
}
```

### `GET /v1/bootstrap` — Mini App → Worker (старт приложения)
Возвращает справочники, чтобы Mini App мог отрисовать UI:
```json
{
  "accounts": [...],
  "categories": [...],
  "currencies": [...]
}
```

Mini App кэширует в `localStorage` и обновляет при следующем запуске.

## Сценарии

### Сценарий 1: счастливый путь
1. На iPhone в Mini App: записать трату 25 EUR на категорию «Кафе».
2. Mini App: `POST /v1/expenses` → 200 OK.
3. Через несколько часов пользователь открывает MacBook.
4. launchd запускает `sync.py`.
5. `GET /v1/sync?since=<вчера>` → возвращает 3 траты, включая запись из шага 1.
6. `INSERT OR IGNORE INTO expenses` локально — 3 новых, 0 проигнорировано.
7. `POST /v1/sync/confirm {ids: [...]}` → 200 OK.
8. `local/sync_state.last_synced_at = next_since`.
9. `regenerate_xlsx.py` → `Finances.xlsx` обновлён.
10. macOS notification: «Синхронизировано: +3 траты».

### Сценарий 2: iPhone офлайн при вводе
1. В Mini App записать трату — нет сети.
2. Mini App кладёт запись в `localStorage.outbox_local`.
3. Mini App периодически (раз в 30 сек или при visibility change) пробует выслать.
4. Когда сеть вернулась — `POST /v1/expenses` срабатывает, запись попадает в D1.
5. Mini App удаляет из `localStorage.outbox_local`.

### Сценарий 3: MacBook закрыт неделю
1. За неделю накопилось 50 expenses в D1, ни одна `confirmed_at IS NULL`.
2. Cron Trigger срабатывает каждую ночь, но удаляет только `confirmed_at IS NOT NULL AND confirmed_at < now()-7d`. Все 50 записей живы.
3. Пользователь открывает MacBook → sync забирает все 50 в один батч → подтверждает.
4. Cron на следующую ночь начинает старить эти записи (но не удаляет ещё 7 дней).

### Сценарий 4: sync прервался посередине
1. `GET /v1/sync` вернул 50 записей.
2. `INSERT OR IGNORE` локально успешно для всех 50.
3. **Crash MacBook** перед `POST /confirm`.
4. При следующем запуске: `last_synced_at` не обновился → `GET /v1/sync?since=<старая дата>` вернёт те же 50 + новые.
5. `INSERT OR IGNORE` — старые 50 уже есть, ignored. Новые добавляются.
6. `POST /confirm` — для всех записей, включая ранее не подтверждённые.

Никаких дубликатов, никаких потерь.

### Сценарий 5: пользователь редактирует/удаляет трату с iPhone
**Этап 1 не поддерживает редактирование/удаление с телефона.** При необходимости — править вручную в локальном SQLite через `python local/scripts/edit_expense.py <uuid>`.

**Этап 2** — добавим `DELETE /v1/expenses/{id}` (soft delete: ставит `deleted_at` в D1, MacBook читает и тоже soft-deletes локально).

### Сценарий 6: D1 чистит синхронизированную запись
1. Запись `expense_X` создана 14 дней назад.
2. MacBook подтвердил приём 10 дней назад (`confirmed_at = now()-10d`).
3. Cron Trigger: `DELETE FROM expenses_outbox WHERE confirmed_at < now()-7d` → запись удаляется.
4. Локально она по-прежнему есть. Никаких проблем.

## Безопасность sync-канала

- `POST /v1/expenses` защищён `initData` (Telegram-подпись).
- `GET /v1/sync` + `POST /v1/sync/confirm` + `POST /v1/admin/*` защищены **bearer token**, который хранится:
  - в Cloudflare как `wrangler secret put SYNC_TOKEN`
  - локально в `.env` (в `.gitignore`)
- HTTPS обязателен — Cloudflare даёт автоматически.

## Мониторинг и отладка

- Worker логирует каждый запрос в Cloudflare logs (видно в дашборде CF).
- `sync.py` пишет в `local/logs/sync.log` (rotated daily).
- Каждый sync — строка `2026-05-23T10:00:00Z | pulled=12 inserted=12 confirmed=12 duration_ms=340`.
- При ошибках — macOS notification «Sync failed: ...» с возможностью повторить.

## Что НЕ покрывает протокол

- Multi-device sync (только один MacBook).
- Конфликт-резолюция при параллельной правке (никто параллельно не правит).
- Backup данных (отдельный механизм, см. `docs/architecture.md → Отказоустойчивость`).
