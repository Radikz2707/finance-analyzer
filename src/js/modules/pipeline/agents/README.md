# 🤖 Агенты конвейера (pipeline agents)

Каталог-документ по агентам мультиагентного конвейера. Это **единый README вместо 18 отдельных файлов** — проще поддерживать: все входы/выходы/действия и ограничения безопасности собраны в одном месте.

## Введение

Агент — автономная единица конвейера, которая принимает входные данные, выполняет задачу и возвращает результат:

- **Базовый класс** — [`AgentBase`](../agent/agent-base.ts:21): управление состоянием (`idle/running/paused/error/stopped`), таймер выполнения, retry с exponential backoff, логирование, graceful shutdown. Подклассы реализуют только `executeInternal()`.
- **Контракт результата** — [`AgentResult<T>`](../agent/types.ts:21): `success`, `data`, `error`, `durationMs`, `completedAt`.
- **Интерфейс агента** — [`IAgent<Input, Output>`](../agent/types.ts:65): `name`, `state`, `execute(input)`, `stop()`, `getSummary()`.
- **Единый контракт action-агентов** — [`AgentActionInput` / `AgentActionResult`](../agent/agent-contract.ts:25): вход вида `{ action, ...params }`, результат вида `{ action, success, message, data? }`. Его используют все «агенты управления компьютером» (File/Terminal/Security/Package/Browser/Config/Process/Scheduler/Learning/AutoRepair).
- **Barrel-экспорты** — [`index.ts`](index.ts:1): все классы агентов и их типы.

Два семейства агентов:

1. **Аналитические** — читают данные (Excel/QUIK/API), считают, генерируют рекомендации и отчёты. Побочных эффектов на системе почти не имеют (кроме записи `report.html`/`report.md` у NotificationAgent).
2. **Управления компьютером** — выполняют действия с файловой системой, терминалом, процессами, конфигами, сетью. Именно для них критичны слои защиты ([SecurityAgent](security-agent.ts:1), whitelist TerminalAgent, корни FileAgent).

## 📋 Таблица всех агентов

