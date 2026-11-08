# 📰 News Module — Новостная система с динамической загрузкой данных

## 🎯 Архитектура

```
src/js/modules/news/
├── index.ts                    ← Публичное API модуля
├── news-config.ts              ← Параметры системы (флаги, лимиты, таймауты)
├── news-data-loader.ts         ← Динамическая загрузка данных
│
├── sources/                    ← Источники новостей
│   ├── index.ts
│   ├── base-source.ts          ← Базовый класс источника
│   ├── moex-source.ts          ← MOEX ISS API (официальные новости)
│   ├── rss-source.ts           ← RSS-ленты (параллельный сбор)
│   └── telegram-source.ts      ← Telegram RSS-мосты (в разработке)
│
├── nlp/                        ← NLP-анализ (Python)
│   ├── index.ts
│   ├── sentiment-analyzer.ts   ← Анализ тональности (BERT + keyword fallback)
│   ├── ner-extractor.ts        ← Извлечение сущностей (в разработке)
│   └── topic-classifier.ts     ← Классификация тем (в разработке)
│
├── ml/                         ← ML-прогнозирование (Python)
│   ├── index.ts
│   ├── forecast-engine.ts      ← Time Series Forecasting (в разработке)
│   ├── ensemble-predictor.ts   ← Ансамбль моделей (в разработке)
│   └── portfolio-optimizer.ts  ← Оптимизация портфеля (в разработке)
│
├── backtesting/                ← Backtesting рекомендаций (в разработке)
│   ├── index.ts
│   └── backtesting-engine.ts
│
├── knowledge-graph/            ← Knowledge Graph (в разработке)
│   ├── index.ts
│   ├── graph-builder.ts
│   └── context-provider.ts
│
├── events/                     ← Real-time event alerts (в разработке)
│   ├── index.ts
│   ├── event-bus.ts
│   └── alert-manager.ts
│
└── utils/                      ← Утилиты
    ├── index.ts
    ├── news-collector.ts       ← Главный класс сбора новостей
    ├── news-prioritizer.ts     ← Приоритизация (в разработке)
    └── news-formatter.ts       ← Форматирование (в разработке)
```

---

## ⚡ Быстрый старт

### 1. Сбор новостей

```typescript
import { NewsCollector } from './modules/news/index.js';

const collector = new NewsCollector();
const result = await collector.collect();

console.log(`Собрано ${result.stats.totalProcessed} новостей`);
console.log(`Источников: ${result.stats.sourcesUsed}`);
console.log(`Средний сентимент: ${result.stats.averageSentiment}`);
```

### 2. Анализ сентимента

```typescript
import { SentimentAnalyzer } from './modules/news/nlp/index.js';

const analyzer = new SentimentAnalyzer();
const sentiment = await analyzer.analyze(
  'Сбербанк увеличил прибыль на 40%',
  'Чистая прибыль за 2025 год составила 1.2 трлн ₽'
);

console.log(sentiment);
// {
//   sentiment: 'POSITIVE',
//   score: 0.85,
//   reason: 'Анализ через Python BERT',
//   isFallback: false
// }
```

### 3. Загрузка источников

```typescript
import { NewsSourceLoader } from './modules/news/index.js';

const loader = new NewsSourceLoader();
const sources = await loader.loadSources();

console.log(`Загружено ${sources.length} источников`);
for (const source of sources) {
  console.log(`- ${source.name} (priority: ${source.priority})`);
}
```

---

## 📊 Принцип: Конфиги ≠ Данные

```
❌ ХАРДКОР (нельзя):
   • URLы RSS-лент
   • Ключевые слова для фильтрации
   • Списки тикеров
   • Веса моделей

✅ ДИНАМИЧЕСКИ (можно):
   • Флаги включения/выключения
   • Интервалы и таймауты
   • Лимиты и пороги системы
   • Параметры оптимизации

📥 ИСТОЧНИКИ ДАННЫХ:
   • Config API (главный источник)
   • MOEX ISS API (официальные источники)
   • БД (health tracking, история)
   • Python ML (генерация ключевых слов)
   • Портфель пользователя (актуальные тикеры)
```

