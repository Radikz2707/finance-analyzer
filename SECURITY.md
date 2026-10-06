# 🔐 Руководство по безопасности (SECURITY)

Модель угроз, слои защиты и правила разработки для мультиагентного конвейера. Документ описывает, **как именно** система защищает ключи API, данные портфеля, файловую систему и процессы, и что обязан делать разработчик при добавлении нового агента или команды.

Смежные документы: [`ARCHITECTURE.md`](ARCHITECTURE.md:1) (архитектура и поток данных), [`CONTRIBUTING.md`](CONTRIBUTING.md:1) (процесс разработки и чек-лист PR), [`AI-AGENT-PLAN.md`](AI-AGENT-PLAN.md:1) (мастер-план), [агенты конвейера](src/js/modules/pipeline/agents/README.md:1) (каталог агентов).

---

## 1. Модель угроз

### Что мы защищаем

| Актив                                   | Где живёт                                                                                                           | Риск при компрометации                                                        |
| :-------------------------------------- | :------------------------------------------------------------------------------------------------------------------ | :---------------------------------------------------------------------------- |
| **Ключи API и токены**                  | `.env` (`TELEGRAM_BOT_TOKEN`, `OPENROUTER_API_KEY`, `GIGACHAT_API_KEY`, `YANDEXGPT_API_KEY`, `FINAM_API_KEY` и др.) | Списание средств, утечка переписки, подмена AI-ответов                        |
| **Данные портфеля**                     | Excel-файл QUIK (`EXCEL_FILE_PATH`), `data/*.json`, SQLite-БД                                                       | Финансовый ущерб от неверных рекомендаций, утечка персональных данных         |
| **Файловая система проекта**            | `src/`, `gulp/`, `data/`, конфиги `.vscode/`                                                                        | Удаление/порча кода, внедрение вредоносного кода через манифесты              |
| **Процессы**                            | процессы, запускаемые `ProcessAgent`/`TerminalAgent`                                                                | Исполнение произвольного кода, утечка окружения                               |
| **Инвестиционные решения пользователя** | рекомендации Director/Consilium                                                                                     | Убытки от опасных рекомендаций ИИ (SELL/EXIT по «восстановительным» позициям) |

### Кто угроза

- **Ошибочные/злонамеренные запросы к Director** — LLM может сгенерировать «заявку на действие» (удалить файл, выполнить команду), которая опасна сама по себе.
- **Инъекции в команды** — символы `; | & \` $() %0a \r \n`в команде или аргументах, попытка обойти whitelist (например,`rm -rf`, `sudo`, `del`, редиректы в системные пути).
- **Выход за пределы корней** — `../`, абсолютные пути вне `process.cwd()`.
- **Фишинг-новости** — недостоверные источники, влияющие на рекомендации ИИ.
- **Опасные рекомендации ИИ** — продажа актива в статусе `RECOVERY_ONLY`, фиксация глубоких убытков.

---

## 2. Слои защиты (по коду)

Защита построена как **несколько независимых слоёв**: даже если один слой пропустит операцию, её остановит или потребует подтверждения следующий.

### 2.1 SecurityAgent — центральный вердикт перед действием

[`security-agent.ts`](src/js/modules/pipeline/agents/security-agent.ts:1)

Вспомогательный агент-контролёр (не участник консилиума). Принимает «заявку на действие» [`SecurityActionRequest`](src/js/modules/pipeline/agents/security-agent.ts:52) с типом `file | terminal | http | process` и возвращает вердикт [`SecurityDecision`](src/js/modules/pipeline/agents/security-agent.ts:76):

- `allow` — операция безопасна;
- `deny` — операция запрещена (с `reason`);
- `require-confirmation` — требуется подтверждение человека (human-in-the-loop, с `dangerLevel` и описанием риска).

Правила (см. шапку файла):

1. Пути — только внутри разрешённых корней (выход за корень → `deny`).
2. Команды — whitelist + blacklist паттернов + запрет символов инъекций (правила переиспользуются из TerminalAgent — единый источник истины).
3. Опасные действия (удаление, системные пути, `.env`, `.git`, `node_modules`) → `require-confirmation`.
4. HTTP — только `https` и whitelist хостов: `moex.com`, `cbr.ru`, `finam.ru`, `investing.com`.
5. Процессы — после проверки blacklist/инъекций всегда `require-confirmation` (высокий уровень опасности).