| Агент                                           | Роль (AgentRole)         | Вход (кратко)                                                                             | Выход (кратко)                                                                                               | Безопасность / ограничения                                                                           |
| :---------------------------------------------- | :----------------------- | :---------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------- |
| [`DataAgent`](data-agent.ts:115)                | — (источник данных)      | — (нет входных данных; читает Excel/QUIK)                                                 | [`DataAgentOutput`](data-agent.ts:69): позиции, котировки, счета, заявки, новости, аномалии, ключевая ставка | Только чтение локальных файлов; новости — через Gatekeeper; котировки — через доверенные API         |
| [`ResearchAgent`](research-agent.ts:87)         | `research`               | [`DataAgentOutput`](data-agent.ts:69) (assets/quotes/macroGoals)                          | [`ResearchAgentOutput`](research-agent.ts:47): снимки по активам, конфликты провайдеров                      | Чтение внешних API через registry провайдеров; конфликты данных фиксируются, не выдумываются         |
| [`AnalysisAgent`](analysis-agent.ts:92)         | `analysis`               | [`DataAgentOutput`](data-agent.ts:69)                                                     | [`AnalysisAgentOutput`](analysis-agent.ts:62): анализ долей, риски, доходы, ценовые алерты                   | Синхронные вычисления без I/O                                                                        |
| [`AiAgent`](ai-agent.ts:93)                     | `ai`                     | Data + Research + Analysis (+ память ИИ)                                                  | [`AiAgentOutput`](ai-agent.ts:65): тезисы, narrative, структурированные рекомендации                         | AI-текст санитизируется и валидируется; контекст guardrails                                          |
| [`NotificationAgent`](notification-agent.ts:60) | — (финализация)          | data/analysis/ai (+review/scenario/strategist/consilium)                                  | [`NotificationAgentOutput`](notification-agent.ts:28): `report.html`, `report.md`, interactive orders        | Записывает только отчёты в cwd; открытие браузера; Telegram опционален                               |
| [`StrategistAgent`](strategist-agent.ts:86)     | `strategist`             | [`StrategistAgentInput`](strategist-agent.ts:34) (анализ + предложения AI)                | [`StrategistAgentOutput`](strategist-agent.ts:58): решения и примечания                                      | Синхронно, без I/O/LLM; НЕ блокирует решения AI (нет veto)                                           |
| [`ScenarioAgent`](scenario-agent.ts:97)         | `scenario`               | [`ScenarioAgentInput`](scenario-agent.ts:37) (анализ, бюджет, предложения)                | [`ScenarioAgentOutput`](scenario-agent.ts:69): сценарии S1–S4, лучший вариант                                | Детерминированная модель без LLM                                                                     |
| [`Consilium`](consilium.ts:1)                   | — (совещание)            | [`ConsiliumInput`](consilium.ts:58) (предложения, стратег, сценарии, новости)             | [`ConsiliumOutput`](consilium.ts:72): решения с согласием UNANIMOUS/MAJORITY/CONFLICT                        | Голосование без единоличного veto                                                                    |
| [`FileAgent`](file-agent.ts:110)                | `file`                   | [`FileAgentInput`](file-agent.ts:46): `{ action, path, ... }`                             | [`FileAgentOutput`](file-agent.ts:75): содержимое/записи/найденные файлы                                     | Пути только внутри корней; deny-список `.git`/`node_modules`; запрет удаления корня                  |
| [`TerminalAgent`](terminal-agent.ts:210)        | `terminal`               | [`TerminalAgentInput`](terminal-agent.ts:31): `{ command, args?, timeoutMs? }`            | [`TerminalAgentOutput`](terminal-agent.ts:41): stdout/stderr/exitCode                                        | Whitelist команд + blacklist паттернов; spawn без shell; таймаут 60s; вывод ≤ 256 КБ                 |
| [`SecurityAgent`](security-agent.ts:145)        | — (контролёр)            | [`SecurityActionRequest`](security-agent.ts:52): `{ kind, command?/path?/url? }`          | [`SecurityDecision`](security-agent.ts:76): `allow` / `deny` / `require-confirmation`                        | Вердикты для file/terminal/http/process; https + whitelist хостов; процессы — всегда подтверждение   |
| [`HistoryAgent`](history-agent.ts:1)            | — (аудит)                | события `record()` / запрос `find()`                                                      | [`HistoryTrace`](history-agent.ts:105), статистика, экспорт JSON/MD                                          | Экспорт только внутри корней; maxEntries 1000                                                        |
| [`PackageAgent`](package-agent.ts:1)            | — (обёртка над Terminal) | [`PackageAgentInput`](package-agent.ts:53): `{ action, packages?, manager?, dryRun? }`    | [`PackageAgentOutput`](package-agent.ts:88): план/выполненные команды, конфликты                             | Команды только через TerminalAgent; манифесты только в корне; `dryRun: true` по умолчанию            |
| [`BrowserAgent`](browser-agent.ts:1)            | — (веб-мониторинг)       | [`BrowserAgentInput`](browser-agent.ts:73): `{ action, query?, url?, tickers? }`          | [`BrowserAgentOutput`](browser-agent.ts:96): результаты с меткой источника                                   | Только https + whitelist доменов; лимит контента 200 КБ; честный «нет данных»                        |
| [`ConfigAgent`](config-agent.ts:139)            | — (конфиги)              | [`ConfigAgentInput`](config-agent.ts:62): `{ action, path?, data?, dryRun? }`             | [`ConfigAgentOutput`](config-agent.ts:88): итоговое значение, backupPath                                     | Атомарная запись (temp+rename); `import` создаёт `.bak`; запись запрещена в корень/.git/node_modules |
| [`ProcessAgent`](process-agent.ts:1)            | — (процессы)             | [`ProcessAgentInput`](process-agent.ts:57): `{ action, command?, args?, restartOnExit? }` | [`ProcessAgentOutput`](process-agent.ts:104): статусы управляемых процессов                                  | spawn без shell; whitelist терминала + python/gulp; SIGTERM→SIGKILL; автоперезапуск с backoff        |
| [`SchedulerAgent`](scheduler-agent.ts:1)        | — (планировщик)          | [`SchedulerAgentInput`](scheduler-agent.ts:71): `{ action, jobId?, cron?, task? }`        | [`SchedulerAgentOutput`](scheduler-agent.ts:128): job'ы и статусы                                            | Планирование без прямого доступа к системе; pipeline/Telegram — через DI-колбэки                     |
| [`LearningAgent`](learning-agent.ts:1)          | — (обучение)             | [`FeedbackEntry`](learning-agent.ts:89) / история событий                                 | [`Lesson`](learning-agent.ts:67), метрики, прогноз, отчёт                                                    | Анализ без ML (эвристика, честно помечена); падение источника — warning, не выдумка                  |
| [`AutoRepairAgent`](auto-repair-agent.ts:1)     | — (диагностика/ремонт)   | [`AutoRepairInput`](auto-repair-agent.ts:111): `{ action, scope?, autoFix? }`             | [`AutoRepairOutput`](auto-repair-agent.ts:119): проверки, overall, applied/blockedFixes                      | `autoFix: false` по умолчанию; исправления только через DI-терминал; пути внутри корней              |

