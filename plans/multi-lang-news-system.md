# 🚀 Мультиязычная архитектура новостной системы с прогнозированием

## 📊 Распределение задач по языкам

```
┌─────────────────────────────────────────────────────────────────────┐
│                    ЯЗЫКИ И ИХ РОЛЬ В СИСТЕМЕ                         │
├──────────────┬──────────────────────────────────────────────────────┤
│  TypeScript  │  Координация, UI, IPC, Pipeline, интеграция          │
│  Python      │  NLP, ML, Прогнозирование, Оптимизация портфеля      │
│  Rust        │  Высокопроизводительный парсинг, HTTP, криптография   │
│  Lua         │  QUIK OnNews, экспорт данных из терминала            │
│  Bash/PS     │  Скрипты автоматизации, CI/CD, деплой                │
└──────────────┴──────────────────────────────────────────────────────┘
```

---

## 🎯 Архитектура после реализации

```
                    ┌─────────────────────────────────────────┐
                    │   TYPESCRIPT (UI/IPC/Director)          │
                    │  Pipeline Coordinator                   │
                    │  Director Agent + Recommendations       │
                    │  Portfolio Optimizer (надежность, доход) │
                    └────────────────┬────────────────────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
              ▼                      ▼                      ▼
  ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐
  │   PYTHON (ML)     │  │    RUST           │  │    LUA            │
  │                   │  │                   │  │                   │
  │ • Sentiment BERT  │  │ • RSS/XML Parser  │  │ • QUIK OnNews   │
  │ • NER/Entities    │  │ • HTTP Client     │  │ • Real-time     │
  │ • Time Series     │  │ • Fast Hashing    │  │ • Export        │
  │   Forecasting     │  │ • SIMD Calc       │  │                   │
  │ • Portfolio Opt   │  │                   │  │                   │
  │   (Markowitz)     │  │                   │  │                   │
  └───────────────────┘  └───────────────────┘  └───────────────────┘
              │                      │                      │
              └──────────────────────┼──────────────────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
              ▼                      ▼                      ▼
  ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐
  │  MOEX ISS API     │  │  SQLite DB        │  │  QUIK Terminal    │
  │  • Full history   │  │  • news           │  │  • Real-time      │
  │  • Candles (1D)   │  │  • entities       │  │  • Orders         │
  │  • Quotes         │  │  • sentiment      │  │  • Positions      │
  │  • Dividends      │  │  • forecasts      │  │                   │
  │  • Bonds          │  │  • portfolio      │  │                   │
  └───────────────────┘  └───────────────────┘  └───────────────────┘
                                     │
                                     ▼
                    ┌─────────────────────────────────────────┐
                    │   РЕКОМЕНДАЦИИ ДИРЕКТОРУ                │
                    │                                         │
                    │  • ПОКУПИТЬ/ПРОДАТЬ/ДЕРЖАТЬ             │
                    │  • Конкретные тикеры и суммы            │
                    │  • Прогноз доходности и риска           │
                    │  • Оптимизация портфеля (надежность)    │
                    │  • Приток денег (дивиденды, купоны)     │
                    └─────────────────────────────────────────┘
```

---

## 1️⃣ PYTHON — NLP Engine для новостей

**Файл:** `src/python/news_sentiment.py`

### Задачи:
1. **Sentiment Analysis** (замена keyword-based ~60% → 85-90%)
2. **NER (Named Entity Recognition)** — извлечение тикеров, компаний, сумм
3. **Topic Classification** — автоматическая категоризация
4. **Text Summarization** — сокращение длинных новостей

### Зависимости:
```txt
# requirements.txt (новые)
transformers>=4.40,<5.0
torch>=2.1,<3.0
spacy>=3.7,<4.0
ru_core_news_md>=3.7.0
textblob>=0.17,<1.0
langdetect>=1.0.9,<2.0
```

### API (JSON-over-stdio):
```python
# Команды: analyze_sentiment | extract_entities | classify_topic | summarize

# Запрос:
{
  "command": "analyze_sentiment",
  "payload": {
    "title": "Сбербанк увеличил прибыль на 40%",
    "summary": "По итогам года чистая прибыль...",
    "tickers": ["SBER"]
  }
}

# Ответ:
{
  "sentiment": "POSITIVE",
  "score": 0.85,
  "entities": [
    {"text": "Сбербанк", "label": "ORG", "ticker": "SBER"},
    {"text": "40%", "label": "PERCENT"}
  ],
  "topic": "financial_results",
  "summary": "Прибыль Сбера выросла на 40%..."
}
```

