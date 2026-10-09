# Аудит структуры проекта и дублирования кода

Дата: 2026-10-10 · Область: `src/js`, `src/components`, `desktop`, `scripts` ·
Методика: рекурсивная группировка файлов по именам, поиск одноимённых
функций/экспортов, анализ импортов (кто кого реально использует).

---

## 1. Одноимённые файлы в разных папках

| Файлы                                                                            | Статус                                                              | Вердикт                                                                                                                          |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `ai-advisor/news-fetcher.ts` ↔ `research/providers/news-fetcher.ts`              | ❌ дубликат с расхождением (хэши разные — правились по отдельности) | **Опасно**: баги чинятся в одной копии, вторая устаревает. Оставить одну (research/providers — новую), ai-advisor импортирует её |
| `finam-api/history-provider.ts` ↔ `moex-api/history-provider.ts`                 | ✅ разные провайдеры одного контракта `fetchHistoricalData`         | Норма. Общий тип вынесен бы в `data-fetcher` — см. §3.3                                                                          |
| `src/components/dashboard/` ↔ `src/js/modules/dashboard/` (dashboard.ts + .scss) | ❌ два дашборда                                                     | Устаревший вариант в `src/components` удалить (проверить вызовы в `src/index.html`)                                              |
| `src/js/app.ts` ↔ `desktop/renderer/app.ts`                                      | ✅ разные контуры (веб и Electron)                                  | Норма                                                                                                                            |
| `index.ts` ×44, `types.ts` ×35                                                   | ✅ баррель + локальные типы модуля                                  | Конвенция проекта — норма                                                                                                        |

---

## 2. Дублирование функций (по коду)

### 2.1 ❌ Критичные (реальный риск рассинхронизации)

1. **`DirectorActionAgents` объявлен дважды, интерфейсы разъезжаются**
   - [`director/agent-facade.ts:98`](src/js/modules/pipeline/director/agent-facade.ts:98) — file/terminal/process/automation/code
   - [`agents/agent-factory.ts:63`](src/js/modules/pipeline/agents/agent-factory.ts:63) — те же поля, но отдельная копия
   - При добавлении роли приходится править оба (уже случилось). **Решение:**
     один интерфейс в `director/agent-factory`-слое; facade импортирует тип из
     factory (или общий `types.ts`). Консумеры factory — только Node-контур.

2. **Токенизатор командных строк ×3** (идентичная логика, включая кавычки):
   - [`director/action-input-builder.ts:180`](src/js/modules/pipeline/director/action-input-builder.ts:180) `splitShellTokens` (экспорт)
   - [`agents/terminal-agent.ts:552`](src/js/modules/pipeline/agents/terminal-agent.ts:552) `tokenize` (приватный)
   - [`coding-workflow/coding-workflow.ts:299`](src/js/modules/pipeline/coding-workflow/coding-workflow.ts:299) `splitCommand` (приватный)
   - **Решение:** оставить `splitShellTokens` единственной; terminal-agent и
     coding-workflow импортируют её (action-input-builder — чистый модуль,
     безопасен для терминала).

3. **Токенизатор текста для векторов ×2**
   - [`rag/vector-store.ts:102`](src/js/modules/rag/vector-store.ts:102) и
     [`ai-memory/vector-search.ts:195`](src/js/modules/pipeline/ai-memory/vector-search.ts:195)
   - Признак дублирования целых подсистем (см. §3.1). Устраняется вместе с ними.

### 2.2 ⚠️ Задокументированные «зеркала» (терпимо, но закрепить тестом)

- [`security-agent.ts:613-624`](src/js/modules/pipeline/agents/security-agent.ts:613)
  `looksLikePath` / `resolveArgPath` — «зеркалит TerminalAgent» (приватные
  копии). Контракты SecurityAgent и TerminalAgent должны совпадать — иначе
  security пропустит то, что терминал выполнит иначе. **Решение:** экспортировать
  хелперы из terminal-agent и импортировать в security-agent + тест-паритет.

### 2.3 ✅ Переиспользование работает корректно

- `isInside` — единственная копия в [file-agent.ts:373](src/js/modules/pipeline/agents/file-agent.ts:373), импортируется security-agent/process-agent;
- `TERMINAL_ALLOWED_COMMANDS` / `TERMINAL_DENY_PATTERNS` / `TERMINAL_INJECTION_CHARS` — единственный источник в terminal-agent, импортируются security/process/factory;
- `computeDecayedWeight` (learning-agent) — одна копия; полураспад в
  interest-tracker — другая формула (другая предметная область).

---

## 3. Дублирование целых подсистем (главная структурная проблема)

### 3.1 Память и вектора — 4 параллельные реализации

| Модуль                                      | Что делает                                          |
| ------------------------------------------- | --------------------------------------------------- |
| `modules/memory-layer`                      | браузерная память приложения (используется app.ts)  |
| `pipeline/ai-memory` (+ `vector-search.ts`) | двухслойная память Директора + свой векторный поиск |
| `modules/rag/vector-store.ts`               | свой векторный поиск для RAG                        |
| `modules/knowledge-base`                    | база знаний (третья «память»)                       |