> Примечание: `AgentRole` (`ai/research/strategist/scenario/review/analysis/file/terminal`) — роли делегирования Director (см. [`director-types.ts`](../director/director-types.ts:69)). Для агентов без роли роль в таблице — «—»: они либо вспомогательные (Security/History), либо обёртки (Package/Process), либо финализирующие (Notification). Рецензент [`ReviewAgent`](../review/review-agent.ts:1) живёт отдельно от каталога `agents/`.

---

## 📊 Аналитические агенты

### 1. DataAgent — данные портфеля

- **Файл:** [`data-agent.ts`](data-agent.ts:1), класс [`DataAgent`](data-agent.ts:115).
- **Назначение:** извлечение и агрегация всех исходных данных: лист QUIK (позиции, цены, НКД, целевые доли), счета (`Портфель_XXXXX`), котировки (лист «Акции»), заявки QUIK (CSV), исторические сделки, вложенные средства, макро-цели.
- **Ключевые шаги `executeInternal()`:** `syncNewTrades()` → `parseAggregatedPortfolio()` → счета → котировки → заявки → сделки → вложенные средства → новости (Gatekeeper) → аномалии (Python Engine) → ключевая ставка ЦБ.
- **Откуда данные:** парсер [`xlsx-parser`](../../xlsx-parser/index.ts:1) (Excel/CSV), [`gatekeeper`](../gatekeeper/gatekeeper.ts:1) (новости QUIK/MOEX/RSS), [`python-engine`](../../python-engine/index.ts:1) (аномалии цен), [`cbr-rate.ts`](../../ai-advisor/cbr-rate.ts:1) (ключевая ставка).
- **Выход:** [`DataAgentOutput`](data-agent.ts:69) — передаётся в Research и Analysis.

### 2. ResearchAgent — исследование активов

- **Файл:** [`research-agent.ts`](research-agent.ts:1), класс [`ResearchAgent`](research-agent.ts:87).
- **Назначение:** параллельное исследование всех активов портфеля через реестр провайдеров.
- **Ключевые методы:** построение `ResearchContext` из `DataAgentOutput`, запуск `Promise.all` по активам, агрегация снимков и конфликтов значений.
- **Откуда данные:** 4 провайдера из [`research/providers/registry.ts`](../../research/providers/registry.ts:1): рыночные котировки, фундаментал эмитента, новости, макро-показатели.
- **Выход:** [`ResearchAgentOutput`](research-agent.ts:47) — `Map<ticker, AssetResearchResult>` + конфликты. Передаётся в AI Agent.

