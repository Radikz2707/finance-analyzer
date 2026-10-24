# 🚀 План улучшения новостной системы

## 📊 Текущее состояние

### Архитектура (2 независимых пути)

```
PIPELINE (CLI)                    DESKTOP (Electron)
┌─────────────────┐               ┌─────────────────────────┐
│ DataAgent       │               │ DirectorAgent            │
│ ├ Gatekeeper    │               │ ├ NewsDriver             │
│ │ RSS, MOEX,    │               │ └ NewsCache (SQLite)     │
│ │   QUIK        │               │                         │
│ └ → newsRepo    │               │ Читает из БД, что        │
│   (SQLite)      │               │   сохранил pipeline      │
└─────────────────┘               └─────────────────────────┘
        │                                  │
        ▼                                  ▼
┌─────────────────┐               ┌─────────────────────────┐
│ PipelineCoord.  │               │ Renderer (UI)            │
│ → AiAgent       │               │ appendNewsBlock()        │
│ → LLM           │               │                         │
└─────────────────┘               └─────────────────────────┘
```

### Критические проблемы

| # | Проблема | Влияние |
|---|----------|---------|
| 1 | **7 из 12 источников мёртвые** (41% работоспособности) | Мало новостей, нет охвата |
| 2 | **Google News недоступен** из РФ | Главный источник игнорируется |
| 3 | **MOEX /news.json → 404** | Используется неполный sitenews |
| 4 | **Desktop НЕ собирает новости** | Полагается на то, что pipeline сохранил |
| 5 | **LLM не участвует в анализе новостей** | Sentiment через keyword (60% точность) |
| 6 | **NewsResearchProvider гуглит Google News** | Игнорирует рабочие новости из Gatekeeper |
| 7 | **Нет health monitoring** | Не видно, какие источники не работают |
| 8 | **Regex-парсинг XML** | Ломается на malformed XML |

---

## 🎯 ЦЕЛЬ

Создать **единую новостную систему**, которая:
1. ✅ Собирает новости из 8+ рабочих источников
2. ✅ Анализирует сентимент через LLM (85-90% точность)
3. ✅ Работает в **обоих** контекстах: pipeline + desktop
4. ✅ Передаёт новости во все агенты и Director
5. ✅ Мониторит здоровье источников
6. ✅ Приоритизирует по весу тикера, времени, источнику

---

## 📋 ЭТАПЫ РЕАЛИЗАЦИИ

### ЭТАП 1: Единый модуль сбора новостей (news-collector)

**Файл:** `src/js/modules/pipeline/news/news-collector.ts`

**Задачи:**
- Создать единый класс `NewsCollector`, который работает в обоих контекстах
- Подключить рабочие источники:
  - ✅ MOEX ISS API (`/iss/news.json` — официальный, стабильный)
  - ✅ РБК Финансы (RSS)
  - ✅ Интерфакс (RSS)
  - ✅ Коммерсантъ (RSS)
  - ✅ Investing.com (RSS)
  - ✅ Habr Finance (RSS)
  - 🆕 Telegram RSS-мосты (CBA_Official, MOEX_Engine)
  - 🆕 CBR API (ключевая ставка, инфляция)
- Добавить proper XML Parser (заменить regex)
- Health monitoring для каждого источника

**Работа в pipeline:**
```typescript
// DataAgent → шаг 9
const collector = new NewsCollector({ tickers: monitoredTickers });
const results = await collector.collect();
for (const news of results.approvedNews) {
  newsRepo.addProcessed(news); // Сохраняем в SQLite
}
```

**Работа в desktop:**
```typescript
// При запуске или по таймеру (polling)
const collector = new NewsCollector({ tickers: monitoredTickers });
const results = await collector.collect();
for (const news of results.approvedNews) {
  newsRepo.addProcessed(news); // Обновляем SQLite
}
// NewsDriver автоматически читает из БД
```

---

### ЭТАП 2: LLM-powered Sentiment Analysis

**Файл:** `src/js/modules/pipeline/news/sentiment-analyzer.ts`

**Задачи:**
- Создать класс `SentimentAnalyzer`
- Вызывать LLM для анализа тональности каждой новости
- Промпт:
  ```
  Определи тональность финансовой новости:
  
  Заголовок: {title}
  Описание: {summary}
  
  Ответь в формате JSON:
  {
    "sentiment": "POSITIVE" | "NEGATIVE" | "NEUTRAL",
    "score": -1.0 .. 1.0,
    "reason": "краткое объяснение"
  }
  ```
- Кэшировать результаты в SQLite
- Fallback на keyword-матчинг если LLM недоступен

**Интеграция:**
```typescript
// В NewsCollector после сбора новостей
for (const news of results.approvedNews) {
  news.sentiment = await sentimentAnalyzer.analyze(news);
}
```

---

### ЭТАП 3: Улучшение источников и парсинга

**Файл:** `src/js/modules/pipeline/news/sources/`

**Задачи:**
- Создать единую структуру источников:
  ```
  sources/
  ├── moex-source.ts          # MOEX ISS API (приоритет 1)
  ├── rss-source.ts           # RSS-ленты (РБК, Интерфакс, Коммерсантъ)
  ├── telegram-source.ts      # Telegram RSS-мосты
  ├── cbr-source.ts           # CBR API (макро-новости)
  └── base-source.ts          # Базовый класс + health tracking
  ```
- Добавить `SourceHealthTracker`:
  - Отслеживать uptime каждого источника
  - Логировать ошибки и таймауты
  - Автоматически отключать мёртвые источники
  - UI-индикатор: «Работает 5 из 8 источников»

---

### ЭТАП 4: Подключение NewsResearchProvider к Gatekeeper

