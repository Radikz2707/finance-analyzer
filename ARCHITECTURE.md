# 🏗️ Архитектура Finance Analyzer

> Документ описывает **текущее** состояние системы (проверено по коду 06.10.2026),
> а не планы. Планы и статусы — в [`AI-AGENT-PLAN.md`](AI-AGENT-PLAN.md:1).
> Как вносить изменения — в [`CONTRIBUTING.md`](CONTRIBUTING.md:1).

## 1. Обзор

Finance Analyzer — система анализа инвестиционного портфеля российского
фондового рынка. Она:

1. **Читает данные портфеля** из отчётов QUIK (Excel-файл с листом «QUIK») и
   экспортированных терминалом данных (новости, заявки);
2. **Дополняет их внешними данными**: исторические котировки (MOEX ISS / Finam),
   ключевая ставка ЦБ, макроэкономика, новости, фундаментальные показатели эмитентов;
3. **Рассчитывает аналитику**: доли портфеля, дефициты, дивиденды/купоны,
   риск-лимиты, аномалии цен, оптимизацию и бэктесты;
4. **Генерирует AI-рекомендации** через мультиагентный конвейер с
   fallback-цепочкой провайдеров (Ollama → OpenRouter → GigaChat → YandexGPT);
5. **Доставляет результат**: HTML-дашборд, Markdown-отчёт, уведомления в
   Telegram, подготовку транзакций для ручного подтверждения в QUIK.

Вся логика написана на TypeScript (ESM), сборка — Gulp/Webpack, тесты — Vitest,
данные хранятся в SQLite (`better-sqlite3`) и файлах.

## 2. Высокоуровневая схема

```
                        ┌──────────────────────────────────────────────┐
                        │             Оркестрация (pipeline)            │
                        │  PipelineCoordinator · DirectorAgent         │
                        │  Watchdog · Gatekeeper · Guardrails · Audit  │
                        └──────────┬────────────────────────┬──────────┘
                                   │                        │
        ┌──────────────────────────▼─────┐    ┌─────────────▼──────────────┐
        │         Вход данных             │    │       Аналитика             │
        │  xlsx-parser (Excel QUIK)      │    │  portfolio-math            │
        │  quik-gateway (Lua → JSON)     │    │  portfolio-snapshot        │
        │  data-fetcher / moex-api       │    │  python-engine (аномалии)  │
        │  finam-api · rag · data-quality│    │  backtesting · optimizer   │
        └────────────────────────────────┘    └─────────────┬──────────────┘
                                   │                        │
                                   └───────────┬────────────┘
                                               ▼
                          ┌───────────────────────────────────────┐
                          │  Research (research/providers)        │
                          │  market · issuer · macro · news       │
                          │  registry + evidenceIds + fallback    │
                          └───────────────────┬───────────────────┘
                                               ▼
                          ┌───────────────────────────────────────┐
                          │  AI (ai-advisor)                      │
                          │  provider-router: Ollama → OpenRouter │
                          │  → GigaChat → YandexGPT (+ circuit    │
                          │  breaker) · ai-client · snapshot      │
                          └───────────────────┬───────────────────┘
                                               ▼
                          ┌───────────────────────────────────────┐
                          │  Доставка                             │
                          │  notifications · report-export        │
                          │  harness-integration (Telegram)       │
                          └───────────────────────────────────────┘
```

## 3. Слои и модули

Все модули лежат в `src/js/modules/` и экспортируются через свои `index.ts`
(barrel). Слои ниже упорядочены по направлению потока данных.

### 3.1 Вход данных