### 3. AnalysisAgent — математика портфеля

- **Файл:** [`analysis-agent.ts`](analysis-agent.ts:1), класс [`AnalysisAgent`](analysis-agent.ts:92).
- **Назначение:** детерминированный математический анализ: отклонение долей от целевых, приоритеты покупок по дефициту, концентрация рисков, валидация лимитов, доходы (дивиденды/купоны), ценовые алерты.
- **Ключевые модули:** [`PortfolioMathModule`](../../portfolio-math/portfolio-math.ts:1), [`PortfolioValidator`](../../portfolio-math/portfolio-validator.ts:1), [`IncomeCalculator`](../../ai-advisor/income-calculator.ts:1), [`PriceAlertsModule`](../../ai-advisor/price-alerts.ts:1).
- **Выход:** [`AnalysisAgentOutput`](analysis-agent.ts:62). Все вычисления синхронные, без I/O.

### 4. AiAgent — AI-рекомендации

- **Файл:** [`ai-agent.ts`](ai-agent.ts:1), класс [`AiAgent`](ai-agent.ts:93).
- **Назначение:** генерация инвестиционных тезисов по каждому активу, AI-нарратив через `AiClient`, структурированные рекомендации.
- **Ключевые шаги:** `loadMemoryContext()` (память ИИ: оперативные/стратегические записи, KPI-снимки) → InvestmentThesis по каждому активу → вызов AI → пост-обработка (санитизация, валидация JSON) → построение структурированных рекомендаций.
- **Откуда данные:** [`DataAgentOutput`](data-agent.ts:69), [`ResearchAgentOutput`](research-agent.ts:47), [`AnalysisAgentOutput`](analysis-agent.ts:62), память [`ai-memory`](../ai-memory/index.ts:1), контекст [`guardrails`](../guardrails/guardrails.ts:1).
- **Выход:** [`AiAgentOutput`](ai-agent.ts:65). AI-запрос асинхронный, не блокирует поток.

### 5. NotificationAgent — отчёты

- **Файл:** [`notification-agent.ts`](notification-agent.ts:1), класс [`NotificationAgent`](notification-agent.ts:60).
- **Назначение:** сборка финального отчёта после всех upstream-агентов: HTML-дашборд + Markdown-отчёт, запись файлов, открытие в браузере, (опционально) Telegram, интерактивные ордера для UI/Telegram.
- **Ключевые методы:** `buildHtmlReport()` (через [`DashboardReportBuilder`](../../../../components/dashboard/dashboard.ts:1)), `buildMarkdownReport()` (шаблоны [`report-templates.ts`](../../ai-advisor/report-templates.ts:1)), `buildInteractiveOrders()` ([`interactive-orders.ts`](../orders/interactive-orders.ts:1)).
- **Выход:** [`NotificationAgentOutput`](notification-agent.ts:28) — пути и содержимое `report.html`/`report.md`.

### 6. StrategistAgent — стратегия и риски

- **Файл:** [`strategist-agent.ts`](strategist-agent.ts:1), класс [`StrategistAgent`](strategist-agent.ts:86).
- **Назначение:** независимая аналитическая оценка: структура портфеля, концентрация, просадки, P&L, устойчивость. Предлагает альтернативное действие, но **не имеет права блокировать решение AI** (нет veto).
- **Ключевые методы:** расчёт `drawdownPercent`, `concentrationPercent`, формирование `StrategistDecision` с итоговым действием, совпадающим с AI.
- **Выход:** [`StrategistAgentOutput`](strategist-agent.ts:58). Все вычисления синхронные (без I/O и LLM) — агент не может зависнуть.