### Интеграция с TypeScript:
```typescript
// src/js/modules/pipeline/news/news-nlp-analyzer.ts
import { PythonBridge } from '../../python-engine/python-bridge.js';

export class NewsNlpAnalyzer {
  private bridge = new PythonBridge();

  async analyzeSentiment(text: string): Promise<SentimentResult> {
    const result = await this.bridge.call({
      command: 'analyze_sentiment',
      payload: { text },
    });
    return result as SentimentResult;
  }

  async fallbackKeywordSentiment(text: string): Promise<SentimentResult> {
    // Fallback если Python недоступен
    return keywordBasedSentiment(text);
  }
}
```

---

## 2️⃣ RUST — High-Performance News Parser

**Файл:** `src/rust/Cargo.toml`

### Задачи:
1. **Fast RSS/XML Parser** — SIMD-оптимизированный парсинг
2. **HTTP Client** — конкурентные запросы к 10+ источникам
3. **Content Hashing** — MD5/SHA256 для дедупликации
4. **Text Scoring** — быстрый keyword-матчинг

### Почему Rust:
- **В 10-50x быстрее Python** для CPU-интенсивных задач
- **Безопасная память** — нет утечек при долгих запросах
- **Нативная многопоточность** — async/await + tokio
- **napi-rs** — уже есть опыт (sharp использует)

### API (napi-rs):
```rust
// src/rust/src/lib.rs
use napi::bindgen_prelude::*;
use napi_derive::napi;

#[napi]
pub struct NewsParser {
    client: reqwest::Client,
}

#[napi]
impl NewsParser {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .unwrap(),
        }
    }

    #[napi]
    pub async fn parse_rss(&self, url: String) -> Result<JsUnknown> {
        let response = self.client.get(&url).send().await?;
        let body = response.text().await?;
        
        // Парсим XML (используем quick-xml)
        let items = parse_rss_xml(&body);
        
        Ok(serde_json::to_value(&items)?.into_any())
    }

    #[napi]
    pub fn compute_hash(text: String) -> String {
        use sha2::{Sha256, Digest};
        let mut hasher = Sha256::new();
        hasher.update(text.as_bytes());
        format!("{:x}", hasher.finalize())
  }
}

// src/js/modules/pipeline/recommendation-engine.ts
export class RecommendationEngine {
  private pythonMl: PythonMlEngine;
  private newsCollector: NewsCollector;
  private moexCandles: MoexCandleAnalyzer;

  async generateRecommendations(
    portfolio: PortfolioData,
    news: NewsCollectionResult,
    candles: Map<string, CandleData>,
    macroFactors: MacroData,
  ): Promise<RecommendationResult> {
    
    // 1. Загрузка полных исторических графиков с MOEX
    const fullHistory = await this.moexCandles.loadFullHistory(portfolio.tickers);
    
    // 2. Прогнозирование цен (Python ML)
    const forecasts = await this.pythonMl.forecastPrices({
      candles: fullHistory,
      newsSentiment: news.sentimentByTicker,
      macroFactors: macroFactors,
    });
    
    // 3. Оптимизация портфеля (Python ML — Markowitz)
    const optimized = await this.pythonMl.optimizePortfolio({
      current: portfolio,
      forecasts: forecasts,
      constraints: {
        maxSingleAsset: 0.30,
        maxSector: 0.50,
        minDividendYield: 0.05,
      },
    });
    
    // 4. Формирование рекомендаций для директора
    return this.buildRecommendations({
      portfolio,
      optimized,
      forecasts,
      news,
      candles: fullHistory,
    });
  }
}
```

### Интеграция с TypeScript:
```typescript
// src/js/modules/pipeline/news/rust-parser.ts
import { NewsParser } from '../../../rust/target/release/libnews_parser.node';

export class RustNewsParser {
  private parser = new NewsParser();

  async fetchRss(url: string): Promise<NewsItem[]> {
    return this.parser.parseRss(url);
  }

  computeContentHash(text: string): string {
    return this.parser.computeHash(text);
  }
}
```

---

## 3️⃣ LUA — QUIK Real-time News Feed

**Файл:** `quik/export_news.lua` (улучшенный)

### Задачи:
1. **Real-time news из QUIK** — OnNews callback
2. **Фильтрация по тикерам** — только релевантные новости
3. **Экспорт в JSON** — для Python/Rust анализа