| Модуль                                                   | Назначение                                                                                                                                                                                                        | Ключевые файлы                                                                                                                                                               |
| :------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`xlsx-parser`](src/js/modules/xlsx-parser/index.ts:1)   | Парсинг Excel-файла: лист QUIK (позиции, цены, НКД, целевые доли), макроцели, история сделок, заявки QUIK (CSV)                                                                                                   | `xlsx-parser.ts`, `xlsx-parser-config.ts`, `quik-orders-parser.ts`                                                                                                           |
| [`data-fetcher`](src/js/modules/data-fetcher/index.ts:1) | Единый загрузчик истории: Finam API при наличии ключа, иначе MOEX ISS; общий SQLite-кэш                                                                                                                           | `index.ts` (`fetchHistoricalData`, `fetchHistoricalBatch`)                                                                                                                   |
| [`moex-api`](src/js/modules/moex-api/index.ts:1)         | Исторические котировки MOEX ISS (бесплатно, без регистрации), метрики цен                                                                                                                                         | `history-provider.ts`                                                                                                                                                        |
| [`finam-api`](src/js/modules/finam-api/index.ts:1)       | Исторические котировки Finam API                                                                                                                                                                                  | `history-provider.ts`                                                                                                                                                        |
| [`quik-gateway`](src/js/modules/quik-gateway/index.ts:1) | Канал с терминалом QUIK **только на чтение**: новости (`QuikNewsReader`), заявки (`QuikOrdersReader`), источник для Gatekeeper (`QuikNewsSource`), подготовка транзакций без автоотправки (`transaction-builder`) | `quik-gateway.ts`, `quik-news-reader.ts`, `quik-orders-reader.ts`, `transaction-builder.ts`; скрипты `quik/export_news.lua`, `quik/export_orders.lua`, `quik/send_order.lua` |
| [`data-quality`](src/js/modules/data-quality/index.ts:1) | Валидация входных данных                                                                                                                                                                                          | `validation.ts`                                                                                                                                                              |
| [`rag`](src/js/modules/rag/index.ts:1)                   | RAG-движок: загрузка документов, векторное хранилище, управление документами                                                                                                                                      | `document-loader.ts`, `vector-store.ts`, `rag-engine.ts`, `rag-document-manager.ts`                                                                                          |

### 3.2 Аналитика

| Модуль                                                                            | Назначение                                                                                                                                                 | Ключевые файлы                                                                                   |
| :-------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------- |
| [`portfolio-math`](src/js/modules/portfolio-math/portfolio-math.ts:1)             | Расчёт долей, дефицитов, статусов ребалансировки (BUY/HOLD/REDUCE…), приоритетов покупок, концентрации рисков; валидация лимитов                           | `portfolio-math.ts` (`PortfolioMathModule`), `portfolio-validator.ts`                            |
| [`backtesting`](src/js/modules/backtesting/index.ts:1)                            | Бэктестинг стратегий                                                                                                                                       | `backtesting.ts`                                                                                 |
| [`portfolio-optimizer`](src/js/modules/portfolio-optimizer/index.ts:1)            | Оптимизация портфеля                                                                                                                                       | `optimizer.ts`                                                                                   |
| [`portfolio-snapshot`](src/js/modules/portfolio-snapshot/portfolio-snapshot.ts:1) | Детерминированный снимок портфеля для передачи в AI: `parseAggregatedPortfolio()` → `buildPortfolioSnapshot()` → `PortfolioSnapshot`                       | `portfolio-snapshot.ts`                                                                          |
| [`python-engine`](src/js/modules/python-engine/index.ts:1)                        | TS↔Python мост (`PythonBridge`, retry), детектор статистических аномалий (`AnomalyDetector` + TS-fallback), резервные MOEX-котировки (`MoexQuoteProvider`) | `python-bridge.ts`, `anomaly-detector.ts`, `moex-quote-provider.ts`; движок `src/python/main.py` |

### 3.3 Research

| Модуль                                                                  | Назначение                                                                                                                                                                                                               | Ключевые файлы                                                                                                                                                                                                                    |
| :---------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`research`](src/js/modules/research/index.ts:1)                        | Слой фактов: типы (`ResearchValue`, `AssetResearchSnapshot`, `ResearchEvidence`), фабрики с provenance (`value()`, `noData()`, `hasValue()`), Investment Thesis Engine                                                   | `types.ts`, `helpers.ts`, `investment-thesis/investment-thesis-engine.ts`                                                                                                                                                         |
| [`research/providers`](src/js/modules/research/providers/registry.ts:1) | Провайдеры данных: market, issuer-fundamentals, macro, news; агрегатор `ResearchProviderRegistry` (merge `VALUE > NO_DATA`, union evidenceIds, conflict tracking); `withProviderFallback` для цепочек MOEX → CBR → Finam | `registry.ts`, `market-provider.ts`, `issuer-fundamentals-provider.ts`, `macro-provider.ts`, `news-provider.ts`, `provider-fallback.ts`, `types.ts`, тест-провайдеры `test-fundamentals-provider.ts`, `test-conflict-provider.ts` |

