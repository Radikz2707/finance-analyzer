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
  /** Флаг: российские новости Мосбиржи */
  isMoscowExchange?: boolean;
}

/** RSS-ленты для сбора новостей (российские + международные) */
export const NEWS_SOURCES: NewsSource[] = [
  // === РОССИЙСКИЕ (Московская биржа) ===
  {
    name: 'РБК Финансы',
    rssUrl: 'https://www.rbc.ru/rss/rbc_news_main.xml',
    isMoscowExchange: true,
  },
  {
    name: 'Интерфакс',
    rssUrl: 'https://www.interfax.ru/rss/rss.rdf',
    isMoscowExchange: true,
  },
  {
    name: 'Финансы Финам',
    rssUrl: 'https://www.finam.ru/infoblock/newsfeed/rss.aspx',
    isMoscowExchange: true,
  },
  {
    name: 'Коммерсантъ Финансы',
    rssUrl: 'https://www.kommersant.ru/rss/finance.xml',
    isMoscowExchange: true,
  },
  {
    name: 'Ведомости Финансы',
    rssUrl: 'https://www.vedomosti.ru/rss.xml',
    isMoscowExchange: true,
  },
  // === МЕЖДУНАРОДНЫЕ ===
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
    'акц',
    'облиг',
    'фонд',
    'инвест',
    'портфель',
    'доходн',
    'котировк',
    'торг',
    'дивиденд',
    'выкуп',
    'погашен',
    'эмисс',
    'IPO',
    'SPO',
    'блокпакет',
    'пакет',
    'слиян',
    'поглощ',
    'конкурс',
    'суд',
    'арбитр',
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
    'аналит',
    'прогноз',
    'эксперт',
    'рынок',
    'сектор',
    'отрасль',
  ],
  low: [
    'эконом',
    'полит',
    'обществ',
    'технолог',
    'наука',
    'спорт',
    'культура',
  ],
};

/** Ключевые слова для фильтрации мусора */
export const NOISE_KEYWORDS = [
  'реклама',
  'спам',
  'подписка',
  'рассылк',
  'конкурс',
  'опрос',
  'анкет',
];

/** Заголовок User-Agent для HTTP-запросов */
export const USER_AGENT = 'FinanceAnalyzer/1.0';