### 7. ScenarioAgent — «что если»

- **Файл:** [`scenario-agent.ts`](scenario-agent.ts:1), класс [`ScenarioAgent`](scenario-agent.ts:97).
- **Назначение:** строит модели будущего портфеля: S1 удержание (baseline), S2 предложение AI, S3 оптимизированный (избегает фиксации глубоких убытков), S4 гибкий (комбинация). Оценивает каждую по структуре и P&L.
- **Ключевые методы:** `calcStructureDeviation()`, `sumUnrealizedPnL()`, выбор `bestScenarioId`.
- **Выход:** [`ScenarioAgentOutput`](scenario-agent.ts:69) с вердиктами `IMPROVES/WORSENS/NEUTRAL`, которые идут голосом в Consilium.

### 8. Consilium — совещание агентов

- **Файл:** [`consilium.ts`](consilium.ts:1) — **не агент** (`AgentBase` не наследует), а функция `runConsilium`.
- **Назначение:** голосование по каждому значимому действию: `ai` (LLM-предложение), `strategist` (аналитика), `scenario` (лучший сценарий), `research` (новостной фон).
- **Принципы:** у каждого есть голос, но ни у кого нет безусловного veto; при конфликте — `CONFLICT`, а не принудительный HOLD.
- **Выход:** [`ConsiliumOutput`](consilium.ts:72) — решения с `agreement: UNANIMOUS | MAJORITY | CONFLICT`, голоса и примечания.

---

## 🖥️ Агенты управления компьютером

### 9. FileAgent — файловые операции

- **Файл:** [`file-agent.ts`](file-agent.ts:1), класс [`FileAgent`](file-agent.ts:110).
- **Действия (`action`):** `read` · `readJson` · `readYaml` · `write` · `delete` · `rename` · `list` · `search` (подстрока или glob `*`/`?`/`**`).
- **Пример входа:** `{ action: 'write', path: 'data/config.json', content: '{}' }`; `{ action: 'search', path: '.', pattern: '*.ts', recursive: true }`.
- **Пример выхода:** `{ action: 'write', path: '.../data/config.json', success: true, message: 'OK' }`; для `read` — поле `content`; для `list` — `entries[]`.
- **Ограничения безопасности:**
  - работа **только внутри разрешённых корней** (`roots`, по умолчанию `process.cwd()`);
  - выход за корень через `../` или абсолютные пути блокируется (`resolveSafe` + `isInside`);
  - запрещено удаление самого корня и путей из deny-списка `.git`/`node_modules` (`deleteDenyList`).

### 10. TerminalAgent — безопасный терминал

- **Файл:** [`terminal-agent.ts`](terminal-agent.ts:1), класс [`TerminalAgent`](terminal-agent.ts:210).
- **Назначение:** выполнение команд в пределах корня проекта; формирует журнал `TerminalLogEntry[]` (до 100 записей, превью 500 символов).
- **Вход:** [`TerminalAgentInput`](terminal-agent.ts:31): `{ command, args?: string[], timeoutMs? }`.
- **Выход:** [`TerminalAgentOutput`](terminal-agent.ts:41): `stdout`, `stderr`, `exitCode`, `durationMs`, `truncated`.
- **Ограничения безопасности:**
  - **whitelist команд** (`TERMINAL_ALLOWED_COMMANDS`): `ls, dir, cat, type, grep, findstr, find, head, tail, wc, pwd, echo, npm, npx, node, git`; git — только подкоманды `commit/push/branch/status/log`; npm — подстроки `install/update/run/build`;
  - **blacklist паттернов** (`TERMINAL_DENY_PATTERNS`): `rm -rf`, `sudo`, `del`, `format`, `mkfs`, `mkswap`, `fdisk`, `dd of=`, `shutdown/reboot/halt/poweroff`, `rmdir /`, `reg delete/add`, `taskkill/kill -9/pkill -9`, редиректы в системные пути;
  - **запрет символов инъекций** (`TERMINAL_INJECTION_CHARS`): `; | & \` $() ${ %0a %0d \r \n`;
  - команды выполняются через `child_process.spawn` **без shell**;
  - таймаут по умолчанию 60 с, лимит вывода 256 КБ; `cwd` — всегда внутри корней.