> **Принцип:** LLM не является источником фактов. Все факты приходят через
> providers с `evidenceIds`; LLM только интерпретирует `ResearchData`.

### 3.4 AI

| Модуль                                                                         | Назначение                                                                                                                                                                                                   | Ключевые файлы                                                                                                                                                                                                                                                         |
| :----------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`ai-advisor`](src/js/modules/ai-advisor/index.ts:1)                           | AI-клиент (`AiClient`), пост-обработка/валидация ответов, структурированные рекомендации, доходы (дивиденды/купоны), ставка ЦБ, новости, ценовые алерты, HTML/MD отчёты, кэш Ollama, fallback-отчёт без сети | `ai-client.ts`, `ai-validation.ts`, `structured-ai-recommendation.ts`, `income-calculator.ts`, `cbr-rate.ts`, `price-alerts.ts`, `report-builders.ts`, `report-templates.ts`, `ollama-manager.ts`, `ollama-stream.ts`, `ollama-cache.ts`, `fallback-report-builder.ts` |
| [`ai-advisor/provider-router`](src/js/modules/ai-advisor/provider-router.ts:1) | Fallback-цепочка **Ollama → OpenRouter → GigaChat → YandexGPT**; каждый провайдер защищён собственным `CircuitBreaker` (+ retry с backoff); открытая цепь одного провайдера не блокирует остальных           | `provider-router.ts` (`AiProviderRouter`)                                                                                                                                                                                                                              |

### 3.5 Оркестрация (`pipeline`)

Публичное API модуля — [`pipeline/index.ts`](src/js/modules/pipeline/index.ts:1):
`PipelineCoordinator`, `PipelineScheduler` + cron-утилиты, агенты, Director.

| Подсистема                                                                 | Назначение                                                                                                                                                                                                                                                                                                                  | Ключевые файлы                                                                                                                                                                                                                                                |
| :------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`PipelineCoordinator`](src/js/modules/pipeline/pipeline-coordinator.ts:1) | Оркестратор: 8 стадий `data → research ∥ analysis → ai → review → scenario → strategist → notification` (Research и Analysis параллельно), watchdog-мониторинг агентов, DI `memorySink` для авто-архивации KPI                                                                                                              | `pipeline-coordinator.ts`, `pipeline-scheduler.ts`                                                                                                                                                                                                            |
| Агенты конвейера                                                           | [`agents/index.ts`](src/js/modules/pipeline/agents/index.ts:1) — Data, Research, Analysis, AI, Notification, Strategist, Scenario, Consilium (`runConsilium`), File, Terminal, Security, History; базовый класс [`AgentBase`](src/js/modules/pipeline/agent/agent-base.ts:1) (состояние, таймаут, retry, graceful shutdown) | `agents/*.ts`, `agent/agent-base.ts`, `agent/types.ts`                                                                                                                                                                                                        |
| Review                                                                     | Внутренние ревизоры + контракт внешнего AI-судьи (`ExternalAiJudge`, объявлен в `review-agent.ts`; реализация фабрики пока не подключена)                                                                                                                                                                                   | `review/review-agent.ts`                                                                                                                                                                                                                                      |
| [`DirectorAgent`](src/js/modules/pipeline/director/director-types.ts:1)    | Главный интеллектуальный координатор: классификация вопросов (`nl-parser`), делегирование (`delegation-planner`), многораундовый Consilium (`multi-round-consilium`), память, аудит, чат (`director-chat-widget`), browser-режим (`browser-director`)                                                                       | `director/director.ts`, `director/delegation-planner.ts`, `director/multi-round-consilium.ts`, `director/director-memory.ts`, `director/director-audit.ts`, `director/nl-parser.ts`, `director/director-chat-widget.ts`, `director/director-chat-commands.ts` |
| [`ai-memory`](src/js/modules/pipeline/ai-memory/index.ts:1)                | Двухслойная память ИИ-агентов: оперативная + стратегическая (SQLite), фасад `memory-api`, авто-очистка, REST-интерфейс, TF-IDF векторный поиск, авто-архивация KPI (`kpi-sink`)                                                                                                                                             | `ai-memory/core.ts`, `ai-memory/memory-api.ts`, `ai-memory/memory-cleaner.ts`, `ai-memory/memory-rest-api.ts`, `ai-memory/vector-search.ts`, `ai-memory/kpi-sink.ts`                                                                                          |
| [`watchdog`](src/js/modules/pipeline/watchdog/index.ts:1)                  | Мониторинг здоровья конвейера и агентов (health-report, детекция зависаний)                                                                                                                                                                                                                                                 | `watchdog/watchdog.ts`                                                                                                                                                                                                                                        |
| [`gatekeeper`](src/js/modules/pipeline/gatekeeper/index.ts:1)              | Привратник источников: фильтрация/валидация новостей (RSS/MOEX/QUIK) и котировок до агентов                                                                                                                                                                                                                                 | `gatekeeper/gatekeeper.ts`, `rss-source.ts`, `moex-source.ts`                                                                                                                                                                                                 |
| Guardrails                                                                 | Финансовые правила: запрет SELL/REDUCE для `RECOVERY_ONLY` и т.п.                                                                                                                                                                                                                                                           | `guardrails/guardrails.ts`                                                                                                                                                                                                                                    |
| Audit                                                                      | Аудит-трейл действий                                                                                                                                                                                                                                                                                                        | `audit/audit-log.ts`                                                                                                                                                                                                                                          |
| Infrastructure                                                             | `CircuitBreaker`, `withRetry`, `withFallback` (используются роутером ИИ и data-цепочками)                                                                                                                                                                                                                                   | `infrastructure/circuit-breaker.ts`                                                                                                                                                                                                                           |
| Сопутствующее                                                              | Controller, Environment Controller, Browser Gateway, интерактивные ордера, бенчмарки, e2e-тесты                                                                                                                                                                                                                             | `controller/agent-controller.ts`, `environment-controller/`, `browser-gateway/`, `orders/interactive-orders.ts`, `benchmarks/`, `e2e-tests/pipeline-e2e.test.ts`                                                                                              |

