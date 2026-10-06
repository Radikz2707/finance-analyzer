# 🤝 Вклад в проект (CONTRIBUTING)

Руководство для разработчиков Finance Analyzer: как добавить модуль, агента
pipeline или research-провайдера, соблюсти конвенции и пройти проверки перед
pull request.

- Архитектура системы: [`ARCHITECTURE.md`](ARCHITECTURE.md:1)
- Возможности и быстрый старт: [`README.md`](README.md:1)
- Планы и статусы задач: [`AI-AGENT-PLAN.md`](AI-AGENT-PLAN.md:1)

---

## 0. Окружение

| Требование | Значение                                                                                      |
| :--------- | :-------------------------------------------------------------------------------------------- |
| Node.js    | `>= 24.0.0` (см. [`package.json`](package.json:106))                                          |
| Shell      | **Windows: cmd.exe** (не Git Bash) — см. раздел «Быстрый старт» в [`README.md`](README.md:21) |
| Установка  | `npm install --legacy-peer-deps`                                                              |

Перед коммитом `husky` сам запускает lint-staged (stylelint для SCSS) и блокирует
коммиты при падающих тестах.

---

## 1. Как добавить модуль

### Структура папки

Все модули живут в `src/js/modules/<name>/`:

```
src/js/modules/<name>/
├── <name>.ts            # реализация (публичные функции/классы)
├── types.ts             # типы и интерфейсы (если много типов)
├── index.ts             # barrel-экспорт — ЕДИНСТВЕННАЯ точка импорта извне
├── <name>.test.ts       # unit-тесты рядом с кодом
└── <name>.scss          # стили, только если модуль имеет UI (подключить в style.scss)
```

### Правила

1. **index.ts — лёгкий barrel.** Экспортируйте только публичное API:
   ```typescript
   export * from './<name>.js';
   export * from './types.js';
   ```
2. **Импорты с `.js`-суффиксом** (ESM, `"type": "module"`):
   `import { foo } from '../other-module/index.js';`
3. **Не тяните Node-зависимости в браузерный бандл.** Если модуль работает в
   браузере и Node (`fs`, `better-sqlite3`, `child_process`), вынесите Node-only
   части в отдельный файл и НЕ экспортируйте их из `index.ts`. Пример:
   [`harness-integration/index.ts`](src/js/modules/harness-integration/index.ts:9)
   сознательно не экспортирует `anomaly-source.ts` (тянет fs/sqlite).
