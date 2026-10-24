# 🔄 Интеграция News Module со всеми агентами

## 📊 Полный список агентов и их связь с новостями

```
┌─────────────────────────────────────────────────────────────────────┐
│                    АГЕНТЫ И ИХ СВЯЗЬ С НОВОСТЯМИ                    │
├──────────────────────┬──────────────────────────────────────────────┤
│  DataAgent           │ ✅ ГЛАВНЫЙ ИСТОЧНИК — собирает новости        │
│  ResearchAgent       │ ✅ Использует новости для исследования        │
│  AnalysisAgent       │ ✅ Учитывает новости в анализе                │
│  AiAgent             │ ✅ Передаёт новости в LLM                    │
│  StrategistAgent     │ ⚡ Анализирует влияние новостей на стратегию  │
│  ScenarioAgent       │ ⚡ Строит сценарии «что если» с новостями     │
│  LearningAgent       │ ⚡ Обучается на влиянии новостей на цены      │
│  GoalAgent           │ ⚡ Создаёт цели из критических новостей        │
│  SecurityAgent       │ 🔒 Проверяет URL источников новостей          │
│  NotificationAgent   │ 🔔 Уведомляет о критических новостях          │
│  DirectorAgent       │ 👑 Показывает новости директору               │
└──────────────────────┴──────────────────────────────────────────────┘
```

---

## 1️⃣ DataAgent — ГЛАВНЫЙ ИСТОЧНИК

**Файл:** `src/js/modules/pipeline/agents/data-agent.ts`

**Что делает:**
- ✅ Собирает новости из MOEX, RSS, QUIK
- ✅ Сохраняет в БД (newsRepo)
- ✅ Передаёт в PipelineCoordinator

**Интеграция News Module:**
```typescript
// В DataAgent.execute() заменить Gatekeeper на NewsCollector
import { NewsCollector } from '../../news/index.js';

// Шаг 9: NewsCollector вместо Gatekeeper
const collector = new NewsCollector();
const newsResult = await collector.collect();

// Сохранение в БД
for (const item of newsResult.items) {
  newsRepo.addProcessed({
    title: item.raw.title,
    date: item.raw.publishedAt,
    source: item.raw.source,
    url: item.raw.url,
    importance: toNewsImportance(item.priority),
    sentiment: item.sentiment.sentiment,
    summary: item.raw.summary,
    relevanceToTicker: ticker,
  });
}
```

---

## 2️⃣ ResearchAgent — Использование новостей

**Файл:** `src/js/modules/pipeline/agents/research-agent.ts`

**Что делает:**
- ✅ Исследует активы (фундаментал, конфликты)
- ⚡ ДОЛЖЕН использовать новости для контекста

**Интеграция:**
```typescript
protected async executeInternal(input: {
  data: DataAgentOutput;
  learningContext?: string;
  newsContext?: DataAgentOutput['news']; // ← Добавить
}): Promise<ResearchAgentOutput> {
  
  // Использовать новости для исследования
  const newsData = input.newsContext
    ? formatNewsForLLM(input.newsContext)
    : '';
  
  if (newsData) {
    this.log.info(`[ResearchAgent] 📰 Новостной контекст: ${newsData.substring(0, 200)}...`);
  }
}
```

---

## 3️⃣ AnalysisAgent — Анализ с учётом новостей

**Файл:** `src/js/modules/pipeline/agents/analysis-agent.ts`

**Что делает:**
- ✅ Математика портфеля (доли, отклонения, P&L)
- ⚡ ДОЛЖЕН учитывать новости в анализе

**Интеграция:**
```typescript
protected async executeInternal(input: {
  data: DataAgentOutput;
  research: ResearchAgentOutput;
  newsContext?: DataAgentOutput['news']; // ← Добавить
}): Promise<AnalysisAgentOutput> {
  
  // Учитывать новости при анализе рисков
  if (input.newsContext) {
    const criticalNews = input.newsContext.approvedNews.filter(
      n => n.priority === 'critical' || n.priority === 'high',
    );
    
    if (criticalNews.length > 0) {
      this.log.warn(
        `[AnalysisAgent] ⚠️ Критические новости: ${criticalNews.length} ` +
        `(${criticalNews.map(n => n.title).join(', ')})`,
      );
    }
  }
}
```

---

## 4️⃣ AiAgent — Передача новостей в LLM

**Файл:** `src/js/modules/pipeline/agents/ai-agent.ts`

**Что делает:**
- ✅ Уже интегрирован (передаёт новости в LLM)
- ✅ Использует NewsDriver для корректировки рекомендаций