### 3.6 Доставка

| Модуль                                                                 | Назначение                                                                                                                                                                                                                                                                                                                                           | Ключевые файлы                                                                                                                                                                                                                           |
| :--------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`notifications`](src/js/modules/notifications/index.ts:1)             | Уведомления (основной модуль)                                                                                                                                                                                                                                                                                                                        | `notifications.ts`                                                                                                                                                                                                                       |
| [`harness-integration`](src/js/modules/harness-integration/index.ts:1) | UI-интеграция гибридного диспетчера: `HarnessBridge` (агрегатор статуса/аномалий/новостей QUIK), `TelegramNotifier` + реальный `TelegramHttpSender` (POST api.telegram.org, no-op без токена), `PriceAlertNotifier`, `formatDashboardHtml`, `mountDashboardBlock`, живой источник аномалий (`anomaly-source`), Node-only фабрика `harness-bootstrap` | `harness-bridge.ts`, `telegram-notifier.ts`, `telegram-http-sender.ts`, `price-alert-notifier.ts`, `format-dashboard-html.ts`, `mount-dashboard-block.ts`, `anomaly-source.ts`, `harness-bootstrap.ts`; entry `scripts/harness-start.ts` |
| [`report-export`](src/js/modules/report-export/index.ts:1)             | Экспорт отчётов                                                                                                                                                                                                                                                                                                                                      | `export.ts`                                                                                                                                                                                                                              |
| [`dashboard`](src/js/modules/dashboard/index.ts:1)                     | Рендер виджетов дашборда (Chart.js)                                                                                                                                                                                                                                                                                                                  | `dashboard.ts`                                                                                                                                                                                                                           |

### 3.7 Память и хранение

| Модуль                                                   | Назначение                                                                                                                                                       | Ключевые файлы                                       |
| :------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------- |
| [`memory-layer`](src/js/modules/memory-layer/index.ts:1) | Слой памяти с TTL для промежуточных данных                                                                                                                       | `memory-layer.ts`, `types.ts`                        |
| [`db-manager`](src/js/modules/db-manager/index.ts:1)     | SQLite-хранилище (`better-sqlite3`): кэш research, история; браузерная версия                                                                                    | `db-manager.ts`, `db-manager.browser.ts`, `types.ts` |
| [`logger`](src/js/modules/logger/index.ts:1)             | Единый логгер: уровни (`LOG_LEVEL`), консольный бэкенд, файловая запись с ротацией (`LOG_TO_FILE` → `data/logs/app.log`), браузерный режим без Node-зависимостей | `logger.ts`, `file-backend.ts`, `types.ts`           |