### 11. SecurityAgent — контролёр действий

- **Файл:** [`security-agent.ts`](security-agent.ts:1), класс [`SecurityAgent`](security-agent.ts:145).
- **Назначение:** вспомогательный агент-контролёр (не участник консилиума): проверяет «заявку на действие» **до** выполнения и возвращает вердикт.
- **Вход:** [`SecurityActionRequest`](security-agent.ts:52): `{ kind: 'file'|'terminal'|'http'|'process', command?, args?, path?, url?, action?, description? }`.
- **Выход:** [`SecurityDecision`](security-agent.ts:76): `verdict: 'allow'|'deny'|'require-confirmation'`, `reason`, `dangerLevel`, `matchedRules[]`; вердикты пишутся в историю (`getDecisions()`) и в `AuditLog` как `security.decision`.
- **Ограничения безопасности:**
  - пути — только внутри корней (переиспользует `isInside` из FileAgent);
  - команды — whitelist/blacklist/инъекции TerminalAgent (единый источник истины);
  - опасные пути (`.env`, `.git` — высокий риск; `node_modules` — средний) → `require-confirmation`;
  - HTTP — только `https` и whitelist хостов (`moex.com`, `cbr.ru`, `finam.ru`, `investing.com`);
  - процессы — после проверки blacklist всегда `require-confirmation`.

### 12. HistoryAgent — аудит действий

- **Файл:** [`history-agent.ts`](history-agent.ts:1), фабрика [`createHistoryAgent`](history-agent.ts:1).
- **Назначение:** систематическое хранилище истории: запись событий «запуск → результат», поиск, trace-цепочки через сквозной `runId`, экспорт в JSON/Markdown, `wrapAgentExecution()` для оборачивания `agent.execute()`.
- **Вход:** [`HistoryEventInput`](history-agent.ts:57) (`agentName`, `action`, `status: success|failed|blocked`, `durationMs`, `runId`/`taskId`) или запрос [`HistoryFindQuery`](history-agent.ts:63).
- **Выход:** события, [`HistoryStats`](history-agent.ts:89), [`HistoryTrace`](history-agent.ts:105), файлы экспорта.
- **Ограничения безопасности:** экспорт работает **только внутри разрешённых корней** (`isInside`, как в FileAgent); лимит `maxEntries` (по умолчанию 1000).

### 13. PackageAgent — зависимости

- **Файл:** [`package-agent.ts`](package-agent.ts:1).
- **Действия (`action`):** `install` · `update` · `uninstall` · `check-conflicts` · `resolve-conflicts` (менеджеры `npm` / `pip`).
- **Пример входа:** `{ action: 'install', packages: ['typescript'], manager: 'npm', dryRun: false }`.
- **Пример выхода:** `{ action: 'install', manager: 'npm', commands: [...], conflicts: [], changed: true, message: '...' }`.
- **Ограничения безопасности:**
  - все команды формируются здесь, а **выполняются только через TerminalAgent** (whitelist/blacklist применяются автоматически);
  - манифесты (`package.json`, `requirements.txt`) — только в корне разрешённых директорий;
  - **`dryRun: true` по умолчанию**: без явного `dryRun: false` ничего не меняется, возвращается план команд;
  - при error-конфликтах мутации манифеста блокируются до `resolve-conflicts`.

### 14. BrowserAgent — веб-мониторинг