### Улучшения:
```lua
-- quik/export_news.lua

local news_file = "data/quik/news_%s.json"
local ticker_filter = {"SBER", "LKOH", "GAZP", "VTBR"}

function OnNews(news)
    -- Фильтруем по тикерам
    local is_relevant = false
    for _, ticker in ipairs(ticker_filter) do
        if string.find(news.text, ticker) then
            is_relevant = true
            break
        end
    end
    
    if is_relevant then
        local filename = string.format(news_file, os.date("%Y%m%d"))
        local json = string.format([[{
            "id": "%s",
            "time": "%s",
            "text": "%s",
            "source": "QUIK"
        }]], news.id, news.time, news.text)
        
        -- Append to file
        local f = io.open(filename, "a")
        if f then
            f.write(json .. "\n")
            f.close()
        end
    end
end
```

---

## 5️⃣ PYTHON ML ENGINE — Прогнозирование и Оптимизация

**Файл:** `src/python/ml_engine.py`

### Задачи:
1. **Time Series Forecasting** — прогнозирование цен акций и облигаций
2. **Portfolio Optimization** — оптимизация Марковица (Max Sharpe, Min Variance)
3. **Risk Analysis** — VaR (Value at Risk), Monte Carlo симуляции
4. **Dividend Forecasting** — прогноз дивидендных выплат

### Зависимости:
```txt
# requirements.txt (новые)
pandas>=2.2,<3.0
numpy>=1.26,<3.0
scikit-learn>=1.4,<2.0
statsmodels>=0.14,<1.0
prophet>=1.1,<2.0
arch>=6.2,<7.0
```

### API (JSON-over-stdio):
```python
# Команды: forecast_prices | optimize_portfolio | calculate_risk | forecast_dividends

# Прогнозирование цен:
{
  "command": "forecast_prices",
  "payload": {
    "ticker": "SBER",
    "candles": [{"date": "...", "close": 280.5}, ...],  // полный исторический график
    "news_sentiment": {"POSITIVE": 0.85, "NEGATIVE": 0.15},
    "macro_factors": {"keyRate": 21.0, "inflation": 7.5}
  }
}

# Ответ:
{
  "ticker": "SBER",
  "forecast": {
    "1_week": {"price": 295.0, "confidence": 0.78, "direction": "UP"},
    "1_month": {"price": 310.0, "confidence": 0.65, "direction": "UP"},
    "3_month": {"price": 325.0, "confidence": 0.52, "direction": "UP"}
  },
  "models_used": ["ARIMA", "Prophet", "LSTM"],
  "factors": {
    "technical": "Bullish trend (SMA20 > SMA50)",
    "fundamental": "Прибыль +40% YoY",
    "sentiment": "Позитивный (0.85)",
    "macro": "Ключевая ставка 21% — давление на рост"
  }
}

# Оптимизация портфеля:
{
  "command": "optimize_portfolio",
  "payload": {
    "current_portfolio": [
      {"ticker": "SBER", "weight": 0.30},
      {"ticker": "LKOH", "weight": 0.25},
      ...
    ],
    "forecasts": {...},
    "constraints": {
      "max_single_asset": 0.30,
      "max_sector": 0.50,
      "min_dividend_yield": 0.05
    }
  }
}

# Ответ:
{
  "recommended_portfolio": [
    {"ticker": "SBER", "weight": 0.28, "action": "HOLD"},
    {"ticker": "LKOH", "weight": 0.22, "action": "SELL 10%"},
    {"ticker": "VTBR", "weight": 0.15, "action": "BUY 5%"},
    ...
  ],
  "expected_metrics": {
    "annual_return": 0.18,
    "volatility": 0.22,
    "sharpe_ratio": 0.82,
    "max_drawdown": 0.15,
    "dividend_yield": 0.07,
    "risk_level": "MEDIUM"
  },
  "changes": [
    {
      "action": "SELL",
      "ticker": "LKOH",
      "percent": 0.10,
      "reason": "Переоценен, P/E > 15, негативный сентимент по экспорту"
    },
    {
      "action": "BUY",
      "ticker": "VTBR",
      "percent": 0.05,
      "reason": "Дивидендная доходность 12%, позитивный сентимент по отчетности"
    }
  ]
}
```

---

## 6️⃣ MOEX CANDLE ANALYZER — Полный график котировок

**Файл:** `src/python/moex_candles.py`

### Задачи:
1. **Загрузка полного исторического графика** с MOEX ISS API
2. **Технический анализ** — SMA, EMA, RSI, MACD, Bollinger Bands
3. **Pattern Recognition** — обнаружение паттернов (Head & Shoulders, Double Top)
4. **Support/Resistance** — автоматическое определение уровней