### 3.8 Прочее

| Модуль                                                               | Назначение                                                                                                            |
| :------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------- |
| [`adaptive-scheduler`](src/js/modules/adaptive-scheduler/index.ts:1) | Гибридный диспетчер нагрузки: запуск pipeline по интервалу, переключение active/sleeping/manual                       |
| [`resource-monitor`](src/js/modules/resource-monitor/index.ts:1)     | Мониторинг CPU/RAM (`ResourceMonitor`)                                                                                |
| [`telegram-bot`](src/js/modules/telegram-bot/)                       | Telegram-бот управления; локальные файлы исключены из репозитория и из `tsc` (см. [`tsconfig.json`](tsconfig.json:1)) |

## 4. Поток данных

Основной сценарий — запуск конвейера (`npm run pipeline`):

```
Excel/QUIK ──► xlsx-parser ──► DataAgent (позиции, цены, НКД, цели, заявки)
                                    │
                                    ├──► Gatekeeper (фильтр новостей RSS/MOEX/QUIK)
                                    │
                                    ▼
                  ┌────── ResearchAgent ──┐        (параллельно)
                  │  providers/registry    │
                  │  → AssetResearchSnapshot│
                  └───────────┬────────────┘
                              │
                  ┌────── AnalysisAgent ──┐
                  │  portfolio-math       │
                  │  python-engine (аном.)│
                  └───────────┬────────────┘
                              ▼
                    AiAgent (ai-advisor)
                    portfolio-snapshot → контекст
                    provider-router: Ollama → OpenRouter → GigaChat → YandexGPT
                    structured-ai-recommendation
                              │
                              ▼
                    ReviewAgent (ревизоры + внешний AI-судья)
                              │
                              ▼
                    ScenarioAgent → StrategistAgent → Consilium (runConsilium)
                              │
                              ▼
                    NotificationAgent
                    report.html / report.md (report-export, harness-integration)
                    Telegram (TelegramNotifier / TelegramHttpSender)
                    интерактивные ордера (orders/interactive-orders)
                              │
                              ▼
              ai-memory (memorySink: KPI-snapshot) + audit + watchdog
```

Ключевые точки соединения:

- **DataAgent** — [`data-agent.ts`](src/js/modules/pipeline/agents/data-agent.ts:1):
  Excel остаётся основным источником котировок, `MoexQuoteProvider`/Finam
  дополняют только отсутствующие тикеры; ошибка резерва не прерывает конвейер.
- **ResearchAgent** — [`research-agent.ts`](src/js/modules/pipeline/agents/research-agent.ts:1):
  параллельное исследование активов через `ResearchProviderRegistry`.
- **AiAgent** — [`ai-agent.ts`](src/js/modules/pipeline/agents/ai-agent.ts:1):
  строит контекст из `PortfolioSnapshot` + `ResearchData`, вызывает `AiClient`.
- **ReviewAgent** — [`review-agent.ts`](src/js/modules/pipeline/review/review-agent.ts:1):
  внутренние ревизоры; вердикт внешнего судьи совещательный (не блокирует success).
- **Consilium** — [`consilium.ts`](src/js/modules/pipeline/agents/consilium.ts:1):
  голосование агентов по активам; в Director — многораундовый
  ([`multi-round-consilium.ts`](src/js/modules/pipeline/director/multi-round-consilium.ts:53)).

## 5. Оркестрация

### 5.1 PipelineCoordinator

[`PipelineCoordinator`](src/js/modules/pipeline/pipeline-coordinator.ts:148) —
основной оркестратор. Стадии: `data → research ∥ analysis → ai → review →
scenario → strategist → notification`. Особенности:

- Research и Analysis выполняются параллельно; AI ждёт оба результата;
- каждый агент автономен: собственные `timeoutMs`, `retries`, `retryDelayMs`;
- каждый `run()` стартует `Watchdog` (`registerAgent` / `setAgentTask` /
  `checkAgent`); отчёт о здоровье попадает в `PipelineResult.watchdogHealth`;
