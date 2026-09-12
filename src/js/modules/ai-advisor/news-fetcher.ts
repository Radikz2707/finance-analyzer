import axios from 'axios';

import { NEWS_SOURCES, RELEVANCE_KEYWORDS, USER_AGENT } from './news-config.js';

/** Структура новостной статьи */
export interface NewsArticle {
  title: string;
  summary: string;
  source: string;
  date: string;
  url?: string;
  relevance: 'high' | 'medium' | 'low';
}

/**
 * Модуль получения новостного фона для финансового анализа
 * Источники: RBC, Interfax, Investing.com (RU)
 */
export class NewsFetcherModule {
  /**
   * Получение свежих новостей по российскому рынку
   * Использует RSS-ленты и публичные API
   */
  public async fetchMarketNews(): Promise<string> {
    const news: NewsArticle[] = [];

    // Параллельный сбор новостей из нескольких источников
    const results = await Promise.allSettled(
      NEWS_SOURCES.map((source) => this.fetchSource(source)),
    );

    // Обработка результатов
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.length > 0) {
        news.push(...result.value);
      }
    }

    // Сортируем по релевантности
    const sorted = news.sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.relevance] - order[b.relevance];
    });

    // Форматируем в текст для ИИ
    return this.formatNewsForAi(sorted);
  }

  /**
   * Получение новостей из одного источника
   */
  private async fetchSource(source: { name: string; rssUrl: string; maxItems?: number }): Promise<NewsArticle[]> {
    try {
      const response = await axios.get(source.rssUrl, {
        timeout: 10000,
        headers: { 'User-Agent': USER_AGENT },
      });

      const items = this.parseRssItems(response.data);
      return items
        .map((item) => ({
          title: item.title,
          summary: item.description.substring(0, 200),
          source: source.name,
          date: item.pubDate || new Date().toLocaleDateString('ru-RU'),
          url: item.link,
          relevance: this.calculateRelevance(item.title, item.description),
        }))
        .slice(0, source.maxItems);
    } catch {
      console.warn(`[NEWS] Ошибка загрузки новостей ${source.name}`);
      return [];
    }
  }

  /**
   * Парсинг RSS XML в массив объектов
   */
  private parseRssItems(xml: string): Array<{
    title: string;
    description: string;
    link: string;
    pubDate: string | null;
  }> {
    const items: Array<{
      title: string;
      description: string;
      link: string;
      pubDate: string | null;
    }> = [];

    // Простой парсинг через regex (без внешних зависимостей)
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let itemMatch;

    while ((itemMatch = itemRegex.exec(xml)) !== null) {
      const itemContent = itemMatch[1];

      const title = this.extractTag(itemContent, 'title');
      const description = this.extractTag(itemContent, 'description');
      const link = this.extractTag(itemContent, 'link');
      const pubDate = this.extractTag(itemContent, 'pubDate');

      if (title) {
        items.push({ title, description, link, pubDate });
      }
    }

    return items.slice(0, 10); // Максимум 10 новостей
  }

  /**
   * Извлечение тега из XML
   */
  private extractTag(xml: string, tag: string): string {
    const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const match = xml.match(regex);
    return match ? match[1].trim() : '';
  }

  /**
   * Расчёт релевантности новости для финансового анализа
   */
  private calculateRelevance(
    title: string,
    description: string,
  ): 'high' | 'medium' | 'low' {
    const text = `${title} ${description}`.toLowerCase();

    const highMatch = RELEVANCE_KEYWORDS.high.some((kw) => text.includes(kw));
    const mediumMatch = RELEVANCE_KEYWORDS.medium.some((kw) => text.includes(kw));

    if (highMatch) return 'high';
    if (mediumMatch) return 'medium';
    return 'low';
  }

  /**
   * Форматирование новостей для передачи в ИИ
   */
  private formatNewsForAi(articles: NewsArticle[]): string {
    if (articles.length === 0) {
      return 'Свежие новости не удалось загрузить. Анализ проводится на основе макроэкономических данных.';
    }

    const formatted = articles
      .map((article, index) => {
        const relevanceIcon =
          article.relevance === 'high'
            ? '🔴'
            : article.relevance === 'medium'
              ? '🟡'
              : '⚪';

        return `${relevanceIcon} ${index + 1}. ${article.title} (${article.source}, ${article.date})\n   ${article.summary}${article.url ? `\n   🔗 ${article.url}` : ''}`;
      })
      .join('\n\n');

    return `=== ПОСЛЕДНИЕ НОВОСТИ И СОБЫТИЯ (автоматически загружены) ===\n\n${formatted}\n\n---\nИсточники: РБК, Интерфакс, Investing.com\nДата загрузки: ${new Date().toLocaleDateString('ru-RU')} ${new Date().toLocaleTimeString('ru-RU')}`;
  }

  /**
   * Получение макроэкономических индикаторов
   */
  public async getMacroIndicators(): Promise<string> {
    const indicators: string[] = [];

    try {
      // Получение курса доллара и евро к рублю
      const rateResponse = await axios.get(
        'https://www.cbr-xml-daily.ru/daily_json.js',
        { timeout: 10000 },
      );

      const usdRate = rateResponse.data.Valute.USD.Value;
      const eurRate = rateResponse.data.Valute.EUR.Value;
      const usdPrevious = rateResponse.data.Valute.USD.Previous;
      const eurPrevious = rateResponse.data.Valute.EUR.Previous;

      indicators.push(`Курс ЦБ РФ на ${rateResponse.data.Date}:`);
      indicators.push(`  $ USD: ${usdRate.toFixed(2)} ₽ (изм: ${(usdRate - usdPrevious).toFixed(2)} ₽)`);
      indicators.push(`  € EUR: ${eurRate.toFixed(2)} ₽ (изм: ${(eurRate - eurPrevious).toFixed(2)} ₽)`);
    } catch {
      console.warn('[NEWS] Ошибка загрузки курсов ЦБ');
    }

    return indicators.length > 0
      ? `=== МАКРОЭКОНОМИЧЕСКИЕ ИНДИКАТОРЫ ===\n${indicators.join('\n')}`
      : '';
  }
}