### API:
```python
# Загрузка полного графика (за всё время существования актива):
{
  "command": "load_full_history",
  "payload": {
    "ticker": "SBER",
    "asset_type": "STOCK",  # или BOND
    "interval": "D",  # дневные свечи
    "from_date": "2010-01-01"  // с момента IPO
  }
}

# Ответ:
{
  "ticker": "SBER",
  "candles": [
    {"date": "2010-09-09", "open": 52.5, "high": 54.0, "low": 51.8, "close": 53.2, "volume": 15000000},
    ...  // тысячи дневных свечей
  ],
  "technical_indicators": {
    "sma_20": 285.5,
    "sma_50": 275.0,
    "sma_200": 260.0,
    "rsi_14": 62.5,
    "macd": {"line": 5.2, "signal": 4.8, "histogram": 0.4},
    "bollinger_bands": {"upper": 300.0, "middle": 285.0, "lower": 270.0},
    "support_levels": [260.0, 245.0, 230.0],
    "resistance_levels": [295.0, 310.0, 325.0]
  },
  "trend": {
    "short_term": "BULLISH",
    "medium_term": "BULLISH",
    "long_term": "BULLISH",
    "strength": 0.75
  }
}
```

---

## 7️⃣ RECOMMENDATION ENGINE — Директор и Агенты

**Файл:** `src/js/modules/pipeline/recommendation-engine.ts`

### Задачи:
1. **Агрегация всех данных**:
   - Новости + Sentiment (Python NLP)
   - Котировки + Технический анализ (Python ML)
   - Прогнозы (Python Time Series)
   - Текущий портфель (Excel/QUIK)
   - Макро-факторы (CBR, MOEX)

2. **Формирование рекомендаций**:
   - ПОКУПАТЬ / ПРОДАВАТЬ / ДЕРЖАТЬ
   - Конкретные тикеры и суммы
   - Обоснование (сентимент, теханализ, фундаментал)
   - Прогноз доходности и риска

3. **Оптимизация портфеля**:
   - Надежность (диверсификация, снижение риска)
   - Доходность (максимизация Sharpe Ratio)
   - Приток денег (дивиденды, купоны)

### Архитектура:
```typescript
// src/js/modules/pipeline/recommendation-engine.ts
export class RecommendationEngine {
  private pythonMl: PythonMlEngine;
  private newsCollector: NewsCollector;
  private moexCandles: MoexCandleAnalyzer;

  async generateRecommendations(
    portfolio: PortfolioData,
    news: NewsCollectionResult,
    candles: Map<string, CandleData>,
    macroFactors: MacroData,
  ): Promise<RecommendationResult> {
    
    // 1. Загрузка полных исторических графиков
    const fullHistory = await this.moexCandles.loadFullHistory(portfolio.tickers);
    
    // 2. Прогнозирование цен (Python ML)
    const forecasts = await this.pythonMl.forecastPrices({
      candles: fullHistory,
      newsSentiment: news.sentimentByTicker,
      macroFactors: macroFactors,
    });
    
    // 3. Оптимизация портфеля (Python ML — Markowitz)
    const optimized = await this.pythonMl.optimizePortfolio({
      current: portfolio,
      forecasts: forecasts,
      constraints: {
        maxSingleAsset: 0.30,
        maxSector: 0.50,
        minDividendYield: 0.05,
      },
    });
    
    // 4. Формирование рекомендаций для директора
    const recommendations = this.buildRecommendations({
      portfolio,
      optimized,
      forecasts,
      news: news,
      candles: fullHistory,
    });
    
    return {
      recommendations,
      expectedMetrics: optimized.expectedMetrics,
      rationale: this.buildRationale(recommendations),
    };
  }
  
  private buildRecommendations(data): Recommendation[] {
    return data.optimized.changes.map((change) => ({
      action: change.action,  // BUY / SELL / HOLD
      ticker: change.ticker,
      amount: change.amount,
      reason: this.combineEvidence(change, data),
      confidence: this.calculateConfidence(change, data),
      forecast: data.forecasts[change.ticker],
      impact: {
        expectedReturn: change.expectedReturn,
        riskChange: change.riskDelta,
        dividendImpact: change.dividendDelta,
      },
    }));
  }
}
```

---

## 8️⃣ TYPESCRIPT — Coordination Layer

**Файл:** `src/js/modules/pipeline/news/news-collector.ts`

### Задачи:
1. **Unified NewsCollector** — единый интерфейс для pipeline и desktop
2. **Pipeline Integration** — DataAgent → PipelineCoordinator
3. **Desktop Integration** — real-time сбор в Electron
4. **UI Integration** — отображение в чате Director

