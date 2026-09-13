/**
 * Конфигурация для модуля получения новостей
 */

/** RSS-ленты источников */
export interface NewsSource {
  /** Название источника */
  name: string;
  /** URL RSS-ленты */
  rssUrl: string;
  /** Максимальное количество новостей */
  maxItems?: number;
}

/** RSS-ленты для сбора новостей */
export const NEWS_SOURCES: NewsSource[] = [
  {
    name: 'РБК',
    rssUrl: 'https://www.rbc.ru/rss/rbc_news_main.xml',
  },
  {
    name: 'Интерфакс',
    rssUrl: 'https://www.interfax.ru/rss/rss.rdf',
  },
  {
    name: 'Investing.com',
    rssUrl: 'https://ru.investing.com/rss/news.rss',
    maxItems: 5,
  },
];

/** Ключевые слова для оценки релевантности новостей */
export const RELEVANCE_KEYWORDS = {
  high: [
    'ключевая ставка',
    'цб',
    'инфляция',
    'ключевая',
    'санкц',
    'рубль',
    'мосбирж',
    'моex',
    'индекс',
    'нефть',
    'бюджет',
    'рестрикц',
    'дивиденд',
    'отчётн',
    'рейтинг',
    'дефолт',
    'кризис',
    'рост',
    'паден',
  ],
  medium: [
    'акц',
    'облиг',
    'фонд',
    'инвест',
    'портфель',
    'доходн',
    'котировк',
    'торг',
  ],
};

/** Заголовок User-Agent для HTTP-запросов */
export const USER_AGENT = 'FinanceAnalyzer/1.0';
