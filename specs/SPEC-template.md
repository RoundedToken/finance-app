---
id: SPEC-NNN
title: <короткий, описательный, < 80 символов>
status: draft | approved | in_progress | done | cancelled
owner: stepan
created: YYYY-MM-DD
updated: YYYY-MM-DD
links:
  - adr: docs/decisions.md#adr-XXX
  - parent: SPEC-XXX  # если эта фича декомпозирует другой spec
  - depends_on: [SPEC-XXX, SPEC-YYY]
---

# <Заголовок>

## 1. Context & Problem

Что болит сейчас? Какая ситуация привела к нужде в этой фиче? 2-4 предложения максимум.

## 2. Goals

Что считаем «успехом» по итогу. Каждый goal проверяемый.
- G1: …
- G2: …

## 3. Non-Goals

Что **не** входит в эту итерацию. Защищает scope от расползания.
- NG1: …

## 4. User journeys

Опиши ключевые сценарии end-to-end. Не псевдокодом, а словами в стиле «как пользователь, я … чтобы …».

### Happy path
1. Пользователь делает X.
2. Система показывает Y.
3. ...

### Edge cases
- E1: Что если пользователь … ?
- E2: Что если данных нет / устарели / 401?

## 5. Data model

Что добавляется/меняется в D1. Включи DDL миграции в код-блоке если есть.

```sql
-- пример
CREATE TABLE IF NOT EXISTS new_table (...);
ALTER TABLE existing ADD COLUMN ...;
```

Семантика полей: что хранится, в каких единицах, какие константы.

## 6. API contract

Endpoints, методы, auth, request/response shape.

### `GET /v1/web/<resource>`
- Auth: JWT (Bearer)
- Query: `from`, `limit`, ...
- Response 200:
  ```json
  { "items": [...] }
  ```
- Response 401/403/4xx/5xx — что и когда.

### `POST /v1/web/<resource>`
...

## 7. UI / UX

Если фича имеет UI: какие экраны, какие потоки, какие состояния (loading/empty/error). Можно ASCII-mockup.

## 8. Security

- Какие auth-checks обязательны?
- Input validation: что валидируем, как?
- PII / финансовые данные — какие?
- Что **не** должно попасть в логи/телеметрию?

## 9. Acceptance criteria

Список **тестируемых** утверждений вида «GIVEN ... WHEN ... THEN ...» или просто чёткий пункт. Чек-боксы.

- [ ] AC1: На пустом стейте показывается onboarding-сообщение.
- [ ] AC2: При создании записи через POST endpoint возвращает 200 + новая запись в D1.
- [ ] AC3: При 401 SPA очищает токен и редиректит на /login.

## 10. Test plan

Что тестируется и как.

- **Worker**: curl smoke-tests / vitest functional.
- **Admin SPA**: Playwright + manual UI walkthrough.
- **Mini App**: existing Playwright tester (`local/scripts/test_ui.py`).
- **Regression**: какие соседние модули проверить.

## 11. Risks & open questions

- R1: …
- OQ1: <вопрос ждущий уточнения от пользователя>

## 12. Out of scope для review

(Опционально.) Что review **не** должен ругать в этой итерации — потому что оно сознательно отложено.

## 13. Changelog spec'а

- YYYY-MM-DD: создан в `draft`.
- YYYY-MM-DD: одобрен, перешёл в `in_progress`.
- YYYY-MM-DD: `done` после Phase 4.
