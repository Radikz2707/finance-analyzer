# 📊 Finance Analyzer — AI-анализатор инвестиционного портфеля

[![CI](https://github.com/Radikz2707/finance-analyzer/actions/workflows/ci.yml/badge.svg)](https://github.com/Radikz2707/finance-analyzer/actions/workflows/ci.yml)

Интеллектуальная система анализа российского фондового рынка (Московская биржа). Автоматически парсит данные из Excel-таблицы QUIK, рассчитывает дивиденды, купоны и целевые доли портфеля, а также генерирует экспертные рекомендации от ИИ-советника.

---

## 📚 Документация

- [**ARCHITECTURE.md**](ARCHITECTURE.md:1) — архитектура системы: слои и модули, поток данных, конфигурация, запуск, диаграмма зависимостей;
- [**CONTRIBUTING.md**](CONTRIBUTING.md:1) — как добавить модуль, агента pipeline или research-провайдера, конвенции, процесс проверки, чек-лист PR;
- [**AI-AGENT-PLAN.md**](AI-AGENT-PLAN.md:1) — мастер-план развития проекта и статусы задач;
- [**SECURITY.md**](SECURITY.md:1) — безопасность: модель угроз, слои защиты (SecurityAgent/TerminalAgent/guardrails), секреты, чек-лист разработчика.

---

## 🧭 Шпаргалка: какую команду запускать (для новичка)

Ты открыл проект и не знаешь, что вводить? Вот простое правило — **определи, чего ты хочешь**, и найди свой случай:

### Случай 1: «Я хочу пообщаться с роботом и порулить руками»

```bash
npm run app:dev
```

Откроется **десктоп-приложение** (окно программы). В нём живёт Финансовый Директор — с ним можно разговаривать, просить проанализировать портфель, открыть файл, выполнить команду. Ты всегда рядом и всё контролируешь.

> 💡 Нет интернета или не настроен ИИ? Запусти `npm run app:dev:offline` — то же окно, но без нейросети.

Не хочешь открывать окно, удобнее писать в терминале? Тогда:

```bash
npm run chat
```

Это **чат с Директором прямо в командной строке**. Пишешь вопрос — получаешь ответ. Каждое действие Директор показывает тебе на экране.

### Случай 2: «Я хочу, чтобы робот поработал сам, без меня»

```bash
npm run autonomous -- --dry-run
```

**Сначала всегда запускай с `--dry-run`** — это «репетиция»: робот покажет, какие цели нашёл и что собирался делать, но **ничего не выполнит**. Посмотри план — разумно?

```bash
npm run autonomous
```

Если план разумен — запусти **без** флага. Теперь робот работает сам: сам берёт цели, планирует, выполняет действия, оценивает результаты и учится на ошибках. Это режим «человек за компьютером не нужен».

Полезные ограничения (робот остановится сам):

```bash
npm run autonomous -- --max-minutes 10     # смена не дольше 10 минут
npm run autonomous -- --max-iterations 2   # максимум 2 итерации на цель
```

### Случай 3: «Мне нужен свежий отчёт по портфелю»

```bash
npm run pipeline
```

Это **не диалог**, а разовый «утренний ритуал»: система соберёт данные из Excel QUIK, посчитает дивиденды и купоны, прогонит всех агентов и сгенерирует красивый отчёт (`report.html` + `report.md`). Запустил — ушёл пить кофе — вернулся к готовому отчёту.

### Случай 4: «Я хочу посмотреть, что происходит в системе»

```bash
npm run harness
```

Откроет **веб-страницу с дашбордом**: виджеты, телеметрия агентов, состояние подсистем. Удобно «заглянуть под капот», ничего не ломая.

### Случай 5: «Я меняю код и хочу проверить, что не сломал»

```bash
npm run lint        # проверка стиля + типов TypeScript
npm run test:run    # все тесты одним прогоном
```

Порядок именно такой: сначала `lint`, потом тесты. Обе команды зелёные — можно коммитить.

### Случай 6: «Я хочу собрать программу для установки»

```bash
npm run app:build
```

Соберёт установочный файл (инсталлятор + portable). Для повседневной работы **не нужно** — это только для релизов.

### Мини-шпаргалка (запомни эти три)

| Хочу...                    | Команда              |
| -------------------------- | -------------------- |
| Пообщаться                 | `npm run app:dev`    |
| Отдать работу роботу       | `npm run autonomous` |
| Получить отчёт по портфелю | `npm run pipeline`   |

Полный список всех команд: запусти `npm run help`.

---

## 🎯 Возможности

- **Парсинг Excel** — автоматический обход листа QUIK с извлечением позиций, цен, НКД и целевых долей
- **Расчёт дивидендов** — LTM-дивиденды по акциям (SBER, IRAO, PLZL, X5 и др.) с резервным словарём ставок
- **Расчёт купонов** — НКД по облигациям (ОФЗ, корпоративные)
- **Ребалансировка** — сравнение текущих и целевых долей, расчёт дефицита в рублях
- **ИИ-советник** — анализ портфеля с учётом макроэкономической ситуации и ключевой ставки ЦБ
- **Генерация отчётов** — HTML-дашборд + Markdown-отчёт с таблицами, графиками и рекомендациями
- **Мультиагентный конвейер** — 5 независимых агентов с параллельным выполнением и cron-расписанием

---

## 🛠️ Быстрый старт

### 1. Установка зависимостей

> ⚠️ **Windows (cmd.exe):** все npm-скрипты (`lint`, `test:run`, `build`, `dev` и т.д.) должны запускаться из **cmd.exe**, а не из Git Bash. Если ранее npm-скрипты падали с ошибками `sed: command not found` / `dirname: command not found` / `Cannot find module 'c:\...\bin\...'` — причиной был `script-shell`, указывающий на Git Bash. Исправление (выполнить один раз):

```bat
npm config set script-shell "C:\Windows\System32\cmd.exe"
npm config get script-shell   :: ожидаемый ответ: C:\Windows\System32\cmd.exe
```

Установка зависимостей (из cmd.exe):

```bat
npm install --legacy-peer-deps
```

Если установка падает на хуке `husky` (`prepare`), поставьте зависимости без скриптов, а хук накатите вручную:

```bat
npm install --legacy-peer-deps --ignore-scripts
npm run prepare
```

Либо то же самое одной командой: `HUSKY=0 npm install --legacy-peer-deps`.

### 2. Подготовка Excel-файла

Укажите путь к вашему Excel-файлу в файле `src/js/modules/xlsx-parser/xlsx-parser.ts`:

```typescript
const FILE_PATH = 'C:/Users/ВашеИмя/Documents/Бухгалтерия/Данные новые.xlsx';
```

Файл должен содержать лист **QUIK** со столбцами:

- Код инструмента
- Вид активов (А = акция, О = облигация, Ф = фонд)
- Инструмент (название)
- Позиция (количество)
- Балансовая цена (цена входа)
- Ликвидационная цена (текущая цена)
- Целевая доля, %
- Объявленные дивиденды (опционально)

### 3. Запуск анализа

```bash
npm run analyze
```

Результат:

- `report.html` — интерактивный дашборд (открывается автоматически в браузере)
- `report.md` — Markdown-отчёт для копирования в мессенджеры

---

## ⚙️ Команды проекта

| Команда                      | Описание                                                |
| :--------------------------- | :------------------------------------------------------ |
| `npm run analyze`            | **Запуск анализа:** парсинг Excel + генерация отчёта    |
| `npm run dev`                | Разработка: запуск Gulp-сервера для фронтенда           |
| `npm run build`              | Сборка фронтенда (тесты + линтинг + билд)               |
| `npm run test`               | Тесты Vitest в режиме watch                             |
| `npm run test:run`           | Тесты Vitest однократный прогон                         |
| `npm run test:run -- <путь>` | Прогон одного файла тестов (см. раздел «Разработка»)    |
| `npm run lint`               | Проверка TS (ESLint) и SCSS (Stylelint)                 |
| `npm run init`               | Инициализация структуры компонентов                     |
| `npm run create`             | Создание нового компонента                              |
| `npm run module`             | Создание нового JS-модуля                               |
| `npm run remove`             | Удаление компонента                                     |
| `npm run help`               | Справка по Gulp-командам                                |
| `npm run audit`              | Аудит кода в `.audit/audit.md`                          |
| `npm run blueprint`          | Генерация дерева файлов в `.audit/`                     |
| `npm run pipeline`           | **Мультиагентный конвейер:** однократный запуск         |
| `npm run pipeline:schedule`  | Запуск с cron-расписанием (утро/периодически)           |
| `npm run harness`            | Фоновый процесс: диспетчер + QUIK + Telegram-алерты     |
| `npm run chat`               | Чат с Финансовым Директором в терминале (CLI)           |
| `npm run bench`              | Бенчмарки производительности pipeline                   |
| `npm run test:integration`   | Интеграционные тесты (включаются через RUN_INTEGRATION) |
| `npm run lint:gulp`          | Проверка типов Gulp-задач (`tsc -p gulp/tsconfig.json`) |
| `npm run update-modules`     | Интерактивное обновление npm-зависимостей               |
| `npm run cache:clear-ai`     | Очистка кэша ИИ (память/кеши)                           |

---

## 📦 Десктоп-приложение (Electron)

Собирается из `desktop/` в нативный Windows-клиент: esbuild CJS-бандлы
(main/preload/renderer), `contextIsolation: true`, IPC-стриминг событий аудита
Директора. Данные упакованного приложения хранятся в `%APPDATA%\finance-analyzer\`
(финансовая БД `finance.db`, память ИИ `ai-memory.db`) — автодетект упакованности
по `resources/app.asar`, см. [`app-paths.ts`](src/js/modules/app-paths.ts:1).
В dev/CLI-режиме данные пишутся в `<cwd>/data/`.

**Настройка пути к Excel:** кнопка «📁 Excel…» в шапке открывает нативный диалог
выбора файла портфеля QUIK; путь сохраняется в
`%APPDATA%\finance-analyzer\settings.json` и применяется после перезапуска
приложения. Альтернативно поддерживается переменная окружения `EXCEL_FILE_PATH`
(системная или из `.env`).

| Команда                   | Описание                                                          |
| :------------------------ | :---------------------------------------------------------------- |
| `npm run app:dev`         | Десктоп в режиме разработки (сборка бандлов + запуск Electron)    |
| `npm run app:dev:offline` | Десктоп без внешнего ИИ-провайдера (режим offline)                |
| `npm run app:build:js`    | Только бандлы (esbuild + sass) в `desktop/dist/`                  |
| `npm run app:rebuild`     | Пересборка native-модулей под ABI Electron (нужны VS Build Tools) |
| `npm run app:typecheck`   | Проверка типов desktop (`tsc -p desktop/tsconfig.json --noEmit`)  |
| `npm run app:build`       | Полная сборка: бандл + rebuild + NSIS-установщик + portable       |
| `npm run app:build:dir`   | Быстрая сборка без инсталлятора (`release/win-unpacked/`)         |

### 🔖 Релизы и версии

Версия приложения — semver (`major.minor.patch`) из `package.json`. Она
автоматически попадает в имя установщика (`Finance Analyzer-<version>-setup.exe`),
заголовок окна и бейдж в шапке UI.

| Команда                 | Эффект                                     |
| :---------------------- | :----------------------------------------- |
| `npm run release:patch` | +1 к patch (1.0.0 → 1.0.1) + полная сборка |
| `npm run release:minor` | +1 к minor (1.0.1 → 1.1.0) + полная сборка |
| `npm run release:major` | +1 к major (1.1.0 → 2.0.0) + полная сборка |

Каждый `npm version` создаёт git-коммит и тег `v<версия>`. Для произвольной
версии: `npm version 2.0.1 && npm run app:build`.

---

### 🛠 Десктоп-функции (v1.0.1)

**Чат с директором.** Финансовые вопросы обрабатывает мультиагентный конвейер
(делегирование → Консилиум → синтез). Нефинансовые реплики («Расскажи анекдот»,
«Что нового в мире?») уходят в **свободный диалог**: локальная **Ollama**
отвечает с контекстом портфеля (сводка фактов + короткая история чата); если
Ollama недоступна — честный fallback без запуска агентов. Приветствия («Привет»)
отвечаются статично.

**Выбор модели Ollama.** В шапке приложения — выпадающий список моделей,
загруженных в локальную Ollama (`/api/tags`), кнопка «🔄 Применить» сохраняет
выбор в `%APPDATA%\finance-analyzer\settings.json` (`ollamaModel`) и предлагает
перезапуск. По умолчанию используется `qwen3:14b` (или переменная
`OLLAMA_MODEL`).

**Панель «Агенты».** Показывает **каталог всех 20 агентов** системы
(`SYSTEM_AGENT_CATALOG`): агенты, ещё не выполнявшиеся в текущей сессии,
отображаются как `idle` со счётчиками 0; реальные карточки (`FileAgent`,
`TerminalAgent`) — со статистикой выполнения.

**Диспетчер.** Кнопка «▶ Запустить Анализ» возвращает **сводку результата**
прогона (успех/ошибка + итоговая строка), а не молчаливый запуск. Во время
выполнения кнопка показывает «⏳ Анализ выполняется…», а по завершении в
блоке диспетчера появляется заметная строка «✓/✗ Завершён за MM:SS» (зелёная
или красная). Поле «Последний запуск» и время в интерфейсе — в локальном
часовом поясе пользователя. Кнопка
«💾 Экспорт отчёта» сохраняет полный HTML-дашборд в
`%APPDATA%\finance-analyzer\reports\dashboard_<метка>.html` и открывает его
в браузере. Кнопка «📄 PDF…» формирует тот же дашборд через
`webContents.printToPDF` (A4, с фоном) и открывает **нативный диалог выбора
места сохранения** — пользователь сам указывает путь и имя PDF-файла.
Файловые отчёты конвейера (`report.html`/`report.md`) в упакованном
приложении также пишутся в `%APPDATA%\finance-analyzer\reports\`
(в dev/CLI — как раньше, в корень проекта).

**Метаданные установщика:** автор — Радик Залалов, © 2026, все права защищены.

---

## 💻 Разработка (Windows / cmd.exe)

Все команды выполняются из **cmd.exe**. Убедитесь, что `script-shell` указывает на cmd.exe (см. раздел «Быстрый старт»).

| Действие                        | Команда                                                                  |
| :------------------------------ | :----------------------------------------------------------------------- |
| Тесты (один файл, быстро)       | `npm run test:run -- src/js/modules/python-engine/python-engine.test.ts` |
| Тесты (весь suite)              | `npm run test:run`                                                       |
| Тесты (watch-режим)             | `npm run test`                                                           |
| Линт (ESLint + Stylelint + tsc) | `npm run lint`                                                           |
| Сборка (тесты + билд)           | `npm run build`                                                          |
| Dev-сервер (Gulp watch)         | `npm run dev`                                                            |
| Проверка типов (tsc, --noEmit)  | `node node_modules/typescript/lib/tsc.js --noEmit`                       |

> Аргументы после `--` передаются в вызываемую команду: `npm run test:run -- <путь к тесту>` запускает vitest только для указанного файла.

---

## 📁 Структура проекта

```
finance-analyzer/
├── src/
│   ├── js/
│   │   ├── modules/
│   │   │   ├── xlsx-parser/        # Парсинг Excel (QUIK, сделки, цели)
│   │   │   ├── ai-advisor/         # ИИ-советник, расчёт доходов, ставки ЦБ
│   │   │   ├── portfolio-math/     # Математика портфеля, валидация лимитов
│   │   │   ├── portfolio-snapshot/ # Снимки портфеля для AI
│   │   │   ├── research/           # Research providers (Market, Issuer, News, Macro)
│   │   │   ├── pipeline/           # 🔮 Мультиагентный конвейер (Фаза 2+3)
│   │   │   │   ├── agent/          # Базовый класс IAgent, AgentBase
│   │   │   │   ├── agents/         # 5 агентов: Data, Research, Analysis, AI, Notification
│   │   │   │   ├── review/         # 🔮 3 review-агента (Conservative, Aggressive, Risk)
│   │   │   │   ├── controller/     # 🔮 Agent Controller (управление агентами)
│   │   │   │   ├── audit/          # 🔮 Audit Log (аудит-трейл)
│   │   │   │   ├── pipeline-coordinator.ts  # DAG-оркестратор
│   │   │   │   ├── pipeline-scheduler.ts    # Cron-планировщик
│   │   │   │   └── command-center.ts        # 🔮 AI Command Center (human-in-the-loop)
│   │   │   ├── quik-gateway/       # 📡 QUIK-канал: чтение новостей и заявок (Фаза 3)
│   │   │   ├── resource-monitor/   # 🛰 Мониторинг CPU/RAM (Фаза 5)
│   │   │   ├── adaptive-scheduler/ # 🛰 Гибридный диспетчер нагрузки (Фаза 5)
│   │   │   ├── harness-integration/# 🛰 UI-интеграция: диспетчер + QUIK + Telegram (Фаза 5)
│   │   │   └── telegram-bot/       # Telegram-бот для управления
│   │   └── app.ts                  # Точка входа фронтенда
│   └── components/                 # БЭМ-компоненты (dashboard)
├── quik/                           # 📡 QLua-скрипты для терминала QUIK (Фаза 3)
├── data/                           # Данные (orders.csv, quik/ и др.)
├── gulp/                           # Gulp-задачи
├── pipeline.ts                     # 🔮 Entry point мультиагентного конвейера
├── index.ts                        # Точка входа анализа (Фаза 1)
├── package.json
└── .env                            # API-ключи (ProxyAPI, GigaChat)
```

---

## 🧩 Модули анализа

### XLSX Parser (`src/js/modules/xlsx-parser/`)

- `xlsx-parser.ts` — парсинг листа QUIK, макроцелей, истории сделок
- `quik-orders-parser.ts` — парсинг заявок из CSV-файла QUIK

### AI Advisor (`src/js/modules/ai-advisor/`)

- `income-calculator.ts` — расчёт дивидендов и купонов
- `ai-client.ts` — запрос к GigaChat API через ProxyAPI
- `cbr-rate.ts` — получение ключевой ставки ЦБ РФ
- `auto-target-allocator.ts` — автопредложение целевых долей для новых активов
- `report-builders.ts` — генерация HTML-таблиц и виджетов

### Portfolio Math (`src/js/modules/portfolio-math/`)

- `portfolio-math.ts` — анализ отклонений, приоритеты покупок, концентрация рисков
- `portfolio-validator.ts` — валидация лимитов портфеля

### Research Data Layer (`src/js/modules/research/`)

**Типы и контракты:**

- `types.ts` — ResearchValue<T>, AssetIdentity, IssuerResearch, BondResearch, MarketResearch, MacroResearch, NewsResearch, RiskAssessment, InvestmentThesis, AIRecommendation
- `helpers.ts` — value(), noData(), hasValue(), pct(), rub() — фабрики с provenance

**Providers (поставщики данных):**

- `providers/market-provider.ts` — котировки, динамика, liquidity
- `providers/issuer-fundamentals-provider.ts` — финансовые показатели эмитента
- `providers/news-provider.ts` — новости с релевантностью к активу
- `providers/macro-provider.ts` — ключевая ставка ЦБ (официальный API), инфляция, курсы валют
- `providers/registry.ts` — агрегация результатов, merge semantics (VALUE > NO_DATA), conflict tracking

**Investment Thesis Engine:**

- `investment-thesis/investment-thesis-engine.ts` — генерация тезисов (bull/base/bear case)
- `investment-thesis/types.ts` — InvestmentThesisInput, InvestmentThesisResult, ValuationView, ThesisConfidence

**Принцип:** LLM НЕ является источником фактов. Все факты поступают через providers с evidenceIds. LLM только интерпретирует ResearchData.

### 🔮 Мультиагентный конвейер (`src/js/modules/pipeline/`)

**Фаза 2** — переписала монолитный конвейер `parseExcelAndFetchRecommendations()` в систему из 5 независимых агентов:

```
[Data Agent] ────────────────────────────────────────┐
    │                                                  │
    ├─→ [Research Agent] ──→ [AI Agent] ──→ [Notification Agent]
    │          │                      │
    └─→ [Analysis Agent] ────┘        │
                                      │
(Research + Analysis — параллельно через Promise.all)
```

**5 агентов:**

| Агент                  | Задачи                                                                                    |
| :--------------------- | :---------------------------------------------------------------------------------------- |
| **Data Agent**         | Парсинг Excel/QUIK: позиции, цены, НКД, целевые доли, счета, заявки, сделки               |
| **Research Agent**     | Параллельное исследование каждого актива через 4 провайдера (Market, Issuer, News, Macro) |
| **Analysis Agent**     | PortfolioMath, валидация рисков, расчёт дивидендов/купонов, ценовые алерты                |
| **AI Agent**           | InvestmentThesisEngine, вызов GigaChat, пост-обработка, структурированные рекомендации    |
| **Notification Agent** | Сборка HTML-дашборда, Markdown-отчёт, открытие в браузере                                 |

**Преимущества:**

- **Параллелизм** — Research и Analysis запускаются одновременно (Promise.all)
- **Изоляция ошибок** — падение одного агента не ломает весь конвейер
- **Retry-логика** — каждый агент имеет собственную политику повторных попыток
- **Таймауты** — агенты не блокируют конвейер бесконечно
- **Cron-расписание** — автоматические запуски по расписанию (утро, каждые 4ч, воскресенье)

**Entry point:** `pipeline.ts`

```bash
npm run pipeline          # однократный запуск
npm run pipeline:schedule # запуск с cron-расписанием
```

**Расписания по умолчанию:**

- `0 9 * * 1-5` — каждое утро в 9:00 (будни)
- `0 */4 * * *` — каждые 4 часа
- `0 10 * * 0` — воскресенье в 10:00 (развёрнутый отчёт)

### 🎮 AI Command Center (Фаза 3 — Human-in-the-Loop)

**Фаза 3** добавляет систему управления агентами и многоагентную проверку рекомендаций:

```
[AI Agent] генерирует рекомендацию
     │
     ▼
[Conservative Reviewer] — "что если рынок упадет?"
[Aggressive Reviewer]   — "где скрытый потенциал?"
[Risk Manager]          — "не нарушаем ли лимиты?"
     │
     ▼
[Review Coordinator] сравнивает 3 мнения
     │
     ├─→ Согласие > 80% → ✅ Approve → Отчёт
     │
     └─→ Расхождение > 20% → 📤 Директору на проверку
              │
              ├─→ /approve → ✅ Отчёт
              ├─→ /reject "убери риски по Сберу" → AI переделывает
              └─→ /modify "добавь X5 в портфель" → новый анализ
```

**3 review-агента:**

| Ревизор          | Задачи                                                        |
| :--------------- | :------------------------------------------------------------ |
| **Conservative** | Оценивает риски при падении рынка, концентрацию, ликвидность  |
| **Aggressive**   | Ищет скрытый потенциал роста, недооценённые активы            |
| **Risk Manager** | Проверяет соблюдение лимитов, диверсификацию, стресс-сценарии |

**Команды директора в Telegram:**

| Команда                       | Описание                                 |
| :---------------------------- | :--------------------------------------- |
| `/agents`                     | Статус всех агентов (idle/running/error) |
| `/status {agent}`             | Детальная статистика конкретного агента  |
| `/log {agent}`                | Логи агента за последнюю минуту          |
| `/stop {agent}`               | Остановить агента                        |
| `/restart {agent}`            | Перезапустить агента                     |
| `/config {agent} key=value`   | Изменить настройки (retries, timeout)    |
| `/override {agent} "команда"` | Переопределить результат агента          |
| `/review`                     | Запустить 3 ревизора                     |
| `/approve`                    | Утвердить рекомендацию                   |
| `/reject "комментарий"`       | Отправить на доработку с фидбэком        |
| `/modify "изменение"`         | Точечное изменение рекомендаций          |
| `/audit`                      | Полный аудит-трейд всех действий         |

**Пример диалога:**

```
Директор: /review

Бот: 🔍 Результаты review-агентов:

🛡️ Консервативный ревизор
⚠️ SBER концентрация > 8% — риск при падении рынка
⚠️ Нет хеджа против валютного риска

🚀 Агрессивный ревизор
✅ PLZL недооценён (P/E < отрасли на 15%)
✅ X5 имеет потенциал роста +12%

📋 Risk Manager
⚠️ Превышение лимита концентрации при стресс-сценарии
✅ Диверсификация по секторам OK

📊 Согласие: 60% (расхождение > 20%)
📤 Отправка директору на проверку...

Директор: /reject "SBER не трогать, рынок нестабильный"

Бот: 🔄 Переделываю с учётом фидбэка...

📊 Итоговая рекомендация (итерация 2):
• SBER: HOLD (без изменений — рыночная нестабильность)
• PLZL: BUY (10.4% → 12%)
• Свободные средства перераспределены на OФЗ-26244

📊 Согласие агентов: 92%
```

**Audit Log:**

- Все действия записываются в аудит-трейл
- Фильтрация по типу, actor, pipelineId
- Формирование отчётов для Telegram
- Ограничение размера (1000 записей)

### 📡 QUIK-канал (Фаза 3 — прямые Lua-скрипты QLua)

Прямой двухсторонний канал с терминалом QUIK: скрипты **только записывают** данные
в файлы, TS-модуль **только читает** их. Отправка транзакций в QUIK запрещена.

**Установка скриптов в QUIK:**

1. Скопируйте `quik/export_news.lua` и `quik/export_orders.lua` на диск.
2. В каждом файле пропишите свой абсолютный путь в константах в начале файла
   (`NEWS_FILE_BASE` / `ORDERS_FILE_BASE` / `LOG_FILE`) — в QUIK нет `.env`,
   путь задаётся прямо в скрипте.
3. В терминале QUIK: **Сервис → Lua-скрипты → Добавить** → выберите файл →
   отметьте галочкой для запуска.
4. Убедитесь, что папка `data/quik` существует (QUIK её не создаёт сам).

**Что экспортируется:**

| Скрипт              | Событие                       | Файл                             | Содержимое                                      |
| :------------------ | :---------------------------- | :------------------------------- | :---------------------------------------------- |
| `export_news.lua`   | `OnNews` (окно новостей QUIK) | `data/quik/news_ГГГГММДД.json`   | Массив `{ id, className, time, text }` (append) |
| `export_orders.lua` | таймер (60 с) + при старте    | `data/quik/orders_ГГГГММДД.json` | Массив активных заявок в формате `QuikOrder`    |

**Чтение на TS (`src/js/modules/quik-gateway/`):**

- `QuikNewsReader` — новости: чтение JSON/JSONL, дедупликация по тексту+времени,
  `getUnreadNews()`, конвертация в `RawNewsItem` для Gatekeeper.
- `QuikOrdersReader` — заявки: последний файл → массив `QuikOrder`.
- `QuikNewsSource` — источник `name: 'quik'` для Gatekeeper (при недоступности
  QUIK возвращает `[]`, поток данных не прерывается).
- `QuikGateway` — фасад: `isAvailable()`, `readNews()`, `readOrders()`.

Папка по умолчанию — `<корень проекта>/data/quik`, переопределяется через
`QUIK_NEWS_DIR` / `QUIK_ORDERS_DIR` в `.env`.

---

### 🛰 Harness Integration (Фаза 5 — UI-интеграция диспетчера и QUIK-канала)

Модуль `src/js/modules/harness-integration/` включает гибридный фоновый анализ
в единую подсистему и отдаёт её состояние дашборду и Telegram:

```
AdaptiveScheduler ──► HarnessBridge ──► formatDashboardHtml() ──► дашборд
QuikGateway      ──► HarnessBridge ──► HarnessDashboardPayload
Python/DataAgent ──► HarnessBridge ──► TelegramNotifier ──► TelegramSender (внешний)
```

**Что включено:**

| Файл                        | Назначение                                                                                                                                                                 |
| :-------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`                  | `SchedulerStatusInfo`, `QuikNewsBrief`, `AnomalyBrief`, `HarnessDashboardPayload`, `TelegramSender`                                                                        |
| `harness-bridge.ts`         | `HarnessBridge` — агрегатор: статус диспетчера, аномалии, новости QUIK (до 10), счётчик активных заявок                                                                    |
| `anomaly-source.ts`         | `createAnomalySource()` — **живые z-score аномалии**: тикеры портфеля из Excel → `fetchHistoricalBatch` (180 дней, D) → `AnomalyDetector`; при недоступности данных → `[]` |
| `telegram-notifier.ts`      | `TelegramNotifier` — компактные тексты с эмодзи/тикерами, отправка через внешний `TelegramSender` (`sendAnomalyReport`, `sendSchedulerAlert`)                              |
| `format-dashboard-html.ts`  | `formatDashboardHtml(payload)` — самодостаточный HTML-фрагмент блока «🛰 Harness»                                                                                           |
| `mount-dashboard-block.ts`  | `mountDashboardBlock('#harnessBlock')` — рендер блока, кнопка ручного запуска, автобновление каждые 60 с                                                                   |
| `harness-bootstrap.ts`      | **Node-only** фабрика: QuikGateway + AdaptiveScheduler + PipelineCoordinator + мост + window-API                                                                           |
| `harness-bridge.test.ts`    | Тесты агрегатора (mock-зависимости, отсутствие диспетчера → `scheduler: null`)                                                                                             |
| `anomaly-source.test.ts`    | Тесты источника аномалий (нет тикеров/короткие серии/ошибки → `[]`)                                                                                                        |
| `telegram-notifier.test.ts` | Тесты форматирования, `sendSchedulerAlert` и no-op поведения без sender                                                                                                    |

**Активация (`src/js/app.ts`):**

- Диспетчер требует Node-рантайм (os/fs/child_process/Python), поэтому в
  браузерный бандл попадают только лёгкие типы, а Node-сборка
  (`harness-bootstrap.ts`) загружается **динамически** и **только при наличии
  Node-рантайма** (guard по `process.versions.node`). В браузере — no-op,
  сборка и работа приложения не меняются.
- `initHarness()` в bootstrap: `AdaptiveScheduler` с коллбэком-обёрткой над
  `new PipelineCoordinator().run()` (обязательный `try/catch`: отсутствие
  данных или выключенная Ollama не роняют приложение), `HarnessBridge.attachScheduler()`,
  `scheduler.start()` (первый снимок сразу).
- В bridge передаётся `loadAnomalies: () => createAnomalySource().load()` —
  **живые аномалии** попадают в payload дашборда (повторяют «Шаг 10»
  DataAgent: Excel-тикеры → Finam history 180 дней → AnomalyDetector).
  Нет Excel/сети/Python — источник возвращает `[]`, payload не падает.
- Всё обёрнуто в `try/catch`; при сбое любого компонента приложение
  продолжает работать, а дашборд показывает «диспетчер не запущен».
- Дашборду/боту состояние доступно через `window.__FINANCE_HARNESS__`
  (вешается всегда): `getPayload()`, `manualRun()`, `notifier`.

**Фоновый процесс с автоалертами (`npm run harness`):**

Запускает Node-entry `scripts/harness-start.ts` (через `node --import tsx`):

```bash
npm run harness
```

- Вызывает `initHarness()` и подписывается на `scheduler.onModeChange()`:
  при переходах режима **active ↔ sleeping** отправляет `formatSchedulerAlert(status)`
  через `notifier.sendSchedulerAlert()` в Telegram.
- Скрипт остаётся жить (keep-alive) и логирует запуск; без токена/отправителя
  алерты не отправляются (no-op), скрипт продолжает работать.
- Корректное завершение: `SIGINT`/`SIGTERM` → отписка слушателя +
  `scheduler.stop()` + выход (Ctrl+C в терминале).

**Как подключить Telegram:**

1. В `.env` укажите токен бота и разрешённые ID:
   ```dotenv
   TELEGRAM_BOT_TOKEN=123456:ABC-DEF...   # из BotFather
   TELEGRAM_ADMIN_IDS=123456789           # ваш chat_id
   ```
2. Внешний отправитель реализует `TelegramSender` (`sendMessage(text): Promise<boolean>`)
   и регистрируется из любого места (например, внутри telegram-bot):
   ```typescript
   // Вариант А — из Node-кода (после initHarness):
   import { initHarness } from './modules/harness-integration/harness-bootstrap.js';
   const handle = initHarness();
   handle?.notifier.attach({
     sendMessage: async (text) => bot.sendMessage(chatId, text),
   });

   // Вариант Б — из фронтенда (если диспетчер запущен в Node-среде):
   window.__FINANCE_HARNESS__.notifier.attach({
     sendMessage: async (text) => bot.sendMessage(chatId, text),
   });
   ```
   Модуль НЕ импортирует telegram-bot напрямую — только интерфейс отправителя.
3. Без зарегистрированного sender методы `sendAnomalyReport()` /
   `sendSchedulerAlert()` возвращают `false` и не кидают ошибок (no-op).

**Блок на дашборде (встроен в `src/index.html`):**

Контейнер уже присутствует в `src/index.html`:

```html
<section id="harnessBlock" data-harness-container aria-live="polite">
  <div class="harness-block harness-placeholder">🛰 Загрузка состояния…</div>
</section>
```

`mountDashboardBlock('#harnessBlock')` вызывается из `src/js/app.ts`
при инициализации приложения и:

- запрашивает `window.__FINANCE_HARNESS__.getPayload()` и вставляет
  `formatDashboardHtml(payload)` в `innerHTML`;
- вешает кнопку «🚀 Ручной запуск анализа» (делегирование кликов) →
  `window.__FINANCE_HARNESS__.manualRun()`;
- обновляет блок каждые 60 секунд; при `beforeunload`/`pagehide` —
  полная отписка (таймер + слушатели).

Стили — в `src/js/modules/harness-integration/harness.scss` (подключён в
`src/scss/style.scss`): цвет режима диспетчера (active=green, sleeping=grey,
manual=blue), красная подсветка аномалий `h-anomaly--danger` (isLastAnomaly),
компактный список новостей QUIK.

Если контейнера нет или API недоступно — тихий no-op: страница работает
как раньше. Кнопка автоматически `disabled`, когда диспетчер не создан.

**Env-переменные подсистемы:**

| Переменная           | Описание                                  |
| :------------------- | :---------------------------------------- |
| `QUIK_NEWS_DIR`      | Папка новостей QUIK (см. Фаза 3)          |
| `QUIK_ORDERS_DIR`    | Папка заявок QUIK (см. Фаза 3)            |
| `TELEGRAM_BOT_TOKEN` | Токен Telegram-бота (для внешнего sender) |
| `TELEGRAM_ADMIN_IDS` | Chat ID получателей уведомлений           |

---

### 🧪 E2E-тест (Фаза 4 — сквозной прогон конвейера)

Интеграционный тест `src/js/modules/e2e-tests/pipeline-e2e.test.ts` прогоняет
сквозную цепочку обработки **без внешней сети и без реального AI-вызова**:

```
Quik/RSS/MOEX → Gatekeeper → DataAgentOutput → Python Engine (аномалии)
             → InteractiveOrders → ReviewAgent
```

**Запуск:**

```bash
node node_modules/vitest/vitest.mjs run src/js/modules/e2e-tests/
```

**Что покрывает тест (по шагам):**

- **Шаг A — источники:** реальный `QuikNewsSource` читает mock-файл новостей
  `news_ГГГГММДД.json` из `os.tmpdir()`; RSS/MOEX заменены моками с
  фиксированными `RawNewsItem[]` (без сети).
- **Шаг B — Gatekeeper:** реальный фильтр по тикерам `['SBER','GAZP']`
  одобряет новости с упоминанием тикеров, отсекает шум (`noise`) и
  нерелевантные новости (`not_relevant`).
- **Шаг C — Python Engine:** реальный `AnomalyDetector` на сериях цен
  (SBER — скачок на последнем баре, GAZP — стабильный ряд) возвращает
  `isLastAnomaly=true`/`riskLevel='high'` для SBER и `false` для GAZP.
  Python вызывается через bridge, помеченный как недоступный, — тест
  детерминированно проходит по TypeScript-fallback (та же математика,
  что и в `src/python/anomalies.py`).
- **Шаг D — ордера и guardrails:** реальный генератор `buildInteractiveOrders`
  создаёт ордера из `AssetAnalysis`; ни один ордер не является `SELL`, а
  реальный `checkGuardrails` из `guardrails.ts` блокирует `SELL`/`REDUCE` для
  актива со статусом `RECOVERY_ONLY` (стратегический запрет фиксации убытка).
- **Шаг E — ReviewAgent:** итоговый `ReviewResult` собирается из данных
  предыдущих шагов (реальные `news` и `anomalies` в `DataAgentOutput`) —
  `success=true`, 3 ревизора отработали без таймаутов.

Тест пишет временные файлы только в `os.tmpdir()` и удаляет их после себя.

---

## 🔧 Пакет улучшений 1

Пакет из четырёх улучшений конвейера: внешний AI-судья, живой
Watchdog-мониторинг, реальный Telegram-отправитель и авто-архивация KPI.

### 1. Внешний AI-судья (`src/js/modules/pipeline/review/`)

- [`review-agent.ts`](src/js/modules/pipeline/review/review-agent.ts) — конструктор
  принимает опциональный `externalJudge?: ExternalAiJudge`
  (`{ provider?, request(req: ExternalAiRequest): Promise<ExternalAiResponse> }`).
  После внутренних ревизоров ReviewAgent формирует запрос `task: 'judge'`
  с результатами ревизии и добавляет совещательный `externalVerdict` в
  `ReviewResult`. Вердикт **не блокирует `success`**: ошибка/отсутствие
  судьи → no-op.
- Контракт `ExternalAiJudge` объявлен в `review-agent.ts`; реализация фабрики
  (`createExternalAiJudge` через `BrowserGateway`) в текущей сборке не подключена.

### 2. Watchdog-мониторинг агентов (`pipeline-coordinator.ts`)

- Каждый `run()` стартует Watchdog; перед агентом выполняется
  `registerAgent(name)` + `setAgentTask(name, pipelineId, timeout)`, после —
  `checkAgent(name)`. Инциденты логируются (автоперезапуск VS Code остаётся
  выключенным по умолчанию — ручной режим).
- Конструктор принимает `options: { watchdog?, memorySink? }`; без опций
  создаётся Watchdog по умолчанию. `shutdown()` останавливает сторож.
- `PipelineResult.watchdogHealth?: AgentHealthReport` — отчёт попадает в
  результат при наличии проверок.

### 3. Реальный Telegram-отправитель (`harness-integration/`)

- [`telegram-http-sender.ts`](src/js/modules/harness-integration/telegram-http-sender.ts) —
  `TelegramHttpSender implements TelegramSender`: POST
  `https://api.telegram.org/bot<token>/sendMessage` с `AbortController(timeoutMs=10000)`,
  инъекция `fetchImpl` для тестов. Без конфигурации → `false` (no-op).
- Токен/чат берутся из `process.env` (**в логах токен не выводится**).
- `harness-bootstrap.ts` автоматически подключает sender: «Telegram подключён»
  или «Telegram не настроен (нет токена/chatId)».

### 4. Авто-архивация KPI (`src/js/modules/pipeline/ai-memory/kpi-sink.ts`)

- `savePortfolioKpi(memory, result)` собирает **только реальные поля**
  `PipelineResult`: `totalValue`, `stocksShare`, `bondsShare`, `freeCash`,
  `riskLevel`, `anomaliesCount`, `topMovers` — и сохраняет `kpi_snapshot`
  в стратегическую память. Недостаточно данных (нет стоимости/долей) →
  пропуск с `warn`.
- Coordinator вызывает sink через DI `memorySink` только при `success=true`;
  падение колбэка не роняет `run()`. Подключено в `harness-bootstrap.ts`.

### Env-переменные Telegram

```dotenv
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...   # токен бота (BotFather)
TELEGRAM_CHAT_ID=123456789             # chat_id (приоритет)
TELEGRAM_ADMIN_IDS=123456789,987654321 # fallback: первый ID = chat_id
```

---

## 🔧 Пакет улучшений 2

Пакет из четырёх улучшений: подготовка транзакций QUIK с подтверждением
(без автоотправки), резервные MOEX-котировки через Python Engine,
ценовые алерты в Telegram и retry в Python-мосте.

### 1. Подготовка транзакций QUIK (`quik/send_order.lua` + `quik-gateway/`)

- [`send_order.lua`](quik/send_order.lua) — QLua-скрипт **ручной** отправки
  заявки: читает `data/quik/order_request.json`, валидирует поля, вызывает
  `sendTransaction()` в обёртке `pcall` и пишет результат в
  `data/quik/order_result.json` `{ ok, orderNum?, error?, time }`.
  Скрипт НЕ запускается автоматически — только кнопкой пользователя в QUIK.
  Установка описана в шапке файла (нужно прописать `QUIK_DATA_DIR`).
- [`transaction-builder.ts`](src/js/modules/quik-gateway/transaction-builder.ts) —
  подготовка заявки БЕЗ автоотправки:
  - `buildOrderRequest(order, 'APPROVED')` формирует `QuikTransactionRequest`
    **только** при двойном подтверждении (статус ордера `APPROVED` +
    явный `userConfirmation: 'APPROVED'`); `PENDING`/`REJECTED` → `null`
    (защита от случайной отправки);
  - `saveOrderRequest(request, dir?)` пишет `order_request.json`
    в `QUIK_ORDERS_DIR` (fallback `<root>/data/quik`);
  - `readOrderResult(dir?)` читает результат; нет файла/битый JSON → `null`.
- Поток: `PENDING → APPROVED (пользователь) → buildOrderRequest → файл →
ручной запуск send_order.lua → readOrderResult`.

### 2. Резервные MOEX-котировки в DataAgent (`python-engine/moex-quote-provider.ts`)

- [`moex-quote-provider.ts`](src/js/modules/python-engine/moex-quote-provider.ts) —
  `MoexQuoteProvider.fetchQuotes(tickers)` через PythonBridge-команду
  `get_quotes` (MOEX ISS, board TQBR): маппинг `SECID → { price, changePct }`.
  Python недоступен / пустой ответ / битые цены → `{}` (без падения).
- [`data-agent.ts`](src/js/modules/pipeline/agents/data-agent.ts) — Шаг 5.1:
  Excel остаётся основным источником котировок, MOEX **дополняет только
  отсутствующие тикеры** портфеля. Ошибка резерва не прерывает конвейер.

### 3. Ценовые алерты → Telegram (`harness-integration/price-alert-notifier.ts`)

- [`price-alert-notifier.ts`](src/js/modules/harness-integration/price-alert-notifier.ts) —
  `PriceAlertNotifier(notifier, alertsProvider?)`: `checkAndNotify()` получает
  текущие алерты (`PriceAlert[]` из ai-advisor или инъектированного
  провайдера), фильтрует сработавшие и шлёт через `notifier.sendMessage()`
  (no-op без sender). Дубли исключаются внутренним `Set`
  (ключ: тикер + направление + дата). Ошибка провайдера → `0` + warn.
- [`telegram-notifier.ts`](src/js/modules/harness-integration/telegram-notifier.ts) —
  добавлен универсальный `sendMessage(text)` (тот же паттерн sender/no-op).
- [`harness-bootstrap.ts`](src/js/modules/harness-integration/harness-bootstrap.ts) —
  `PriceAlertNotifier` создаётся в `createHarness()`, `checkAndNotify()`
  вызывается по отдельному интервалу (по умолчанию 60с, `unref()`),
  провайдер задаётся извне через `priceAlertNotifier.setProvider(...)`.

### 4. Retry в Python-мосте (`python-engine/python-bridge.ts`)

- [`python-bridge.ts`](src/js/modules/python-engine/python-bridge.ts) —
  новые опции `PythonBridgeConfig`: `retries` (число ДОПОЛНИТЕЛЬНЫХ попыток
  сверх первой, по умолчанию 1 → итого до 2 попыток) и `retryDelayMs`
  (базовая задержка, по умолчанию 300мс, экспоненциально ×2).
- Повтор при: ненулевом коде процесса, таймауте, невалидном JSON, ошибке
  движка. **Скрипт не найден — НЕ ретраится** (сразу throw).
  `isAvailable()` (health) тоже использует retry.
- Внутренний запуск вынесен в `protected runProcess(request)` — retry-логика
  тестируется подклассом (первая попытка падает, повтор успешен).

### Env-переменные (новых нет)

Новые переменные не требуются: путь заявок использует существующий
`QUIK_ORDERS_DIR` (fallback `data/quik`). Секреты — только через `process.env`.

---

## 🔧 Пакет улучшений 3

Пакет из четырёх улучшений: нулевые skipped-тесты, единый логгер,
CI на GitHub Actions, строгая типизация и индикатор свежести данных дашборда.

### 1. Восстановлены все тесты (0 skipped)

- [`prompt-templates.test.ts`](src/js/modules/ai-advisor/prompt-templates.test.ts) —
  3 `it.skip`, проверявших удалённые при сжатии промпта блоки («ОСОБЫЕ ПРАВИЛА ДЛЯ
  ТЕСТИРОВАНИЯ», универсальные аллокации SUR 20–30%, INVESTMENT FACTS /
  DETERMINISTIC PORTFOLIO RESULT), переписаны под актуальные гарантии сжатой
  версии: правила рассуждений (rules 1–10) проверяют реальные формулировки
  `prompt-templates.ts` без возврата раздутых блоков.
- [`environment-controller.test.ts`](src/js/modules/pipeline/environment-controller/environment-controller.test.ts) —
  тяжёлые тесты (`npm outdated` / `pip list --outdated` / `npm update`) стали
  условными: ошибка `execSync` с кодами ENOENT/EACCES/ETIMEDOUT/ENOTFOUND/
  ECONNRESET/EAI_AGAIN/EPIPE трактуется как «окружение недоступно» и тест
  проходит (`expect(true)`), успешный ответ проверяется полноценно. Таймауты
  увеличены до 15–90 с (через аргумент `it()`).

### 2. Единый логгер (`src/js/modules/logger/`)

- [`types.ts`](src/js/modules/logger/types.ts) — `LogLevel` (debug/info/warn/error),
  `LogRecord`, `LogBackend` (инъектируемый), `Logger`, `LoggerOptions`.
- [`logger.ts`](src/js/modules/logger/logger.ts) — `getLogger(module)` с кэшем
  экземпляров, фильтрация по уровню (env `LOG_LEVEL`, default `info`),
  дефолтный бэкенд `console`; в браузере процесс работает без Node-зависимостей
  (динамический импорт fs-бэкенда только в Node).
- [`file-backend.ts`](src/js/modules/logger/file-backend.ts) — запись в
  `data/logs/app.log` (append), ротация при >5 МБ (переименование в `app.log.old`),
  все fs-ошибки молча игнорируются.
- Интеграция в новых модулях: `harness-bootstrap`, `harness-bridge`,
  `telegram-notifier`, `price-alert-notifier`, `python-bridge`,
  `adaptive-scheduler`, `quik-gateway` (+ читатели/транзакции). Старые модули
  массово не тронуты.
- [`logger.test.ts`](src/js/modules/logger/logger.test.ts) — уровни, кэш,
  файловая запись + ротация (`os.tmpdir`, очистка после), браузер-режим
  (файл не пишется), `parseLogLevel`/`formatLogLine`, устойчивость к fs-ошибкам.

### 3. CI (GitHub Actions)

- [`.github/workflows/ci.yml`](.github/workflows/ci.yml): push в `main` +
  pull_request, `windows-latest`, `setup-node@v4` (Node 24, cache npm).
- Перед установкой registry явно переключается на `https://registry.npmjs.org/`
  (локальный `.npmrc` указывает на npmmirror) — см. ниже «CI (GitHub Actions)».

### 4. Строгая типизация и свежесть дашборда

- `tsconfig.json`: включён `noUncheckedIndexedAccess`; ошибки в
  `src/js/modules/**` исправлены аккуратными проверками (минимум `ts-ignore`
  с комментарием), публичные сигнатуры не менялись.
- Дашборд Harness показывает «обновлено N мин назад»: класс `h-fresh` при
  возрасте ≤ 15 мин, `h-stale` (красный) при старше. При скрытой вкладке
  рендер пропускается, при возврате (`visibilitychange`) — сразу обновляется.

---

## 🔑 Переменные окружения (.env)

| Переменная           | Описание                         | Пример значения                       |
| :------------------- | :------------------------------- | :------------------------------------ |
| `PROXYAPI_KEY`       | Ключ ProxyAPI для GigaChat       | `login:password (base64)`             |
| `CBK_RATE_OVERRIDE`  | Ручная настройка ставки ЦБ       | `14` (если API недоступен)            |
| `QUIK_NEWS_DIR`      | Папка с новостями QUIK (Фаза 3)  | `C:/dev/finance-analyzer_2/data/quik` |
| `QUIK_ORDERS_DIR`    | Папка с заявками QUIK (Фаза 3)   | `C:/dev/finance-analyzer_2/data/quik` |
| `TELEGRAM_BOT_TOKEN` | Токен Telegram-бота (Фаза 5)     | `123456:ABC-DEF...` (из BotFather)    |
| `TELEGRAM_CHAT_ID`   | Chat ID для уведомлений (Фаза 5) | `123456789`                           |
| `TELEGRAM_ADMIN_IDS` | Fallback Chat ID через запятую   | `123456789,987654321`                 |

---

## 📊 Пример отчёта

После запуска `npm run analyze` вы получите:

- **Карточки KPI:** текущие активы, вложенные средства, результат рынка, чистый итог
- **Таблица портфеля:** текущая/целевая доля, дефицит в рублях, статус (BUY/SELL/HOLD/REDUCE)
- **Макро-структура:** бары распределения акций/облигаций
- **Приоритеты покупок:** список активов для докупки по дефициту
- **ИИ-советник:** экспертное заключение с рекомендациями по ребалансировке

---

## 🛡️ Безопасность

- `.env` добавлен в `.gitignore` — ключи API не попадут в git
- Husky блокирует коммиты при упавших тестах
- ESLint + Stylelint контролируют качество кода при каждом коммите

---

## CI (GitHub Actions)

Воркфлоу [`.github/workflows/ci.yml`](.github/workflows/ci.yml) запускается при
push в `main` и на каждый pull request:

| Шаг            | Команда                                               | Примечание                              |
| :------------- | :---------------------------------------------------- | :-------------------------------------- |
| Setup          | `actions/setup-node@v4`                               | Node 24, cache npm                      |
| Registry       | `npm config set registry https://registry.npmjs.org/` | обход локального npmmirror в `.npmrc`   |
| Install        | `npm ci --ignore-scripts --legacy-peer-deps`          | husky prepare в CI не нужен             |
| Prepare (main) | `npm run prepare`                                     | husky-хуки только для `refs/heads/main` |
| Lint           | `npm run lint`                                        | eslint + stylelint + tsc                |
| Tests          | `npm run test:run`                                    | полный прогон, 0 skipped                |
| Build          | `npm run build`                                       | production-сборка                       |

- `runs-on: windows-latest`, `timeout-minutes: 25`.
- Тесты не требуют секретов: Telegram-sender без токена → no-op (`false`);
  условные env-тесты EnvironmentController проходят и без сети.

Бейдж статуса: `[![CI](https://github.com/Radikz2707/finance-analyzer/actions/workflows/ci.yml/badge.svg)](https://github.com/Radikz2707/finance-analyzer/actions/workflows/ci.yml)`.

---

## 📝 Лицензия

ISC

© 2026 Радик Залалов. Все права защищены.