**Файл:** `src/js/modules/pipeline/agents/research-agent.ts`

**Задачи:**
- В `buildResearchContext()` передавать новости из Gatekeeper
- NewsResearchProvider должен использовать отфильтрованные новости, а не гуглить заново
- Объединить данные из обоих источников (Gatekeeper + Google News fallback)

```typescript
// ResearchAgent.buildResearchContext()
const researchContext: ResearchContext = {
  ...
  newsData: data.news?.approvedNews.map(toNewsDataItem) ?? [], // ← Добавляем
};
```

---

### ЭТАП 5: Улучшение релевантности и приоритизации

**Файл:** `src/js/modules/pipeline/news/news-impact-scorer.ts`

**Задачи:**
- Добавить вес тикера в портфеле (SBER 30% важнее, чем STNE 5%)
- Добавить время публикации (свежие новости важнее)
- Добавить вес источника (официальные важнее блогов)
- Добавить историю (много негатива за неделю → усиление)

**Формула:**
```
impact = sentiment × importance × relevance × timeDecay × sourceWeight × tickerWeight
```

---

### ЭТАП 6: Desktop-интеграция (real-time сбор)

**Файл:** `desktop/ipc-core.ts`

**Задачи:**
- При запуске desktop-приложения запустить фоновый сбор новостей
- Обновлять новости каждые N минут (настраиваемо)
- Показывать статус в UI: «Обновление новостей...»

```typescript
// В buildDirectorState()
const newsCollector = new NewsCollector({ tickers: monitoredTickers });
const newsResults = await newsCollector.collect();
for (const news of newsResults.approvedNews) {
  newsRepo.addProcessed(news);
}
// Затем создаём NewsDriver и DirectorAgent
```

---

## 🔄 ЕДИНАЯ АРХИТЕКТУРА (после улучшений)

```
┌──────────────────────────────────────────────────────────────┐
│                    NEWS COLLECTOR (единый)                    │
│                                                              │
│  sources/                                                    │
│  ├── moex-source.ts          # MOEX ISS API (приоритет 1)    │
│  ├── rss-source.ts           # RSS-ленты                     │
│  ├── telegram-source.ts      # Telegram RSS-мосты            │
│  ├── cbr-source.ts           # CBR API                       │
│  └── base-source.ts          # Health tracking               │
│                                                              │
│  sentiment-analyzer.ts       # LLM-powered sentiment         │
│  news-impact-scorer.ts       # Улучшенная формула            │
│                                                              │
└──────────────────────────────────────────────────────────────┘
              │                              │
              ▼                              ▼
┌─────────────────────────┐    ┌─────────────────────────────┐
│   PIPELINE (CLI)        │    │    DESKTOP (Electron)       │
│                         │    │                             │
│ DataAgent               │    │ При запуске / по таймеру    │
│ ├ NewsCollector         │    │ ├ NewsCollector             │
│ │ → newsRepo.add        │    │ │ → newsRepo.add            │
│ └ → PipelineCoord.      │    │ └ → NewsDriver              │
│   → AiAgent → LLM       │    │   → DirectorAgent → LLM     │
└─────────────────────────┘    └─────────────────────────────┘
              │                              │
              ▼                              ▼
┌──────────────────────────────────────────────────────────────┐
│                    SQLite (newsRepo)                          │
│                                                              │
│  Таблица news:                                               │
│  - title, summary, source, date                             │
│  - sentiment (POSITIVE/NEGATIVE/NEUTRAL)                    │
│  - sentimentScore (-1.0 .. 1.0)                             │
│  - relevanceToTicker                                        │
│  - isProcessed                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 📊 Ожидаемые результаты

| Метрика | До | После |
|---------|-----|-------|
| Рабочих источников | 5 (41%) | 8+ (80%+) |
| Точность sentiment | ~60% (keyword) | 85-90% (LLM) |
| Скорость обновления | 60 мин (фикс) | Настраиваемо (5-60 мин) |
| Health monitoring | ❌ Нет | ✅ Есть |
| Работа в desktop | ❌ Читает только БД | ✅ Собирает + читает |
| Приоритизация | Равные веса | Вес тикера, время, источник |

---

## ⚡ Приоритеты реализации

```
1️⃣  ЭТАП 1: Единый NewsCollector (1-2 дня)
    - Подключить MOEX ISS API
    - Добавить Telegram RSS
    - Добавить CBR API
    - Заменить regex на XML Parser

2️⃣  ЭТАП 2: LLM Sentiment (1 день)
    - SentimentAnalyzer класс
    - Промпт для LLM
    - Fallback на keyword
    - Кэширование в SQLite

3️⃣  ЭТАП 3: Health Monitoring (0.5 дня)
    - SourceHealthTracker
    - Логирование ошибок
    - Автоотключение мёртвых

4️⃣  ЭТАП 4: NewsResearchProvider (0.5 дня)
    - Передача новостей из Gatekeeper
    - Объединение источников

5️⃣  ЭТАП 5: Улучшение релевантности (0.5 дня)
    - Вес тикера, время, источник
    - Улучшенная формула impact

6️⃣  ЭТАП 6: Desktop real-time (0.5 дня)
    - Фоновый сбор в desktop
    - UI-индикатор статуса
```

**Общий срок:** ~5-6 дней

---

## 🎯 Ключевые принципы

1. **Единый код** — один NewsCollector для pipeline и desktop
2. **Graceful degradation** — если LLM недоступен, fallback на keyword
3. **Health tracking** — автоматически отключаем мёртвые источники
4. **Кэширование** — результаты sentiment в SQLite
5. **Настраиваемость** — интервал обновления, источники, веса
6. **Тестируемость** — mock-источники для unit-тестов