Все вердикты пишутся в собственную историю (`getDecisions()`) и, при наличии аудит-лога, в `AuditLog` как события `security.decision`.

### 2.2 FileAgent — валидация путей

[`file-agent.ts`](src/js/modules/pipeline/agents/file-agent.ts:1)

- Работа **только внутри разрешённых корней** (`roots`, по умолчанию `process.cwd()`); `resolveSafe()` нормализует путь и блокирует выход через `../` или абсолютные пути вне корня.
- Хелпер `isInside(root, target)` — единая функция изоляции, переиспользуется всеми агентами (Security, Config, History, Package, Process, AutoRepair).
- **deny-список на удаление** (`deleteDenyList`, по умолчанию `.git`, `node_modules`); запрещено удаление самого корня.

### 2.3 TerminalAgent — whitelist команд, blacklist, инъекции, spawn без shell

[`terminal-agent.ts`](src/js/modules/pipeline/agents/terminal-agent.ts:1)

- **Whitelist** (`TERMINAL_ALLOWED_COMMANDS`): read-команды (`ls/dir/cat/type/grep/findstr/find/head/tail/wc/pwd/echo`), `npm/npx/node`, `git`. Git — только подкоманды `commit/push/branch/status/log`; npm — только подстроки `install/update/run/build`.
- **Blacklist** (`TERMINAL_DENY_PATTERNS`): `rm -rf`, `sudo`, `del`, `format`, `mkfs`, `mkswap`, `fdisk`, `dd of=`, `shutdown/reboot/halt/poweroff`, `rmdir /`, `reg delete/add`, `taskkill/kill -9/pkill -9`, редиректы в системные пути (Windows/Unix).
- **Символы инъекций** (`TERMINAL_INJECTION_CHARS`): `; | & \` $\() ${ %0a %0d \r \n` — блокируются в команде и аргументах.
- **Выполнение через `child_process.spawn` БЕЗ shell** — интерпретация оболочкой невозможна.
- **Таймаут** по умолчанию 60 с (настраивается), **лимит вывода** 256 КБ (`truncated: true`), журнал команд до 100 записей (превью по 500 символов).
- `cwd` команды — всегда внутри разрешённых корней (иначе конструктор бросает ошибку).

### 2.4 Guardrails — защита инвестиционных рекомендаций

[`guardrails/guardrails.ts`](src/js/modules/pipeline/guardrails/guardrails.ts:1)

Работает на уровне решений директора, **выше** агентов:

- `RECOVERY_ONLY_BLOCK` — блокировка `SELL/EXIT/REDUCE` для активов в статусе `RECOVERY_ONLY`;
- `SELL_LIMIT` / `EXIT_LIMIT` — ограничения на вывод с фиксацией убытков;
- рекомендации восстановления (`AVG_DOWN / HOLD / SUBSIDIZE`) с уровнями поддержки.

Контекст guardrails подгружается в AI Agent ([`ai-agent.ts`](src/js/modules/pipeline/agents/ai-agent.ts:30)) до генерации рекомендаций.

### 2.5 Gatekeeper — входной фильтр новостей

[`gatekeeper/gatekeeper.ts`](src/js/modules/pipeline/gatekeeper/gatekeeper.ts:1)

- Сбор новостей из доверенных источников: QUIK OnNews, MOEX API, RSS-ленты, Google News.
- Нормализация, фильтрация по тикерам из БД, дедупликация по content hash, приоритизация (`critical/high/medium/low/noise`), отсечение шума.
- В pipeline попадают только **одобренные** новости — это ограничивает влияние фейковых новостей на рекомендации.

### 2.6 Валидация .env при старте

[`env-validation.ts`](src/js/config/env-validation.ts:1)

- Модуль без зависимостей и side-effect'ов; чтение `process.env` только внутри `validateEnv()/assertEnvValid()`.
- [`ENV_SCHEMA`](src/js/config/env-validation.ts:40) — схема ключей: обязательный минимум `EXCEL_FILE_PATH` (без него анализ бессмыслен); токены проверяются по формату `token`; пустые опциональные ключи дают `warning`, а не `error` (fallback-режимы: MOEX без Finam, Ollama локально, Telegram no-op).
- Каждый новый ключ окружения обязан попасть в `ENV_SCHEMA` + `.env.template` + тест валидатора (см. чек-лист в [`CONTRIBUTING.md`](CONTRIBUTING.md:269)).

