# Development Process

Этот документ — единственный источник правды по тому, **как** мы разрабатываем фичи. Что разрабатываем — в `docs/roadmap.md`. Почему так — в `docs/decisions.md`. Безопасность — в `docs/security.md`.

## Принципы

1. **Один документ на фичу** — единая спецификация (бизнес+техническое в одном). Никакого деления на BRD / TRD.
2. **Итеративно** — каждая фича маленькая, имеет чёткое начало и end-of-cycle.
3. **Двойной gate перед push** — review и test обязательны и параллельны.
4. **Прозрачность истории** — push всегда после Phase 3, даже если есть must-fix; фикс прилетает следующим commit'ом.
5. **Никакого silent додумывания** — если spec неполный, возвращаемся в Phase 1.

## Pipeline на каждую фичу

```
┌─ Phase 1: Discovery & Spec ─────────────────────────┐
│   ИИ как product/system analyst.                    │
│   Задаёт уточняющие вопросы (AskUserQuestion).      │
│   Финал: specs/SPEC-NNN-<slug>.md по шаблону.       │
└─────────────────┬───────────────────────────────────┘
                  │ spec одобрен
┌─────────────────▼───────────────────────────────────┐
│  Phase 2: Implementation                            │
│  Код по spec'у. Если spec неполный → назад в P1.    │
└─────────────────┬───────────────────────────────────┘
                  │ implementation done
┌─────────────────▼───────────────────────────────────┐
│  Phase 3: Quality gates (параллельно)               │
│  ┌── 3a: Testing ──┐    ┌── 3b: Code review ────┐  │
│  │ senior-qa       │    │ solution-architect    │  │
│  │ subagent        │    │ subagent              │  │
│  │ (см. .claude/   │    │ (см. .claude/         │  │
│  │  agents/)       │    │  agents/)             │  │
│  └────────┬────────┘    └───────────┬───────────┘  │
│           └──────────┬───────────────┘              │
│              report (must-fix / nice / approved)    │
└─────────────────┬───────────────────────────────────┘
                  │ regardless of result
┌─────────────────▼───────────────────────────────────┐
│  Phase 4: Commit & push                             │
│  - commit "feat(<scope>): <spec_id> <subject>"      │
│  - push сразу                                        │
│  - must-fix → отдельный commit "fix(<scope>): ..."  │
│  - nice-to-have → backlog в roadmap                 │
└─────────────────────────────────────────────────────┘
```

## Phase 1: Discovery & Spec

### Что делает ИИ (как Product + System Analyst)

1. Задаёт уточняющие вопросы — приоритет короткие выборы через `AskUserQuestion`. Темы:
   - **Зачем** — какую проблему решаем, какая боль ушла.
   - **User journey** — happy path + edge cases.
   - **Non-goals** — что *не* делаем в этой итерации.
   - **Data model** — что добавляется/меняется в D1.
   - **API contract** — какие endpoints (method/path/body/response).
   - **UI** — какие экраны/состояния/потоки.
   - **Безопасность** — auth, input validation, secrets, PII.
   - **Acceptance criteria** — конкретно и тестируемо.
2. Сохраняет ответы. Если что-то неясно — переспрашивает.
3. Пишет `specs/SPEC-NNN-<kebab-slug>.md` по шаблону.
4. Спрашивает «spec ок?», ждёт одобрения.

### Что одобряет пользователь

- Понимание зачем (бизнес-цель).
- Достаточно ли scope (не too small / too big).
- Технические решения (data model, API shape).
- Acceptance criteria.

### Где живут spec'и

- `specs/SPEC-001-<slug>.md` … `specs/SPEC-NNN-<slug>.md`
- Шаблон: `specs/SPEC-template.md`
- Numbering: монотонно нарастающий, никогда не переиспользовать (даже если spec был аннулирован — оставляем файл с `status: cancelled`).

## Phase 2: Implementation

1. Реализация **строго по spec'у**.
2. Если в процессе обнаружено что spec неполный — **stop**, обсуждаем, обновляем spec, идём дальше. Не молча додумываем.
3. Commit'ы могут быть несколько (по логическим шагам), но финальный push — после Phase 3.