**Статус:** ✅ ГОТОВО

---

## 5️⃣ StrategistAgent — Анализ влияния новостей на стратегию

**Файл:** `src/js/modules/pipeline/agents/strategist-agent.ts`

**Что делает:**
- ⚡ Оценивает структуру портфеля, концентрацию, риски
- ⚡ ДОЛЖЕН учитывать новости при оценке

**Интеграция:**
```typescript
export interface StrategistAgentInput {
  assetsAnalysis: AssetAnalysis[];
  proposals: StrategistProposal[];
  newsContext?: GatekeeperResult; // ← Добавить
}

protected async executeInternal(input: StrategistAgentInput): Promise<StrategistAgentOutput> {
  const assetsAnalysis = input?.assetsAnalysis ?? [];
  const proposals = input?.proposals ?? [];
  const newsContext = input?.newsContext ?? null; // ← Добавить

  // Если есть критические новости по активу — предупреждение
  if (newsContext) {
    for (const proposal of proposals) {
      const criticalNews = newsContext.approvedNews.filter(
        n => n.priority === 'critical' && n.relevantTickers.includes(proposal.ticker),
      );
      
      if (criticalNews.length > 0) {
        decisions.push({
          ticker: proposal.ticker,
          name: proposal.ticker,
          suggestedAction: proposal.action,
          finalAction: proposal.action,
          drawdownPercent: null,
          concentrationPercent: null,
          note: `⚠️ КРИТИЧЕСКИЕ НОВОСТИ: ${criticalNews.map(n => n.title).join('; ')}`,
        });
      }
    }
  }
}
```

---

## 6️⃣ ScenarioAgent — Сценарии с учётом новостей

**Файл:** `src/js/modules/pipeline/agents/scenario-agent.ts`

**Что делает:**
- ⚡ Строит сценарии «что если»
- ⚡ ДОЛЖЕН учитывать новости при построении сценариев

**Интеграция:**
```typescript
export interface ScenarioAgentInput {
  assetsAnalysis: AssetAnalysis[];
  totalPortfolioValue: number;
  freeCashRub: number;
  proposedChanges: ScenarioChange[];
  newsContext?: GatekeeperResult; // ← Добавить
}

protected async executeInternal(input: ScenarioAgentInput): Promise<ScenarioAgentOutput> {
  const newsContext = input?.newsContext ?? null;
  
  // Если негативные новости → добавить сценарий «паника»
  if (newsContext) {
    const negativeNews = newsContext.approvedNews.filter(
      n => n.priority === 'critical' && n.sentiment === 'NEGATIVE',
    );
    
    if (negativeNews.length > 0) {
      scenarios.push({
        id: 'S5_news_crash',
        title: 'Критические негативные новости — паника',
        changes: negativeNews.map(n => ({
          ticker: n.relevantTickers[0],
          action: 'SELL',
          amountRub: 50000,
        })),
        structureDeviationPct: 15.5,
        projectedUnrealizedPnL: -500000,
        realizedLossRub: 0,
        verdict: 'WORSENS',
        rationale: `Критические негативные новости: ${negativeNews.map(n => n.title).join('; ')}`,
      });
    }
  }
}
```

---

## 7️⃣ LearningAgent — Обучение на новостях

**Файл:** `src/js/modules/pipeline/agents/learning-agent.ts`

**Что делает:**
- ⚡ Анализирует историю действий
- ⚡ ДОЛЖЕН обучаться на влиянии новостей на цены

**Интеграция:**
```typescript
// После сбора новостей → сохранение уроков
async function learnFromNews(news: GatekeeperResult, priceChanges: Map<string, number>) {
  const learning = new LearningAgent();
  
  for (const item of news.approvedNews) {
    const priceChange = priceChanges.get(item.relevantTickers[0]);
    
    if (priceChange && item.sentiment === 'NEGATIVE') {
      // Негативная новость → цена упала → урок «hold» плохой
      await learning.feedback({
        outcome: 'bad',
        action: `hold_${item.relevantTickers[0]}`,
        agent: 'DataAgent',
        note: `Цена упала на ${Math.round(priceChange * 100)}% после: ${item.title}`,
      });
    }
    
    if (priceChange && item.sentiment === 'POSITIVE') {
      // Позитивная новость → цена выросла → урок «buy» хороший
      await learning.feedback({
        outcome: 'good',
        action: `buy_${item.relevantTickers[0]}`,
        agent: 'DataAgent',
        note: `Цена выросла на ${Math.round(priceChange * 100)}% после: ${item.title}`,
      });
    }
  }
}
```

---