### 2.7 Аудит-логи — полный след действий

- [`audit/audit-log.ts`](src/js/modules/pipeline/audit/audit-log.ts:1) — `AuditLog`: in-memory лог (до 1000 записей) событий `agent.start/stop/error/retry`, `pipeline.*`, `review.*`, `command.director/override/approve/reject/modify`, **`security.decision`**, `iteration.complete`.
- [`director/director-audit.ts`](src/js/modules/pipeline/director/director-audit.ts:1) — `DirectorAuditLog`: полный trace решения Director (`USER QUESTION → INTERPRETATION → TASKS → RESULTS → CONSILIUM → SYNTHESIS → RECOMMENDATION`), до 500 записей, выборка по задаче.
- [`history-agent.ts`](src/js/modules/pipeline/agents/history-agent.ts:1) — события «запуск → результат» всех агентов с `runId`, поиск и экспорт (экспорт — только внутри корней).
- Пользовательские команды `/log`, `/status`, `/panel`, `/undo` читают эти логи ([`director-chat-commands.ts`](src/js/modules/pipeline/director/director-chat-commands.ts:1)).

### 2.8 Сетевые операции

- [`browser-agent.ts`](src/js/modules/pipeline/agents/browser-agent.ts:1) — `fetch-page` только `https` + whitelist доменов, лимит контента 200 КБ, таймауты; браузер — только fallback для цен; без шлюза честный «нет данных».
- [`gatekeeper`](src/js/modules/pipeline/gatekeeper/gatekeeper.ts:1) и `SecurityAgent` задают белый список HTTP-хостов (`moex.com`, `cbr.ru`, `finam.ru`, `investing.com`).

### 2.9 Процессы и зависимости

- [`process-agent.ts`](src/js/modules/pipeline/agents/process-agent.ts:1) — spawn без shell, whitelist TerminalAgent (+ `python/python3/gulp`), чёрный список и инъекции — те же, что у TerminalAgent; `cwd`/бинар — внутри корней; остановка `SIGTERM → 5с → SIGKILL`.
- [`package-agent.ts`](src/js/modules/pipeline/agents/package-agent.ts:1) — все команды выполняются **только через TerminalAgent**; манифесты — только в корне; `dryRun: true` по умолчанию; мутации при error-конфликтах блокируются.
- [`auto-repair-agent.ts`](src/js/modules/pipeline/agents/auto-repair-agent.ts:1) — `autoFix: false` по умолчанию; `npm update` автоматически не выполняется (только предлагается команда); `.env` восстанавливается из `.env.template` с `.bak`; git/npm — через инжектируемый терминал.

---

## 3. Секреты

- **`.env` не попадает в репозиторий**: файл исключён (`.gitignore` / `.codeassistantignore`); в репозитории есть только шаблон [`.env.template`](.env.template:1). Проверьте перед коммитом: `git check-ignore .env`.
- **Ключи читаются только из `process.env`** — никогда не хардкодьте токены в исходниках, README, логах или отчётах.
- **Pre-commit**: рекомендован хук проверки секретов (например, `gitleaks`) поверх существующего [`husky`](.husky/pre-commit:1).
- **При утечке ключа**: немедленно отозвать/перевыпустить его у провайдера; ключи из истории git считаются скомпрометированными навсегда.
- **Отчёты** (`report.html`, `report.md`) генерируются и игнорируются git'ом — при пересылке убедитесь, что в них нет токенов.

---

## 4. Работа с системой