4. **Тесты рядом**: `<name>.test.ts`. Русские названия, см. [конвенции](#5-конвенции).
5. **Данные модуля** (кэши, результаты) — в `data/` или через
   [`db-manager`](src/js/modules/db-manager/index.ts:1) (SQLite), не в корне.
6. Новый ключ `.env`? Добавьте его в [`env-validation.ts`](src/js/config/env-validation.ts:40)
   (`ENV_SCHEMA`) и в [`.env.template`](.env.template:1), затем обновите тест
   [`env-validation.test.ts`](src/js/config/env-validation.test.ts:1).

Альтернатива ручному созданию каркаса — Gulp-генератор: `npm run module`.

---

## 2. Как добавить агента pipeline

Агенты конвейера наследуют [`AgentBase`](src/js/modules/pipeline/agent/agent-base.ts:21)
и реализуют контракт [`IAgent`](src/js/modules/pipeline/agent/types.ts:65)
(`execute(input): Promise<AgentResult<Output>>`, `stop()`, `getSummary()`).

### Шаги

1. Создайте `src/js/modules/pipeline/agents/<name>-agent.ts`:

   ```typescript
   import { AgentBase } from '../agent/agent-base.js';
   import type { AgentConfig } from '../agent/types.js';

   export interface MyAgentInput {
     /* ... */
   }
   export interface MyAgentOutput {
     /* ... */
   }

   export class MyAgent extends AgentBase {
     constructor(config: AgentConfig) {
       super({ ...config, name: 'MyAgent' });
     }

     protected async executeInternal(input: unknown): Promise<unknown> {
       const data = input as MyAgentInput;
       // бизнес-логика; НЕ обрабатывайте ошибки retry/timeout — их делает AgentBase
       return {/* MyAgentOutput */};
     }
   }
   ```

   `AgentBase` уже даёт: состояние `idle/running/error/stopped`, таймаут,
   retry с exponential backoff, статистику, graceful shutdown.

2. **Опишите типы входа/выхода** в том же файле (`MyAgentInput`,
   `MyAgentOutput`). Это контракт с координатором — документируйте поля.

3. **Экспортируйте агента** в [`agents/index.ts`](src/js/modules/pipeline/agents/index.ts:1)
   по образцу существующих (класс + типы):

   ```typescript
   export {
     MyAgent,
     type MyAgentInput,
     type MyAgentOutput,
   } from './my-agent.js';
   ```

4. **Если агент должен участвовать в работе Director**:
   - добавьте роль в [`AgentRole`](src/js/modules/pipeline/director/director-types.ts:69);
   - опишите правила делегирования в
     [`delegation-planner.ts`](src/js/modules/pipeline/director/delegation-planner.ts:24)
     (роль → агент, приоритеты, метки).

5. **Подключите агента в конвейер** (если он — стадия): зарегистрируйте стадию в
   [`PipelineStage`](src/js/modules/pipeline/pipeline-coordinator.ts:40),
   добавьте имя в `STAGE_AGENT_NAMES` и вызовите из `run()` координатора.

6. **Тесты**: `agents/<name>-agent.test.ts`. Покрывайте: успех, ошибку,
   пустой вход, таймаут/retry (через малые `timeoutMs`/`retries`), формат
   `AgentResult`. Для агентов Director — также тесты планировщика/ролей.

---

## 3. Как добавить research-провайдера

Провайдер заполняет [`AssetResearchSnapshot`](src/js/modules/research/types.ts:1)
реальными данными. **Провайдер не обращается к LLM и не придумывает факты.**

### Шаги

1. Реализуйте контракт
   [`ResearchProvider`](src/js/modules/research/providers/types.ts:84):

   ```typescript
   import type {
     ResearchProvider,
     ResearchAsset,
     ResearchContext,
   } from './types.js';
   import type { AssetResearchSnapshot } from '../types.js';

   export class MyProvider implements ResearchProvider {
     supports(asset: ResearchAsset): boolean {
       return asset.assetType === 'stock' && asset.market === 'RU';
     }

     async research(
       asset: ResearchAsset,
       context: ResearchContext,
     ): Promise<AssetResearchSnapshot> {
       // заполняйте поля через value(…, evidenceId) / noData() из ../helpers.js
     }
   }
   ```

2. **Новые поля/типы** — добавляйте в
   [`research/types.ts`](src/js/modules/research/types.ts:1) и экспортируйте через
   [`research/index.ts`](src/js/modules/research/index.ts:1).

3. **Регистрация**: если провайдер боевой — зарегистрируйте фабрику/экземпляр в
   [`registry.ts`](src/js/modules/research/providers/registry.ts:1)
   (`findProviders` → `researchAll`). Merge-семантика `VALUE > NO_DATA` и
   conflict tracking уже реализованы в реестре — не дублируйте.

4. **Резервный источник** (fallback MOEX → CBR → Finam): оберните цепочку через
   [`withProviderFallback`](src/js/modules/research/providers/provider-fallback.ts:1).

5. **Тесты**: `providers/<name>-provider.test.ts`. Образцы тест-провайдеров —
   [`test-fundamentals-provider.ts`](src/js/modules/research/providers/test-fundamentals-provider.ts:1)
   и [`test-conflict-provider.ts`](src/js/modules/research/providers/test-conflict-provider.ts:1);
   семантика слияния покрыта в
   [`registry.test.ts`](src/js/modules/research/providers/registry.test.ts:1).
   Интеграционные smoke-тесты с реальными API должны быть отключаемы (без сети
   тесты не падают).

---

## 4. Процесс проверки перед PR

Все команды выполняются из **cmd.exe**.

```bat
npm run lint                 :: ESLint + Stylelint + tsc --noEmit
npm run test:run             :: весь vitest-набор (0 skipped — требование проекта)
npm run build                :: тесты + production-сборка
npm run bench                :: бенчмарки (информационные, должны завершаться кодом 0)
```

Локально быстрые итерации:

```bat
npm run test:run -- src/js/modules/<name>/<name>.test.ts   :: один файл
node node_modules/typescript/lib/tsc.js --noEmit           :: только типы
npm run test                                               :: vitest watch
```

Примечания:

- `.bench.ts` исключены из vitest-прогона
  ([`vitest.config.ts`](vitest.config.ts:16)) — не называйте тест `.bench.ts`.
- Смок-тесты с реальными API (MOEX/CBR/Finam) должны проходить без сети.
- Полный прогон в CI: lint → test:run → build
  ([`.github/workflows/ci.yml`](.github/workflows/ci.yml:1)).

---

## 5. Конвенции

### TypeScript

- `strict: true`, `noUncheckedIndexedAccess: true`, `noUnusedLocals` /
  `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch`
  (см. [`tsconfig.json`](tsconfig.json:2)).
- **`noUncheckedIndexedAccess`**: индексация `arr[i]` возвращает
  `T | undefined` — проверяйте перед использованием.
- **`as any` запрещён** (остаток — 0). Допустимы точечные `unknown`-приведения
  с комментарием; при работе с не типизированными внешними библиотеками —
  локальные минимальные контракты (пример: Chart.js в
  [`dashboard.ts`](src/js/modules/dashboard/dashboard.ts:1)).
- ESM: **все относительные импорты с `.js`** (расширение файла на диске — `.ts`).
- Модуль `telegram-bot` исключён из проверки `tsc` (см. `exclude` в
  [`tsconfig.json`](tsconfig.json:30)) — не переносите его код и не добавляйте
  новых исключений без явного разрешения.

### Тесты (Vitest)

- `globals: true` — `describe`/`it`/`expect` доступны **без импорта**.
- **Названия тестов на русском**, описательные: `it('возвращает пустой список при отсутствии данных', …)`.
- Один тест — одна проверяемая гарантия; не пишите тесты, зависящие от сети/времени.
- Новые тестовые файлы: `*.test.ts` рядом с кодом.

### Код-стиль

- ESLint: [`eslint.config.js`](eslint.config.js:1) (flat config), Prettier:
  [`.prettierrc`](.prettierrc:1). Форматирование — через Prettier перед коммитом.
- SCSS: Stylelint ([`.stylelintrc.json`](.stylelintrc.json:1)), БЭМ.
- JSDoc-шапка модуля: назначение и пример использования (по образцу
  [`quik-gateway/index.ts`](src/js/modules/quik-gateway/index.ts:1)).
- Комментарии и тексты — на русском; идентификаторы — английские.

### Архитектурные ограничения

- **LLM не источник фактов**: факты — только через research-провайдеров с
  `evidenceIds`; AI лишь интерпретирует данные.
- **QUIK-канал read-only**: отправка транзакций в QUIK запрещена; подготовка
  заявок — через `transaction-builder` + ручной запуск `quik/send_order.lua`.
- **Директор/агенты**: опасные действия проходят SecurityAgent
  (allow/deny/require-confirmation); пути — только внутри разрешённых корней.
- **Границы слоёв**: модуль не должен импортировать «вверх» (детали доставки из
  аналитики и т.п.) без необходимости; общие типы — в
  [`research/types.ts`](src/js/modules/research/types.ts:1) и `config/`.

---

## 6. Чек-лист pull request

- [ ] Новые файлы лежат в `src/js/modules/<name>/`, тесты рядом (`*.test.ts`);
- [ ] `index.ts` — лёгкий barrel; Node-only части не экспортируются в браузерный бандл;
- [ ] Импорты с `.js`; нет `as any`; нет новых исключений из `tsc`;
- [ ] Новые .env-ключи добавлены в `ENV_SCHEMA` + `.env.template` + тест валидатора;
- [ ] `npm run lint` — без ошибок;
- [ ] `npm run test:run` — весь набор зелёный, **0 skipped**;
- [ ] `npm run build` — сборка проходит;
- [ ] `npm run bench` — бенчмарки завершаются кодом 0;
- [ ] Затронутые модули: обновлён `README.md`/`ARCHITECTURE.md` при изменении
      публичного API или структуры;
- [ ] При изменении безопасности, агентов или команд: обновлены `SECURITY.md`
      и каталог `src/js/modules/pipeline/agents/README.md`;
- [ ] Описание PR: что изменилось, зачем, что тестировалось; для изменений
      поведения — скриншоты/лог.