### Архитектура:
```typescript
// src/js/modules/pipeline/news/news-collector.ts
export class NewsCollector {
  private rustParser: RustNewsParser;
  private pythonAnalyzer: NewsNlpAnalyzer;
  private luaReader: QuikNewsReader;
  private sources: NewsSource[];

  constructor(options: NewsCollectorOptions) {
    this.rustParser = new RustNewsParser();
    this.pythonAnalyzer = new NewsNlpAnalyzer();
    this.luaReader = new QuikNewsReader();
    
    this.sources = [
      new MoexNewsSource(),           // Rust HTTP
      new RssNewsSource(),            // Rust HTTP
      new QuikNewsSource(),           // Lua/JSON
      new TelegramNewsSource(),       // Python scraping
      new CbrNewsSource(),            // Rust HTTP
    ];
  }

  async collect(): Promise<NewsCollectionResult> {
    // 1. Параллельный сбор из всех источников (Rust HTTP)
    const rawNews = await Promise.all(
      this.sources.map(source => source.fetch())
    );
    
    // 2. Дедупликация (Rust hashing)
    const deduped = this.deduplicate(rawNews.flat());
    
    // 3. NLP анализ (Python)
    const analyzed = await this.analyzeNews(deduped);
    
    // 4. Приоритизация (TypeScript)
    const prioritized = this.prioritize(analyzed);
    
    return {
      approvedNews: prioritized,
      stats: this.computeStats(prioritized),
    };
  }
}
```

---

## 5️⃣ BASH/POWERSHELL — Automation Scripts

**Файлы:**
- `scripts/setup-news-engine.sh` — установка Python зависимостей
- `scripts/build-rust-news.ps1` — компиляция Rust модуля
- `scripts/poll-news.ps1` — фоновый сбор в desktop

---

## 📦 Зависимости по языкам

### Python (новые):
```txt
transformers>=4.40,<5.0
torch>=2.1,<3.0
spacy>=3.7,<4.0
ru_core_news_md>=3.7.0
textblob>=0.17,<1.0
langdetect>=1.0.9,<2.0
beautifulsoup4>=4.12,<5.0
```

### Rust (новые):
```toml
# src/rust/Cargo.toml
[dependencies]
napi = { version = "2", features = ["async"] }
napi-derive = "2"
reqwest = { version = "0.11", features = ["json", "rustls-tls"] }
tokio = { version = "1", features = ["full"] }
quick-xml = "0.31"
sha2 = "0.10"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

### TypeScript (без изменений):
```typescript
// Уже есть:
// - PythonBridge (subprocess JSON-over-stdio)
// - PipelineCoordinator
// - DirectorAgent
// - NewsDriver
```

---

## 🎯 РЕЗУЛЬТАТ — Директор и Агенты получают суперсилы

### Что видит Директор:

```
📊 ПОРТФЕЛЬ: Сбербанк (SBER)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📈 ПОЛНЫЙ ГРАФИК КОТИРОВОК (2010-2026):
  • 5,847 дневных свечей с момента IPO
  • Текущая цена: 285.50 ₽
  • SMA 20/50/200: 285.5 / 275.0 / 260.0
  • RSI 14: 62.5 (нейтрально-бычий)
  • MACD: бычье пересечение
  • Уровни поддержки: 260.0, 245.0, 230.0
  • Уровни сопротивления: 295.0, 310.0, 325.0
  • Trend: BULLISH (strength: 0.75)

📰 НОВОСТНОЙ ФОН (последние 24 часа):
  🔴 [КРИТИЧНО] Сбербанк увеличил прибыль на 40%
     Сводка: Чистая прибыль за 2025 год составила 1.2 трлн ₽
     Источник: РБК | 2026-10-18 | Тикеры: SBER
     Sentiment: POSITIVE (score: 0.85)
  
  🟠 [ВАЖНО] ЦБ сохранил ключевую ставку на уровне 21%
     Сводка: Регулятор сохранил ставку, прогноз инфляции 7.5%
     Источник: Интерфакс | 2026-10-17 | Тикеры: SBER, GAZP, VTBR
     Sentiment: NEUTRAL (score: 0.15)

🔮 ПРОГНОЗ (Python ML — ARIMA + Prophet + LSTM):
  • 1 неделя: 295.0 ₽ (confidence: 0.78, direction: UP)
  • 1 месяц: 310.0 ₽ (confidence: 0.65, direction: UP)
  • 3 месяца: 325.0 ₽ (confidence: 0.52, direction: UP)
  
  Факторы:
    ✅ Технический: Бычий тренд (SMA20 > SMA50)
    ✅ Фундаментал: Прибыль +40% YoY
    ✅ Сентимент: Позитивный (0.85)
    ⚠️ Макро: Ключевая ставка 21% — давление на рост