**Рекомендация (P2):** один слой векторного поиска: `rag/vector-store.ts` —
движок, `ai-memory/vector-search` — адаптер; `knowledge-base` либо merges в
RAG, либо явно переименовывается в свою роль (справочник терминов). Оставить
`memory-layer` (браузерный контур) отдельно — другая среда.

### 3.2 Уведомления — 3 реализации

`modules/notifications` (NotificationEngine, используется тестами pipeline) ↔
`pipeline/infrastructure/os-integration` (новый, системные уведомления) ↔
`pipeline/agents/notification-agent` + `communication-agent`.
**Решение (P2):** `notifications` = доменная логика «что и когда слать»,
`os-integration` = транспорт «как доставить», notification-agent = фасад для
конвейера. Зафиксировать в JSDoc границу + импорт друг друга, дубли удаления.

### 3.3 Данные с рынка

`data-fetcher` (агрегатор, используется data-agent/backtesting/harness) ↔
`finam-api` + `moex-api` (провайдеры). По сути ок, но `history-provider.ts`
дублирует контракт. **Решение (P3):** общий тип OHLCV/контракта — в
`data-fetcher`, провайдеры импортируют.

### 3.4 Исследования/новости

`ai-advisor/news-fetcher.ts` ↔ `research/providers/news-fetcher.ts` — один
файл с расхождением. **P1**: оставить research/providers, импортировать из
ai-advisor, удалить копию.

### 3.5 Мониторинг

`resource-monitor` (метрики ОС; используется adaptive-scheduler) ↔
`pipeline/environment-controller` (контроль окружения агентов). Разные
предметные области — оставить оба, но прописать границы в JSDoc.

### 3.6 Дашборды

`src/components/dashboard` (старый) ↔ `src/js/modules/dashboard` ↔
`pipeline/visualization/smart-dashboard` (агрегатор виджетов, новый) ↔
`.codeassistantignore` упоминает ещё `dashboard.html`/`dashboard.scss`.
**P2:** удалить старый `src/components/dashboard`, modules/dashboard — UI-модуль,
smart-dashboard — серверная агрегация.

### 3.7 Research-агенты

`pipeline/agents/research-agent.ts` ↔ `research-agent-v2/` ↔ `modules/research/`
(thesis/providers). **P3:** v2 постепенно заменяет v1; модуль research —
источник данных для обоих.

---

## 4. Оценка организации `pipeline/` (28 записей в корне)

**Логично и правильно:** `agent/` (базовые контракты) и `agents/` (реализации) —
разделение корректное; `infrastructure/` (api-gateway, security-layer,
os-integration, circuit-breaker) — инфраструктура собрана; `director/` — мозг;
предметные движки по папкам (prediction/personalization/feedback-loop/nli/
reasoning-engine/autonomous-loop/coding-workflow/watchdog/gatekeeper/) — чисто.

**Шероховатости (P3):**

1. Однофайловые мини-папки: `audit/` (1 файл), `orders/`, `review/`,
   `guardrails/`, `meta-orchestrator/`, `context-manager/`, `controller/` —
   либо нарастить содержимое, либо перенести файлы в `infrastructure/`
   (audit) / `agents/` (orders, review) / `core/` (guardrails, meta-orchestrator,
   context-manager, controller — будущая папка «оркестрации»).
2. `cron-utils.ts` и `pipeline-scheduler.ts` рядом с координатором — ок, но
   можно собрать в `scheduling/`.
3. `benchmarks/` внутри pipeline — тестовая обвязка; допустимо.
4. Тестовые контуры разложены по трём местам: `modules/e2e-tests/`,
   `modules/integration-tests/`, `pipeline/*-integration.test.ts` — принять
   одно правило (unit — рядом с кодом, e2e/integration — в modules/).

---

## 5. Приоритетный план устранения