- **Почему команды идут только через TerminalAgent:** `spawn` без shell исключает интерпретацию метасимволов; whitelist + blacklist + таймауты + лимит вывода превращают «терминал» в управляемый инструмент, а не в полный доступ к ОС. Никогда не вызывайте `child_process.exec`/`spawn('cmd /c ...')` напрямую из агента — только через TerminalAgent или ProcessAgent.
- **Почему пути — только внутри корней:** нормализация через `path.resolve` + `isInside(root, target)` гарантирует, что агент не прочитает/не удалит файлы за пределами проекта (`.env`, системные каталоги). Все action-агенты (File/Security/Config/History/Package/Process/AutoRepair) обязаны резолвить пути через корни.
- **Подтверждение опасных действий (human-in-the-loop):** вердикт `require-confirmation` от SecurityAgent означает, что действие показывается пользователю. Механика чата:
  - `/panel` — панель управления агентами (карточки, цепочки, история, вердикты безопасности);
  - `/undo` — отмена последнего действия (ограниченная: если механика отката не предоставлена, это честно сообщается — механика не имитируется);
  - `/status`, `/log [N]`, `/help` — состояние и журнал.

  См. [`director-chat-commands.ts`](src/js/modules/pipeline/director/director-chat-commands.ts:1) и [`director.ts`](src/js/modules/pipeline/director/director.ts:158).

---

## 5. Чек-лист разработчика (добавление агента)

При добавлении агента или новой команды обязательны следующие проверки (полный чек-лист PR — в [`CONTRIBUTING.md`](CONTRIBUTING.md:264)):

- [ ] **Безопасный резолв путей:** любой пользовательский/LLM-путь проходит `path.resolve` + `isInside(root, …)`; никогда не склеивайте пути через `path.join` с необработанным вводом; запрещён `../`-выход и абсолютные пути вне корней.
- [ ] **Whitelist команд:** новые команды выполняются через TerminalAgent/ProcessAgent; при расширении whitelist — осознанно, с обоснованием; raw `spawn`/`exec` в агентах запрещён.
- [ ] **dryRun для побочных эффектов:** действия, меняющие файлы/пакеты/конфиги, по умолчанию `dryRun: true` (возвращают план), реальное применение — только по явному флагу и/или после `require-confirmation`.
- [ ] **Escaping HTML в виджетах:** любые данные из LLM/файлов, попадающие в HTML-отчёты и дашборд-виджеты, экранируются (защита от XSS).
- [ ] **Запрет `as any` на критичных путях:** не снимайте типы на границах безопасности (пути, команды, вердикты, env-ключи) — это зона, где типобезопасность = безопасность.
- [ ] **Новые .env-ключи** добавлены в [`ENV_SCHEMA`](src/js/config/env-validation.ts:40) + `.env.template` + тест валидатора; секреты не логируются.
- [ ] **Аудит:** действия агента пишутся в историю (HistoryAgent) и/или аудит-лог; опасные операции проходят SecurityAgent (вердикт попадает в `AuditLog` как `security.decision`).
- [ ] **Тесты безопасности:** для action-агентов — тесты deny-сценариев (образцы: [`terminal-agent.test.ts`](src/js/modules/pipeline/agents/terminal-agent.test.ts:1), [`file-agent.test.ts`](src/js/modules/pipeline/agents/file-agent.test.ts:1), [`security-agent.test.ts`](src/js/modules/pipeline/agents/security-agent.test.ts:1)).
- [ ] **Документация:** обновлены каталог [агентов](src/js/modules/pipeline/agents/README.md:1) и, при изменении публичного API, [`ARCHITECTURE.md`](ARCHITECTURE.md:1).

---

## 6. Известные ограничения (зафиксированные в коде)

- **Per-process RSS/CPU на Windows недоступны** через стандартный Node API — ProcessAgent собирает `uptime/status/exitCode/outputTail` ([`process-agent.ts`](src/js/modules/pipeline/agents/process-agent.ts:22)).
- **Static semver-резолвер отсутствует**: `check-conflicts`/`resolve-conflicts` PackageAgent используют эвристику сравнения максимальных версий, полный интерсект требует сети ([`package-agent.ts`](src/js/modules/pipeline/agents/package-agent.ts:8)).
- **`npm update` в AutoRepairAgent автоматически не выполняется** (рискованно) — только предлагается команда.
- **`BrowserGateway.navigate()`** пока не реализован в продакшене: агент работает с минимальным контрактом `BrowserGatewayLike` и честно возвращает «нет данных» без шлюза ([`browser-agent.ts`](src/js/modules/pipeline/agents/browser-agent.ts:30)).
- **`/undo`** имеет ограниченную механику: без предоставленного колбэка отката действие не имитируется, об этом честно сообщается ([`director-chat-commands.ts`](src/js/modules/pipeline/director/director-chat-commands.ts:12)).
