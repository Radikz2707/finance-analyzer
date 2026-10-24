# 📰 News Module — Полная структура

## ✅ Реализовано

```
src/js/modules/news/
├── index.ts                    ← Публичное API (все экспорты)
├── news-config.ts              ← Параметры системы (без хардкода!)
├── news-data-loader.ts         ← Динамическая загрузка данных
├── README.md                   ← Документация
│
├── sources/                    ← Источники новостей
│   ├── index.ts
│   ├── base-source.ts          ← Базовый класс + Health tracking
│   ├── moex-source.ts          ← MOEX ISS API ✅
│   └── rss-source.ts           ← RSS-ленты (параллельный сбор) ✅
│
├── nlp/                        ← NLP-анализ (Python)
│   ├── index.ts
│   └── sentiment-analyzer.ts   ← Sentiment (BERT + keyword fallback) ✅
│
├── ml/                         ← ML-прогнозирование (Python)
│   ├── index.ts
│   ├── forecast-engine.ts      ← Time Series Forecasting ✅
│   ├── ensemble-predictor.ts   ← Ансамбль моделей ✅
│   └── portfolio-optimizer.ts  ← Оптимизация Марковица ✅
│
├── backtesting/                ← Backtesting рекомендаций
│   ├── index.ts
│   └── backtesting-engine.ts   ← Проверка на истории ✅
│
├── knowledge-graph/            ← Knowledge Graph
│   ├── index.ts
│   └── graph-builder.ts        ← Граф знаний + контекст ✅
│
├── events/                     ← Real-time event alerts
│   ├── index.ts
│   ├── event-bus.ts            ← Event-driven архитектура ✅
│   └── alert-manager.ts        ← Уведомления (Telegram, UI, Log) ✅
│
└── utils/                      ← Утилиты
    ├── index.ts
    └── news-collector.ts       ← Главный класс сбора ✅
```

---

## 🎯 Что работает

### 1. Сбор новостей
- ✅ MOEX ISS API (официальные новости)
- ✅ RSS-ленты (параллельный сбор из нескольких источников)
- ✅ Health tracking (автоотключение мёртвых источников)
- ✅ Дедупликация по URL
- ✅ Приоритизация

### 2. NLP-анализ
- ✅ Sentiment Analysis (Python BERT)
- ✅ Fallback на keyword-матчинг
- ✅ Оценка тональности (-1.0 — 1.0)

### 3. ML-прогнозирование
- ✅ Forecast Engine (ARIMA, Prophet, LSTM)
- ✅ Ensemble Predictor (ансамбль моделей)
- ✅ Portfolio Optimizer (Марковица)
- ✅ Fallback на технический анализ

### 4. Backtesting
- ✅ Проверка рекомендаций на истории
- ✅ Расчёт Sharpe Ratio, Win Rate, Max Drawdown
- ✅ Verdict (STRONG_RECOMMEND, RECOMMEND, NEUTRAL, AVOID)

### 5. Knowledge Graph
- ✅ Граф связей (компании → отрасли → события)
- ✅ Контекстный анализ
- ✅ Кэширование

### 6. Event Alerts
- ✅ Event Bus (event-driven архитектура)
- ✅ Alert Manager (Telegram, UI, Log)
- ✅ Anti-spam protection

---

## 🚀 Использование

```typescript
import {
  NewsCollector,
  SentimentAnalyzer,
  ForecastEngine,
  PortfolioOptimizer,
  BacktestingEngine,
  KnowledgeGraph,
  EventBus,
  AlertManager,
} from './modules/news/index.js';

// 1. Сбор новостей
const collector = new NewsCollector();
const news = await collector.collect();

// 2. Анализ сентимента
const analyzer = new SentimentAnalyzer();
const sentiment = await analyzer.analyze('Заголовок', 'Описание');

// 3. Прогнозирование
const forecast = new ForecastEngine();
const prediction = await forecast.forecast('SBER', candles);

// 4. Оптимизация портфеля
const optimizer = new PortfolioOptimizer();
const optimized = await optimizer.optimize(assets);

// 5. Backtesting
const backtester = new BacktestingEngine();
const result = await backtester.backtest({
  action: 'BUY',
  ticker: 'SBER',
  entryDate: '2024-01-01',
});

// 6. Knowledge Graph
const kg = new KnowledgeGraph();
const context = await kg.getContext('SBER');

// 7. Event Alerts
const bus = new EventBus();
const alerts = new AlertManager();

bus.subscribe('NEWS_CRITICAL', async (event) => {
  await alerts.sendAlert(event);
});

bus.emit({
  id: '1',
  type: 'NEWS_CRITICAL',
  priority: 'CRITICAL',
  ticker: 'SBER',
  title: 'Сбербанк увеличил прибыль на 40%',
  description: 'Чистая прибыль за 2025 год...',
  timestamp: new Date().toISOString(),
});
```

---

## 📊 Принцип: Конфиги ≠ Данные

```
❌ ХАРДКОР (нельзя):
   • URLы RSS-лент
   • Ключевые слова
   • Списки тикеров
   • Веса моделей

✅ ДИНАМИЧЕСКИ (можно):
   • Флаги включения/выключения
   • Интервалы и таймауты
   • Лимиты и пороги
   • Параметры оптимизации
```

---

## 🔧 Конфигурация

```typescript
import { config } from './modules/news/news-config.js';

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

// Оптимизация
config.PORTFOLIO_MAX_SINGLE_ASSET = 0.30;
config.PORTFOLIO_TARGET_SHARPE_RATIO = 0.8;
```

---

## ✅ TypeScript компиляция

```bash
$ npx tsc --noEmit
# ✅ 0 errors
```

Все модули проходят строгую типизацию без ошибок!