- после успешного `run()` вызывается DI-колбэк `memorySink` (авто-архивация KPI
  в [`ai-memory/kpi-sink.ts`](src/js/modules/pipeline/ai-memory/kpi-sink.ts:1));
- результат — [`PipelineResult`](src/js/modules/pipeline/pipeline-coordinator.ts:58):
  `stages`, `reviewResult`, `scenarioResult`, `strategistResult`,
  `consiliumResult`, `interactiveOrders`, `agentSummaries`, `watchdogHealth`.

### 5.2 DirectorAgent

[`DirectorAgent`](src/js/modules/pipeline/director/director.ts:85) — главный
координатор для интерактивных сценариев (чат, делегирование, консилиум):

- категоризация и NL-парсинг вопросов — [`nl-parser.ts`](src/js/modules/pipeline/director/nl-parser.ts:1);
- планирование делегирования по ролям `AgentRole` (`ai`, `research`,
  `strategist`, `scenario`, `review`, `analysis`, `file`, `terminal`) —
  [`delegation-planner.ts`](src/js/modules/pipeline/director/delegation-planner.ts:24);
- многораундовый консилиум — [`multi-round-consilium.ts`](src/js/modules/pipeline/director/multi-round-consilium.ts:53);
- память и аудит — `director-memory.ts`, `director-audit.ts`;
- чат-команды `/status`, `/log`, `/undo`, подтверждение опасных действий —
  [`director-chat-commands.ts`](src/js/modules/pipeline/director/director-chat-commands.ts:1),
  виджет — `director-chat-widget.ts`.

### 5.3 Агенты управления (File/Terminal/Security/History)

- **FileAgent** — [`file-agent.ts`](src/js/modules/pipeline/agents/file-agent.ts:1):
  чтение (текст/JSON/YAML), запись, удаление с защитой путей (`isInside`),
  перемещение, листинг, glob-поиск.
- **TerminalAgent** — [`terminal-agent.ts`](src/js/modules/pipeline/agents/terminal-agent.ts:1):
  whitelist команд (read/npm/git), blacklist опасных паттернов, таймауты,
  ограничение вывода, журнал команд.
- **SecurityAgent** — [`security-agent.ts`](src/js/modules/pipeline/agents/security-agent.ts:1):
  предварительная валидация операций file/terminal/http/process, вердикты
  allow/deny/require-confirmation, http-whitelist (https + MOEX/CBR/Finam).
- **HistoryAgent** — [`history-agent.ts`](src/js/modules/pipeline/agents/history-agent.ts:1):
  хранилище истории действий (`record`/`find`/`trace`/`chain`), экспорт JSON/MD
  с защитой пути.

## 6. Конфигурация

### 6.1 Переменные окружения (.env)

Схема и валидация — [`env-validation.ts`](src/js/config/env-validation.ts:40)
(`ENV_SCHEMA`, `validateEnv()`, `assertEnvValid()`), шаблон —
[`.env.template`](.env.template:1). Обязательный ключ — `EXCEL_FILE_PATH`;
остальное опционально (fallback-режимы, warning вместо error).