---

## 🔧 Конфигурация

Все параметры находятся в `news-config.ts`. Примеры:

```typescript
// Флаги
config.NEWS_ENABLED = true;
config.NLP_ANALYSIS_ENABLED = true;
config.ML_FORECASTING_ENABLED = true;

// Интервалы
config.NEWS_POLL_INTERVAL_MS = 5 * 60 * 1000;  // 5 минут
config.NEWS_HTTP_TIMEOUT_MS = 10_000;           // 10 секунд

// Лимиты
config.NEWS_MAX_ITEMS_PER_COLLECTION = 100;
config.NEWS_RELEVANCE_THRESHOLD = 0.3;

// Оптимизация портфеля
config.PORTFOLIO_MAX_SINGLE_ASSET = 0.30;  // Макс 30% в один актив
config.PORTFOLIO_TARGET_SHARPE_RATIO = 0.8;
```

---

## 🔄 Жизненный цикл данных

```
1. Старт системы
   ├─→ Загрузка news-config.ts (параметры)
   ├─→ Инициализация NewsSourceLoader (источники из Config API/MOEX/БД)
   ├─→ Инициализация NewsKeywordGenerator (ключевые слова из Python ML)
   └─→ Инициализация TickerMonitor (тикеры из портфеля)

2. Сбор новостей (каждые 5 минут)
   ├─→ Параллельный сбор из всех источников
   ├─→ Дедупликация по URL
   ├─→ NLP-анализ сентимента (Python BERT)
   ├─→ Фильтрация по релевантности
   ├─→ Приоритизация
   └─→ Ограничение по лимиту (100 новостей)

3. Использование
   ├─→ Pipeline → AiAgent → LLM
   └─→ Desktop → DirectorAgent → LLM

4. Обратная связь
   ├─→ Обновление весов ML-моделей
   ├─→ Обновление health tracking
   └─→ Адаптация ключевых слов
```

---

## 🚀 Следующие шаги (в разработке)

### Неделя 1-2: ✅ Выполнено
- [x] Базовая структура модуля
- [x] NewsCollector с дедупликацией и приоритизацией
- [x] SentimentAnalyzer (Python BERT + keyword fallback)
- [x] NewsSourceLoader (динамическая загрузка)
- [x] TickerMonitor (тикеры из портфеля)
- [x] Конфигурация без хардкода

### Неделя 3-4: В разработке
- [ ] Backtesting Engine
- [ ] Knowledge Graph
- [ ] Real-time Event Alerts
- [ ] Incremental Learning

### Неделя 5-6: В разработке
- [ ] ML Forecasting (ARIMA + Prophet + LSTM)
- [ ] Portfolio Optimization (Markowitz)
- [ ] Scenario Analysis
- [ ] Telegram Source

---

## 📝 Использование в gulp

Модуль создан через `gulp module --news`:

```bash
# Создание модуля (уже выполнено)
gulp module --news

# Структура создана автоматически:
# src/js/modules/news/
# ├── news.ts
# ├── news.scss
# └── img/
```

Модуль автоматически подключён в:
- `src/js/app.ts` (импорт и вызов)
- `src/scss/style.scss` (импорт стилей)

---

## 🎯 Преимущества

### 1. Гибкость
- Источники новостей меняются без перезапуска
- Ключевые слова адаптируются под пользователя
- Тикеры обновляются при изменении портфеля

### 2. Надёжность
- Fallback-цепочка (Config API → MOEX → БД)
- Health tracking автоматически отключает мёртвые источники
- Кэширование с TTL предотвращает перегрузку

### 3. Адаптивность
- ML-модели обучаются на истории пользователя
- Ключевые слова меняются со временем
- Веса моделей адаптируются к точности прогнозов

### 4. Поддерживаемость
- Нет hardcoded данных в коде
- Все данные загружаются из внешних источников
- Конфиги содержат только параметры системы