## 8️⃣ GoalAgent — Цели из новостей

**Файл:** `src/js/modules/pipeline/agents/goal-agent/goal-agent.ts`

**Что делает:**
- ⚡ Управляет целями и задачами
- ⚡ ДОЛЖЕН создавать цели из критических новостей

**Интеграция:**
```typescript
// После сбора новостей → создание целей
async function createGoalsFromNews(news: GatekeeperResult, goalAgent: GoalAgent) {
  for (const item of news.approvedNews) {
    if (item.priority === 'critical') {
      await goalAgent.execute({
        action: 'add',
        params: {
          name: `Реакция на: ${item.title}`,
          description: item.summary,
          type: 'alert',
          priority: 'critical',
          tags: item.relevantTickers,
          deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
      });
    }
  }
}
```

---

## 9️⃣ SecurityAgent — Проверка источников

**Файл:** `src/js/modules/pipeline/agents/security-agent.ts`

**Что делает:**
- ✅ Проверяет URL источников новостей
- ✅ Whitelist хостов (moex.com, rbc.ru, interfax.ru)

**Статус:** ✅ ГОТОВО (уже проверяет HTTP-хосты)

---

## 🔟 NotificationAgent — Уведомления

**Файл:** `src/js/modules/pipeline/agents/notification-agent.ts`

**Что делает:**
- 🔔 Пишет report.html и report.md
- 🔔 ДОЛЖЕН включать новости в отчёты

**Интеграция:**
```typescript
protected async executeInternal(input: {
  data: DataAgentOutput;
  research: ResearchAgentOutput;
  analysis: AnalysisAgentOutput;
  newsContext?: DataAgentOutput['news']; // ← Добавить
}): Promise<NotificationAgentOutput> {
  
  // Включить новости в HTML-отчёт
  if (input.newsContext) {
    const newsHtml = buildNewsHtml(input.newsContext);
    reportHtml += newsHtml;
  }
}
```

---

## 1️⃣1️⃣ DirectorAgent — Показ новостей директору

**Файл:** `src/js/modules/pipeline/director/director.ts`

**Что делает:**
- 👑 Показывает новости директору в чате
- 👑 ДОЛЖЕН использовать NewsDriver для анализа

**Статус:** ✅ ГОТОВО (уже использует NewsDriver)

---

## 📋 План интеграции

### Шаг 1: Обновить DataAgent (1 день)
- [ ] Заменить Gatekeeper на NewsCollector
- [ ] Подключить все источники (MOEX, RSS, Telegram, QUIK)
- [ ] Сохранение в БД с сентиментом

### Шаг 2: Обновить ResearchAgent (0.5 дня)
- [ ] Принять newsContext из DataAgent
- [ ] Использовать новости для исследования

### Шаг 3: Обновить AnalysisAgent (0.5 дня)
- [ ] Принять newsContext из DataAgent
- [ ] Учитывать новости в анализе рисков

### Шаг 4: Обновить StrategistAgent (0.5 дня)
- [ ] Принять newsContext
- [ ] Предупреждать о критических новостях

### Шаг 5: Обновить ScenarioAgent (0.5 дня)
- [ ] Принять newsContext
- [ ] Строить сценарии «паника» при негативе

### Шаг 6: Обновить LearningAgent (0.5 дня)
- [ ] Обучаться на влиянии новостей на цены
- [ ] Сохранять уроки в память

### Шаг 7: Обновить GoalAgent (0.5 дня)
- [ ] Создавать цели из критических новостей

### Шаг 8: Обновить NotificationAgent (0.5 дня)
- [ ] Включать новости в отчёты

### Шаг 9: Desktop Integration (1 день)
- [ ] Подключить NewsCollector к DirectorAgent
- [ ] Показывать новости в чате

### Шаг 10: Тестирование (1 день)
- [ ] End-to-end тест pipeline
- [ ] End-to-end тест desktop
- [ ] Проверка всех агентов

**Итого:** ~7 дней

---

## 🎯 Результат

После интеграции:

1. **DataAgent** собирает новости из 8+ источников
2. **ResearchAgent** исследует активы с учётом новостей
3. **AnalysisAgent** учитывает новости в анализе рисков
4. **AiAgent** передаёт новости в LLM
5. **StrategistAgent** предупреждает о критических новостях
6. **ScenarioAgent** строит сценарии «паника»
7. **LearningAgent** обучается на влиянии новостей
8. **GoalAgent** создаёт цели из новостей
9. **NotificationAgent** включает новости в отчёты
10. **DirectorAgent** показывает новости директору

**Все агенты работают с новостями!** 🚀