| Группа        | Ключи                                                                                                                                                                       |
| :------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Пути к данным | `EXCEL_FILE_PATH`, `QUIK_NEWS_DIR`, `QUIK_ORDERS_DIR`                                                                                                                       |
| Telegram      | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_ADMIN_IDS`                                                                                                              |
| ИИ-модели     | `AI_MODEL_ID` (ollama/gigachat/gpt-4o-mini/yandexgpt), `OPENROUTER_API_KEY`, `GIGACHAT_API_KEY`, `YANDEXGPT_API_KEY`, `PROXYAPI_KEY`, `OLLAMA_BASE_URL`, `AI_CACHE_ENABLED` |
| Данные        | `FINAM_API_KEY`, `CBK_RATE_OVERRIDE`                                                                                                                                        |
| Логирование   | `LOG_LEVEL`, `LOG_TO_FILE`                                                                                                                                                  |

### 6.2 PortfolioConfig

Единый объект числовых порогов и маппингов —
[`portfolio-config.ts`](src/js/config/portfolio-config.ts:9) (`PortfolioConfig`):
пороги ребалансировки (`buyDeviationPct`, `reduceDeviationPct`,
`concentrationLimitPct`, `singleAssetLimitPct`), параметры авто-таргетов,
налоговая ставка, пороги макроусловий, маппинг счетов IIS/BROKER, модель
YandexGPT. Вынесен отдельно для разрыва циклической зависимости
`ai-advisor → portfolio-math → xlsx-parser → ai-advisor`.

Барrel-экспорт конфигов — [`config/index.ts`](src/js/config/index.ts:1).

## 7. Запуск

Скрипты определены в [`package.json`](package.json:12) (Windows: запускать из
**cmd.exe**).

| Команда                                           | Что делает                                                                                   |
| :------------------------------------------------ | :------------------------------------------------------------------------------------------- |
| `npm run dev`                                     | Dev-сервер Gulp (frontend watch)                                                             |
| `npm run build`                                   | `npm run test:run` + `gulp build` (production-сборка)                                        |
| `npm run test` / `npm run test:run`               | Vitest: watch / однократный прогон                                                           |
| `npm run lint`                                    | Gulp lint (ESLint + Stylelint) + `tsc --noEmit`                                              |
| `npm run pipeline`                                | Однократный запуск мультиагентного конвейера                                                 |
| `npm run pipeline:schedule`                       | Запуск конвейера с cron-расписанием (корневой `pipeline.ts`)                                 |
| `npm run harness`                                 | Node-entry `scripts/harness-start.ts`: диспетчер + QUIK + Telegram-алерты                    |
| `npm run bench`                                   | Бенчмарки: `src/js/modules/pipeline/benchmarks/run.ts` (timing, portfolio-math, xlsx-memory) |
| `npm run audit` / `npm run blueprint`             | Аудит кода и генерация дерева файлов в `.audit/`                                             |
| `npm run cache:clear-ai`                          | Очистка кэша AI                                                                              |
| `npm run module` / `create` / `plugin` / `remove` | Gulp-скаффолдинг модулей/компонентов                                                         |

Точки входа Node: `scripts/harness-start.ts`, корневой `pipeline.ts`
(для `pipeline:schedule`), `scripts/clear-ai-cache.ts`. Точка входа фронтенда —
`src/js/app.ts` (браузерный бандл).

## 8. Диаграмма зависимостей главных модулей

```
                 ┌──────────────┐
                 │  config/     │  env-validation · portfolio-config
                 └──────┬───────┘
                        │
   ┌────────────────────┼─────────────────────┐
   │                    │                     │
   ▼                    ▼                     ▼
 xlsx-parser      data-fetcher           quik-gateway
   │               │  ▲      │                │
   │               │  │      └──► finam-api   │
   │               │  └──► moex-api           │
   │               ▼                         ▼
   │        db-manager (SQLite-кэш)     gatekeeper (новости →)
   │                                        │
   ▼                                        ▼
 portfolio-snapshot ◄── portfolio-math   research/ (providers)
   │                       │                │ registry
   │                       │                ▼
   │                       │         investment-thesis
   │                       │                │
   ▼                       ▼                ▼
 ┌───────────────────────────────────────────────────┐
 │  pipeline: PipelineCoordinator                    │
 │    data → research ∥ analysis → ai → review →     │
 │    scenario → strategist → notification           │
 │  AgentBase (Data/Research/Analysis/AI/.../File/   │
 │    Terminal/Security/History) · Consilium         │
 │  DirectorAgent · watchdog · guardrails · audit    │
 │  ai-memory (SQLite)                               │
 └───────┬───────────────────────────────┬───────────┘
         │                               │
         ▼                               ▼
   ai-advisor (ai-client,           harness-integration
   provider-router + circuit          (TelegramNotifier/
   breaker, ollama-*)                 TelegramHttpSender,
   ▲                                  formatDashboardHtml)
   │
   └── research evidenceIds + portfolio-snapshot ─┘
         │
         ▼
   notifications · report-export → report.html / report.md
   logger (все модули) · memory-layer (TTL-память)
```

## 9. Связанная документация

- [`README.md`](README.md:1) — возможности, быстрый старт, команды;
- [`CONTRIBUTING.md`](CONTRIBUTING.md:1) — как добавить модуль/агента/провайдера;
- [`AI-AGENT-PLAN.md`](AI-AGENT-PLAN.md:1) — мастер-план развития и статусы;
- [`AI-AGENT-PLAN.md`](AI-AGENT-PLAN.md:153) — раздел 3.1: бенчмарки.