- **Файл:** [`browser-agent.ts`](browser-agent.ts:1).
- **Действия (`action`):** `search` · `fetch-page` · `prices` · `news` · `refresh`.
- **Пример входа:** `{ action: 'prices', tickers: ['SBER'] }`; `{ action: 'search', query: 'Сбер дивиденды' }`.
- **Пример выхода:** [`BrowserAgentOutput`](browser-agent.ts:96): `items[]`, `source` (метка фактического источника: `api:moex` / `browser:gateway` / `news:api` / `deny` / `no-data`), `warning`.
- **Ограничения безопасности:**
  - `fetch-page` — **только https + whitelist доменов** (`DEFAULT_ALLOWED_DOMAINS`), лимит контента 200 КБ, таймауты;
  - `prices` — API-провайдер (MOEX ISS) с fallback на браузер через `withFallback` (circuit-breaker); браузер — **только fallback**;
  - без инжектированного шлюза `fetch-page` честно возвращает «нет данных» (не выдумывает контент).

### 15. ConfigAgent — конфигурация

- **Файл:** [`config-agent.ts`](config-agent.ts:1), класс [`ConfigAgent`](config-agent.ts:139).
- **Действия (`action`):** `read` · `write` · `export` · `import` · `add-extension` · `remove-extension`.
- **Пример входа:** `{ action: 'write', path: 'data/settings.json', data: { theme: 'dark' }, merge: true, dryRun: true }`.
- **Пример выхода:** [`ConfigAgentOutput`](config-agent.ts:88): итоговое значение, `changed`, `backupPath` (для `import`), `message`.
- **Ограничения безопасности:**
  - все пути резолвятся только внутри корней (`isInside`);
  - запись запрещена в системные пути, `.git`, `node_modules` и **в сам корень**;
  - запись атомарная (temp-файл + rename); `import` создаёт резервную копию `.bak` до изменения;
  - значения валидируются как JSON (функции, `undefined`, `NaN/Infinity`, циклические ссылки → ошибка).

### 16. ProcessAgent — процессы

- **Файл:** [`process-agent.ts`](process-agent.ts:1).
- **Действия (`action`):** `start` · `stop` · `status` · `restart`.
- **Пример входа:** `{ action: 'start', command: 'gulp', args: ['dev'], restartOnExit: true }`.
- **Пример выхода:** [`ProcessAgentOutput`](process-agent.ts:104): `processes[]` с `status`, `pid`, `uptimeMs`, `outputTail`.
- **Ограничения безопасности:**
  - spawn **без shell**; whitelist переиспользует `TERMINAL_ALLOWED_COMMANDS` + `python`/`python3`/`gulp`;
  - blacklist и символы инъекций — те же, что у TerminalAgent;
  - `cwd` и путь бинаря — строго внутри корней (`isInside`);
  - остановка: `SIGTERM` → таймаут 5 с → `SIGKILL`; автоперезапуск с exponential backoff (1с/2с/4с…), лимит попыток 3;
  - на Windows per-process RSS/CPU недоступны — собираются `uptime/status/exitCode/outputTail`.

### 17. SchedulerAgent — планировщик

- **Файл:** [`scheduler-agent.ts`](scheduler-agent.ts:1).
- **Действия (`action`):** `schedule` · `unschedule` · `list` · `trigger` · `pause` · `resume`.
- **Пример входа:** `{ action: 'schedule', cron: '0 9 * * 1-5', task: { kind: 'pipeline' }, notify: { enabled: true, channel: 'telegram' } }`.
- **Пример выхода:** [`SchedulerAgentOutput`](scheduler-agent.ts:128): `jobs[]` с `nextRunAt`, `lastStatus`, `runs`; для `trigger` — `triggered.result`.
- **Ограничения безопасности:** внутренний цикл — интервальный тик (по умолчанию 1 с); запуск pipeline и Telegram-уведомления — **только через DI-колбэки** (`runPipeline`, `sendNotification`), прямой доступ к системе отсутствует; состояние in-memory.

### 18. LearningAgent — обучение на обратной связи