💡 РЕКОМЕНДАЦИЯ ДИРЕКТОРУ:
  ➡️ ДЕРЖАТЬ (HOLD)
  
  Обоснование:
    • Сильный бычий тренд + позитивный сентимент
    • Прибыль растет 4 квартала подряд
    • Дивидендная доходность: 7.2%
    • Риск: умеренный (Volatility: 22%)
  
  Прогноз доходности:
    • 1 месяц: +8.5% (285 → 310 ₽)
    • 3 месяца: +13.8% (285 → 325 ₽)
    • Дивиденды за год: +7.2%
    • Итого за год: +21% (с дивидендами)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 ОПТИМИЗАЦИЯ ПОРТФЕЛЯ:
  Текущая структура:
    SBER: 30% (HOLD)
    LKOH: 25% (SELL 10% — переоценен, P/E > 15)
    GAZP: 20% (BUY 5% — дивиденды 12%)
    VTBR: 15% (BUY 5% — сентимент позитивный)
    Кэш: 10%
  
  Ожидаемые метрики после оптимизации:
    • Годовая доходность: +18%
    • Волатильность: 22%
    • Sharpe Ratio: 0.82
    • Максимальная просадка: 15%
    • Дивидендная доходность: 7%
    • Уровень риска: СРЕДНИЙ
```

### Как Агенты улучшают прогнозы:

```
🔄 ЦИКЛ УЛУЧШЕНИЯ ПРОГНОЗОВ:

1. DATA AGENT
   ├─ Загружает полный график котировок (MOEX ISS)
   ├─ Собирает новости (RSS, MOEX, QUIK, Telegram)
   └─ Извлекает макро-факторы (CBR, инфляция, курс валют)

2. RESEARCH AGENT
   ├─ Python NLP: Sentiment Analysis (BERT)
   ├─ Python NLP: NER (извлечение тикеров, сумм, дат)
   ├─ Python ML: Технический анализ (SMA, RSI, MACD)
   └─ Python ML: Прогнозирование цен (ARIMA + Prophet)

3. ANALYSIS AGENT
   ├─ Portfolio Math: Доли, отклонения, P&L
   ├─ Risk Analysis: VaR, Volatility, Correlations
   └─ Dividend Forecasting: Прогноз выплат

4. AI AGENT (LLM)
   ├─ Агрегирует ВСЕ данные:
   │   • Новости + Sentiment
   │   • Котировки + Технический анализ
   │   • Прогнозы + Фундаментал
   │   • Макро-факторы + Риск
   │
   ├─ Формирует рекомендацию:
   │   • ПОКУПАТЬ / ПРОДАВАТЬ / ДЕРЖАТЬ
   │   • Конкретные тикеры и суммы
   │   • Обоснование с ссылками на данные
   │   • Прогноз доходности и риска
   │
   └─ Оптимизирует портфель:
       • Надежность (диверсификация)
       • Доходность (Max Sharpe)
       • Приток денег (дивиденды + купоны)

5. DIRECTOR AGENT
   ├─ Показывает директору:
   │   • Полный анализ по каждому активу
   │   • Рекомендации с обоснованием
   │   • Прогноз метрик портфеля
   │   • Конкретные действия (купить/продать)
   │
   └─ Директор принимает решение → Агенты учатся
```

### Показатели портфеля (на что влияют рекомендации):

```
📊 МЕТРИКИ ПОРТФЕЛЯ:

1. НАДЕЖНОСТЬ (Risk Level):
   • Диверсификация по секторам (макс 50% в один сектор)
   • Диверсификация по активам (акции, облигации, ETF, кэш)
   • Минимальный уровень риска (Volatility < 25%)
   • Максимальная просадка (Max Drawdown < 20%)
   
2. ДОХОДНОСТЬ (Return):
   • Годовая доходность (Target: > 15%)
   • Sharpe Ratio (Target: > 0.8)
   • Alpha против бенчмарка (MOEX TR Index)
   
3. ПРИТОК ДЕНЕГ (Cash Flow):
   • Дивидендная доходность (Target: > 5%)
   • Купонный доход по облигациям
   • Реинвестирование дивидендов (DRIP)
   • Прогноз ежемесячного притока
```

---

## 🔄 Поток данных (полная цепочка)

```
1. QUIK (Lua)          2. MOEX (Rust HTTP)     3. RSS (Rust HTTP)
     │                       │                        │
     ▼                       ▼                        ▼