## Phase 3: Quality gates (параллельно)

Запускаются через `Agent` tool с двумя tool calls в одном message:

```
Agent (subagent_type=senior-qa)        ← тестирование
Agent (subagent_type=solution-architect) ← review
```

### 3a. Testing — `senior-qa` agent

Чеклист агенту:
- Каждый acceptance criteria из SPEC покрыт.
- Edge cases (пустые/null значения, граничные числа, race conditions).
- Error states (что UI показывает при 500/401/network failure).
- Authentication флоу (initData для Mini App, JWT для Admin).
- Responsive (mobile / desktop).
- Accessibility (ARIA, keyboard navigation, контраст).
- Регрессии в смежных модулях.

Формат отчёта от agent'а: см. `.claude/agents/senior-qa.md`.

### 3b. Code review — `solution-architect` agent

Чеклист агенту:
- Соответствие SPEC (нет ли silent scope creep / scope cut).
- Соответствие ADR (особенно ADR-011 D1-centric, ADR-012 Web Admin, ADR-009 silent bot).
- SOLID, без over-engineering (YAGNI).
- DRY, но без преждевременной абстракции (3 повтора — норма для bugfix; абстрагируем при 4+).
- Читаемость > clever.
- Type safety (TS strict, никаких `any` без комментария).
- Безопасность: auth check на mutating endpoint, input validation, no secrets in code.
- Performance критичных путей (D1 queries, large render lists).

Формат отчёта от agent'а: см. `.claude/agents/solution-architect.md`.

## Phase 4: Commit & push

Conventional commits:
- `feat(<scope>): <SPEC-NNN> <subject>` — основная разработка.
- `fix(<scope>): <SPEC-NNN> <subject>` — fix-commit после review/test findings.
- `docs(<scope>): <subject>` — изменения только в docs/SPEC.
- `chore(<scope>): <subject>` — config/build/tooling.
- `refactor(<scope>): <subject>` — без изменения поведения.

Scopes: `worker`, `admin`, `miniapp`, `d1`, `docs`, `tooling`, `specs`, `security`.

Push policy:
- **Безусловно** push после Phase 3 (даже с must-fix). История прозрачна.
- Must-fix → fix-commit **сразу** после, отдельным push.
- Nice-to-have → запись в `docs/roadmap.md` (раздел Tech debt).

Before push — обязательно:
- `gitleaks dir --no-banner` clean.
- `git status` — нет лишнего.
- См. `docs/security.md` → чеклист «Перед каждым push».

## Двухфазный переход на этот процесс

**Phase A — Retrospective (один раз, сейчас):**
- Закрытые stages (1-5a) проходят retro-pipeline:
  1. Пишутся spec'и постфактум (на основе текущего кода и git history).
  2. Запускаются `senior-qa` + `solution-architect` параллельно.
  3. Findings → must-fix commits + nice-to-have в backlog.
  4. Initial push в GitHub.

**Phase B — Forward (с stage 6):**
- Каждая новая фича — с самого начала по полному pipeline.

## Что НЕ работает в этом процессе

- ❌ Пропустить Phase 1 «потому что фича маленькая». Минимум на 5 строк spec нужен.
- ❌ Запустить только review без test (или наоборот). Только параллельно.
- ❌ «Сначала закроем все must-fix, потом push». Нет — push сырой, fix-commit сразу.
- ❌ Молча редактировать spec во время Phase 2 без подтверждения. Любое изменение scope = возврат в Phase 1.

## Артефакты процесса

| Файл | Назначение |
|---|---|
| `docs/process.md` | этот документ |
| `docs/security.md` | security protocols |
| `docs/decisions.md` | ADR |
| `docs/roadmap.md` | план stages + backlog |
| `specs/SPEC-NNN-*.md` | спецификации фич |
| `specs/SPEC-template.md` | шаблон |
| `.claude/agents/senior-qa.md` | QA subagent |
| `.claude/agents/solution-architect.md` | architecture subagent |
| `.githooks/pre-commit` | gitleaks pre-commit |