- **Файл:** [`learning-agent.ts`](learning-agent.ts:1).
- **Действия (`action`):** `analyze` · `learn` · `predict` · `report`.
- **Пример входа:** `{ action: 'learn', outcome: 'bad', action: 'terminal.execute', agent: 'TerminalAgent', note: '...' }`.
- **Пример выхода:** сохранённый [`Lesson`](learning-agent.ts:67) (паттерн `агент:действие:исход`), метрики, предсказание, сводка рекомендаций.
- **Ограничения безопасности:** `predict` — честно помеченная **эвристика** (без ML); веса уроков устаревают по полураспаду (по умолчанию 30 дней); источники истории/памяти — через DI; падение источника даёт `warning`, данные не выдумываются.

### 19. AutoRepairAgent — диагностика и авто-ремонт

- **Файл:** [`auto-repair-agent.ts`](auto-repair-agent.ts:1).
- **Действия (`action`):** `diagnose` · `repair` · `health` (scope: `project` | `deps` | `configs` | `integrity`).
- **Пример входа:** `{ action: 'repair', scope: 'project', autoFix: true }`.
- **Пример выхода:** [`AutoRepairOutput`](auto-repair-agent.ts:119): `checks[]` (severity `info/warning/error`, `fixable`, `fix`), `overall` (`ok/warnings/critical`), `appliedFixes[]`/`blockedFixes[]`.
- **Ограничения безопасности:**
  - диагностика **без сети** (только файловая система); пути — только внутри корней (`isInside`);
  - **`autoFix: false` по умолчанию**: без явного `autoFix: true` исправления не применяются;
  - `.env` восстанавливается из `.env.template` с бэкапом `.bak`; невалидные `data/*.json` пересоздаются как `{}` (с `.bak`);
  - npm/git-команды выполняются **только через инжектируемый терминал** (по умолчанию — внутренний `TerminalAgent`); `npm update` автоматически **не** выполняется (рискованно) — лишь предлагается команда;
  - каждый чекер изолирован `try/catch`: падение одного не роняет остальные.

---

## ➕ Как добавить агента

1. **Определите тип агента:**
   - аналитический (читает данные, считает, генерирует) — наследуйте [`AgentBase`](../agent/agent-base.ts:21) и реализуйте `executeInternal()`;
   - action-агент (файлы/терминал/процессы и т.п.) — используйте единый контракт [`AgentActionInput`/`AgentActionResult`](../agent/agent-contract.ts:25).
2. **Создайте файл** `src/js/modules/pipeline/agents/<name>-agent.ts` с JSDoc-шапкой: назначение, действия/вход/выход, ограничения безопасности.
3. **Экспортируйте** класс и типы из [`index.ts`](index.ts:1) (лёгкий barrel, Node-only части не идут в браузерный бандл).
4. **Безопасность — обязательно:** пути через `isInside`/корни, команды через whitelist, `dryRun` для действий с побочными эффектами, подтверждение опасных операций (см. [`SECURITY.md`](../../../../../SECURITY.md:1)).
5. **Напишите тесты** рядом: `*.test.ts` (образцы: [`terminal-agent.test.ts`](terminal-agent.test.ts:1), [`file-agent.test.ts`](file-agent.test.ts:1), [`security-agent.test.ts`](security-agent.test.ts:1)).
6. **Обновите этот README:** строку в таблице + секцию в нужной группе.
7. **Обновите документацию:** при изменении публичного API — [`ARCHITECTURE.md`](../../../../../ARCHITECTURE.md:1); при новых .env-ключах — [`ENV_SCHEMA`](../../../config/env-validation.ts:40) и `.env.template`.

Полный процесс, конвенции и чек-лист PR — в [`CONTRIBUTING.md`](../../../../../CONTRIBUTING.md:1). Обзор безопасности — в [`SECURITY.md`](../../../../../SECURITY.md:1).