4. Python ML Engine (Candles, Forecasting, Optimization)
     │                       │                        │
     ▼                       ▼                        ▼
5. Python NLP Engine (Sentiment, NER, Topic)
     │
     ▼
6. TypeScript NewsCollector (Dedup, Prioritize, Cache)
     │
     ▼
7. TypeScript RecommendationEngine (Агрегация + Оптимизация)
     │
     ├─────────────────────────────────────────────────┐
     ▼                                                 ▼
Pipeline (CLI)                              Desktop (Electron)
     │                                                 │
     ▼                                                 ▼
AiAgent → LLM                              Director → LLM
     │                                                 │
     ▼                                                 ▼
report.html (HTML + Markdown)                UI Chat (Новости + Прогнозы + Рекомендации)
```

---

## ⚡ Производительность (ожидаемая)

| Задача | Сейчас (TS) | После (Multi-lang) | Ускорение |
|--------|-------------|-------------------|-----------|
| Парсинг 10 RSS | ~2000мс | ~200мс (Rust) | **10x** |
| Sentiment (keyword) | ~50мс | ~100мс (Python BERT) | 0.5x (качество ↑) |
| Deduplication | ~100мс | ~10мс (Rust SHA256) | **10x** |
| NER extraction | ❌ Нет | ~50мс (Python spaCy) | **New** |
| Topic classification | ❌ Нет | ~30мс (Python TF-IDF) | **New** |
| Time Series Forecast | ❌ Нет | ~500мс (Python Prophet) | **New** |
| Portfolio Optimization | ❌ Нет | ~200мс (Python SciPy) | **New** |
| Technical Analysis | ❌ Нет | ~100мс (Python Pandas) | **New** |
| Full History Load | ❌ Нет | ~1000мс (Rust HTTP) | **New** |

---

## 📅 План реализации (10 недель)

### Неделя 1-2: Python NLP Engine
- [ ] Установить зависимости (transformers, spacy)
- [ ] Создать `news_sentiment.py`
- [ ] Интегрировать с PythonBridge
- [ ] Добавить fallback на keyword
- [ ] Unit-тесты

### Неделя 3-4: Rust Parser
- [ ] Инициализировать Cargo проект
- [ ] Реализовать RSS/XML парсер
- [ ] Добавить HTTP client (reqwest)
- [ ] napi-rs bindings
- [ ] Интеграция с TypeScript

### Неделя 5-6: Python ML Engine (Прогнозирование)
- [ ] Создать `ml_engine.py`
- [ ] Time Series Forecasting (ARIMA + Prophet + LSTM)
- [ ] Portfolio Optimization (Markowitz)
- [ ] Risk Analysis (VaR, Monte Carlo)
- [ ] Dividend Forecasting
- [ ] Интеграция с TypeScript

### Неделя 7: MOEX Candles Analyzer
- [ ] Создать `moex_candles.py`
- [ ] Загрузка полного исторического графика
- [ ] Технический анализ (SMA, EMA, RSI, MACD)
- [ ] Pattern Recognition
- [ ] Support/Resistance Levels

### Неделя 8: Recommendation Engine
- [ ] Создать `recommendation-engine.ts`
- [ ] Агрегация всех данных (новости + котировки + прогнозы)
- [ ] Формирование рекомендаций (BUY/SELL/HOLD)
- [ ] Оптимизация портфеля (надежность, доходность, приток денег)
- [ ] Интеграция с PipelineCoordinator

### Неделя 9: Desktop Integration
- [ ] Фоновый сбор новостей в desktop
- [ ] News block в Director chat
- [ ] Отображение прогнозов и рекомендаций
- [ ] Health monitoring UI
- [ ] Pipeline integration

### Неделя 10: UI и полировка
- [ ] Полные графики котировок в UI
- [ ] Визуализация рекомендаций
- [ ] Документация
- [ ] End-to-end тесты
- [ ] Оптимизация производительности

---

## 🔒 Безопасность и надёжность

- **Rust** — memory safety, no data races
- **Python** — sandboxed subprocess, timeout 15s
- **Lua** — ограниченная среда QUIK
- **TypeScript** — строгая типизация, null checks
- **Все** — fallback mechanisms, health monitoring

---

## 📊 ИТОГОВАЯ СВОДКА — Что получает Директор

### 🎯 Полная картина по каждому активу:

```
✅ ПОЛНЫЙ ГРАФИК КОТИРОВОК
   • С момента IPO (тысячи свечей)
   • Технический анализ (SMA, RSI, MACD, Bollinger)
   • Уровни поддержки/сопротивления
   • Паттерны и тренды