| Приоритет | Действие                                                                                                                                                                                                                                                                                                                                | Риск    | Статус               |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------------------- |
| **P1**    | Удалить `ai-advisor/news-fetcher.ts` (мёртвый дубликат; канон — `research/providers/news-fetcher.ts`)                                                                                                                                                                                                                                   | низкий  | ✅ 2026-10-10        |
| **P1**    | Один `DirectorActionAgents` (источник — `agents/agent-factory.ts`; facade импортирует type-only + реэкспорт)                                                                                                                                                                                                                            | низкий  | ✅ 2026-10-10        |
| **P1**    | Один токенизатор команд: [`agent/command-tokens.ts`](src/js/modules/pipeline/agent/command-tokens.ts) ← terminal-agent, action-input-builder, coding-workflow                                                                                                                                                                           | низкий  | ✅ 2026-10-10        |
| **P2**    | ~~Удалить старый `src/components/dashboard`~~ → ОТМЕНЕНО: это не дубликат — html-страница дашборда + серверный сборщик данных (index.html редиректит на неё, gulp обслуживает, [notification-agent.ts](src/js/modules/pipeline/agents/notification-agent.ts) импортирует `DashboardReportBuilder`). Границы задокументированы           | —       | ✅ переформулировано |
| **P2**    | Векторные токенизаторы rag/vector-store ↔ ai-memory/vector-search: слияние ОТМЕНЕНО — семантики разные (дедупликация+min3 для инвертированного индекса vs повторы+min2 для TF-IDF). Различие зафиксировано в JSDoc обоих файлов                                                                                                         | —       | ✅ задокументировано |
| **P2**    | Границы notifications (доменная логика) / os-integration (транспорт ОС) / notification-agent (фасад конвейера) — зафиксированы в JSDoc всех трёх                                                                                                                                                                                        | низкий  | ✅ 2026-10-10        |
| **P2**    | Зеркала сняты: `looksLikePath`/`resolveArgPath` экспортированы из terminal-agent, security-agent импортирует (единая логика распознавания путей)                                                                                                                                                                                        | низкий  | ✅ 2026-10-10        |
| **P3**    | Общий контракт OHLCV в data-fetcher: [contracts.ts](src/js/modules/data-fetcher/contracts.ts) (`HistoryInterval`/`OHLCVBar`/`HistoryResult`); finam-api и moex-api history-provider импортируют типы из контракта, локальные дубли удалены. Мини-папки pipeline → infrastructure/core — рекомендация остаётся (сознательно не делалось) | средний | ✅ 2026-10-10        |
| **P3**    | research-agent v2 ↔ v1: план замещения                                                                                                                                                                                                                                                                                                  | средний | —                    |
| **P3**    | Bootstrap автономной смены: [autonomous-session.ts](scripts/autonomous-session.ts) — `npm run autonomous` (--dry-run, --max-iterations, --max-minutes); GoalAgent + ActionAgents + Security + Director + FeedbackLoop + AutonomousLoop в одной связке. Smoke-тест dry-run: «0 из 0 активных целей», итог и статус выведены              | низкий  | ✅ 2026-10-10        |

После P1+P2+P3 и bootstrap: полный прогон 1110/1110 тестов в 64 файлах
(pipeline + rag + data-fetcher + moex-api + finam-api) зелёные, `tsc --noEmit`
чист.

---

## 6. Что уже хорошо

- Баррельная конвенция (`index.ts` в каждом модуле) соблюдена;
- DI-паттерн и честные ошибки выдержаны по всему коду;
- `infrastructure/` сгруппировал кросс-модульную инфраструктуру;
- Импортные связи направлены строго вниз (director → agents → agent),
  циклических зависимостей в pipeline не обнаружено;
- Тесты лежат рядом с кодом (unit) — 24 файла, 495 тестов зелёные.

---

## 7. Корень проекта (исследован полностью)

### Удалено — одноразовые артефакты прошлых сессий (нигде не упоминались)

| Файл                                         | Что это было                                                                                                                                                               |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fix-goal-agent.py`                          | одноразовая regex-заплатка для goal-agent.ts (правка уже внесена в код)                                                                                                    |
| `generate-env.cjs` + `generate-env2/3/4.cjs` | НЕ генераторы `.env`! Куски генератора кода [environment-agent.ts](src/js/modules/pipeline/agents/environment-agent.ts) (4 итерации за 1 минуту; сам агент уже существует) |
| `generate-kb.js`                             | обрезанная заготовка генератора (3 строки)                                                                                                                                 |

### Оставлено и проверено — всё на своём месте

| Группа               | Файлы                                                                                                                 | Назначение                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Конфиги инструментов | `.editorconfig`, `.prettierrc`, `.stylelintrc.json`, `.htmlhintrc`, `eslint.config.js`, `.npmrc`                      | стандарт                                                                         |
| Python-контур        | `requirements.txt`, `.python-version`, `src/python/`                                                                  | анализ аномалий на Python                                                        |
| Сборка/тесты         | `gulpfile.js` + `gulp/`, `tsconfig.json`, `vitest.config.ts`, `package.json` + lock                                   | стандарт                                                                         |
| Typings              | `declarations.d.ts`                                                                                                   | ambient-типы картинок/стилей/env (в tsconfig)                                    |
| Env                  | `.env.template`                                                                                                       | шаблон секретов (реальный `.env` в ignore)                                       |
| Торговый терминал    | `quik/` (3 файла .lua)                                                                                                | интеграция с QUIK                                                                |
| Данные               | `data/` (`.gitkeep`; runtime `.json/.db` в ignore)                                                                    | рантайм-хранилище                                                                |
| CI/хуки              | `.github/`, `.husky/`                                                                                                 | стандарт                                                                         |
| Документация         | `README.md`, `ARCHITECTURE.md`, `AI-AGENT-PLAN.md`, `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`, `STRUCTURE-AUDIT.md` | актуальны; ARCHITECTURE.md рекомендовано дополнить разделом про pipeline-агентов |

### Замечания по корню (P3)

1. Сгенерированные отчёты `report.html` / `report.md` / `report.pdf` — в
   `.gitignore`, но лежат в корне: рекомендация перенести в `reports/`;
2. Политика для корня: только точки входа и конфиги; утилиты — в `scripts/`;
3. Файл `nul` (зарезервированное имя Windows, упомянут в ignore) — при
   обнаружении удалить через `del \\?\c:\dev\finance-analyzer_2\nul`.