✅ НОВОСТНОЙ ФОН
   • 8+ источников (RSS, MOEX, QUIK, Telegram)
   • LLM-powered Sentiment Analysis (85-90% точность)
   • NER (извлечение тикеров, сумм, дат)
   • Тематическая категоризация

✅ ПРОГНОЗЫ
   • Time Series (ARIMA + Prophet + LSTM)
   • 1 неделя, 1 месяц, 3 месяца
   • Confidence intervals
   • Факторы влияния (технический, фундаментал, сентимент, макро)

✅ РЕКОМЕНДАЦИИ
   • ПОКУПАТЬ / ПРОДАВАТЬ / ДЕРЖАТЬ
   • Конкретные тикеры и суммы
   • Обоснование с ссылками на данные
   • Прогноз доходности и риска

✅ ОПТИМИЗАЦИЯ ПОРТФЕЛЯ
   • Надежность (диверсификация, снижение риска)
   • Доходность (Max Sharpe Ratio)
   • Приток денег (дивиденды + купоны)
   • Конкретные шаги для улучшения метрик
```

### 📈 Показатели портфеля (на что влияют рекомендации):

```
1. НАДЕЖНОСТЬ (Risk Management):
   ✅ Диверсификация по секторам (макс 50% в один)
   ✅ Диверсификация по активам (акции, облигации, ETF, кэш)
   ✅ Volatility < 25%
   ✅ Max Drawdown < 20%
   ✅ VaR (Value at Risk) контроль

2. ДОХОДНОСТЬ (Return Optimization):
   ✅ Годовая доходность > 15%
   ✅ Sharpe Ratio > 0.8
   ✅ Alpha против бенчмарка (MOEX TR Index)
   ✅ Прогноз на 1/3/12 месяцев

3. ПРИТОК ДЕНЕГ (Cash Flow Growth):
   ✅ Дивидендная доходность > 5%
   ✅ Купонный доход по облигациям
   ✅ Реинвестирование дивидендов (DRIP)
   ✅ Прогноз ежемесячного притока
   ✅ Постоянно растущий денежный поток
```

### 🔄 Как агенты улучшают прогнозы:

```
1. DATA AGENT
   → Загружает полный график котировок (MOEX ISS)
   → Собирает новости (RSS, MOEX, QUIK, Telegram)
   → Извлекает макро-факторы (CBR, инфляция, курс валют)

2. RESEARCH AGENT
   → Python NLP: Sentiment Analysis (BERT)
   → Python NLP: NER (извлечение тикеров, сумм, дат)
   → Python ML: Технический анализ (SMA, RSI, MACD)
   → Python ML: Прогнозирование цен (ARIMA + Prophet)

3. ANALYSIS AGENT
   → Portfolio Math: Доли, отклонения, P&L
   → Risk Analysis: VaR, Volatility, Correlations
   → Dividend Forecasting: Прогноз выплат

4. AI AGENT (LLM)
   → Агрегирует ВСЕ данные:
     • Новости + Sentiment
     • Котировки + Технический анализ
     • Прогнозы + Фундаментал
     • Макро-факторы + Риск
   → Формирует рекомендацию:
     • ПОКУПАТЬ / ПРОДАВАТЬ / ДЕРЖАТЬ
     • Конкретные тикеры и суммы
     • Обоснование с ссылками на данные
     • Прогноз доходности и риска
   → Оптимизирует портфель:
     • Надежность (диверсификация)
     • Доходность (Max Sharpe)
     • Приток денег (дивиденды + купоны)

5. DIRECTOR AGENT
   → Показывает директору:
     • Полный анализ по каждому активу
     • Рекомендации с обоснованием
     • Прогноз метрик портфеля
     • Конкретные действия (купить/продать)
   → Директор принимает решение → Агенты учатся
```

---

## 🚀 ЗАЧЕМ ВСЁ ЭТО?

### Цель системы:

```
Помочь директору принимать решения на основе:
✅ Полных данных (все графики, все новости, все прогнозы)
✅ Глубокого анализа (ML, NLP, технический анализ, фундаментал)
✅ Конкретных рекомендаций (что купить, что продать, сколько)
✅ Прогноза результатов (как изменятся метрики портфеля)

Результат:
📈 Надежный портфель с минимальными рисками
💰 Максимальная доходность (Sharpe Ratio > 0.8)
💵 Постоянно растущий приток денег (дивиденды + купоны)
🎯 Предсказуемое будущее активов с высокой точностью
```
