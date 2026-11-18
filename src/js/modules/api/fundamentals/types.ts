/**
 * Контракты фундаментальных данных.
 *
 * Ключевая идея: каждое числовое поле несёт источник и дату получения.
 * Если значение получить не удалось — это НЕ ноль и НЕ прочерк, а
 * явный статус UNAVAILABLE / PARSE_ERROR с пояснением. Такой контракт
 * позволяет советнику честно писать «недоступно: источник не отвечает»
 * вместо домыслов.
 */

/** Официальные названия источников (не искажать в отчётах). */
export type FundamentalsSource = 'MOEX ISS' | 'smart-lab.ru';

/** Статус значения. */
export type SourcedStatus =
  'VALUE' | 'UNAVAILABLE' | 'PARSE_ERROR' | 'CONFLICT' | 'STALE';

/** Значение с подтверждением источника и даты. */
export interface SourcedValue<T = number> {
  value: T | null;
  source: FundamentalsSource | null;
  /** ISO-дата/время получения данных. */
  asOf: string | null;
  status: SourcedStatus;
  /** Пояснение для отчёта (например, «источник не отвечает»). */
  note?: string;
  /** Значение из второго источника при конфликте. */
  conflictValue?: T | null;
  /** Источник конфликтующего значения. */
  conflictSource?: FundamentalsSource | null;
}

/** Медианы показателей за 5 лет (история smart-lab.ru). */
export interface FundamentalMedians {
  pe5y: number | null;
  roe5y: number | null;
  dividendYield5y: number | null;
  debtToEquity5y: number | null;
  /** Сколько лет истории реально использовано. */
  years: number;
  source: FundamentalsSource | null;
  asOf: string | null;
}

/** Фундаментальные данные одной акции. */
export interface StockFundamentals {
  ticker: string;
  name: string;

  price: SourcedValue;
  marketCap: SourcedValue;

  pe: SourcedValue;
  ps: SourcedValue;
  pb: SourcedValue;
  roe: SourcedValue;
  roa: SourcedValue;
  debtToEquity: SourcedValue;
  dividendYield: SourcedValue;
  dividendPerShare: SourcedValue;
  nextDividendDate: SourcedValue<string>;

  revenue: SourcedValue;
  netIncome: SourcedValue;
  equity: SourcedValue;
  debt: SourcedValue;

  medians: FundamentalMedians | null;

  fundamentalHealth: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
  /** Текстовая суть: только числа с источником и датой. */
  summary: string;
  /** Поля, которые не удалось получить. */
  unavailable: string[];
  /** Зафиксированные расхождения источников. */
  conflicts: string[];
  /** Источники, которые реально дали данные. */
  sourcesUsed: FundamentalsSource[];
}

/** Контекст фундаментальных данных для всех акций портфеля. */
export interface PortfolioFundamentalsContext {
  assets: StockFundamentals[];
  /** Общие предупреждения (например, smart-lab.ru недоступен). */
  warnings: string[];
  /** Дата сборки контекста. */
  asOf: string;
  /** Включён ли smart-lab на момент сборки. */
  smartLabEnabled: boolean;
}

/** Сырая запись дивиденда MOEX ISS. */
export interface MoexDividendRecord {
  secid: string;
  isin?: string;
  /** Дата закрытия реестра (YYYY-MM-DD). */
  registryDate: string | null;
  /** Дата объявления (YYYY-MM-DD). */
  declaredDate: string | null;
  /** Размер дивиденда на акцию, руб. */
  value: number | null;
  dividendType?: string;
  period?: string;
  currency?: string;
}

/** Сырая запись отчётности MOEX ISS. */
export interface MoexReportRecord {
  secid: string;
  reportId?: string;
  periodYear?: number | null;
  periodQuarter?: number | null;
  beginDate?: string | null;
  endDate?: string | null;
  reportType?: string;
  /** Финансовые поля, если ISS их отдал в таблице reports. */
  netIncome?: number | null;
  revenue?: number | null;
  equity?: number | null;
  debt?: number | null;
  assets?: number | null;
}

/** Снимок котировки MOEX ISS. */
export interface MoexQuoteSnapshot {
  secid: string;
  price: number;
  marketCap: number | null;
  volume: number | null;
  turnover: number | null;
  asOf: string;
}

/** Описание бумаги MOEX ISS. */
export interface MoexSecurityInfo {
  secid: string;
  shortName: string | null;
  isin: string | null;
  issueSize: number | null;
  faceValue: number | null;
  board: string | null;
}

/** Результат парсинга финансовой страницы smart-lab.ru. */
export interface SmartLabFinancials {
  ticker: string;
  asOf: string;
  /** Годы из заголовка таблицы (по возрастанию). */
  years: string[];
  /** Поля: field -> значения по годам. */
  series: Record<string, Array<number | null>>;
  /** LTM-значение (последняя колонка), если есть. */
  ltm: Record<string, number | null>;
  /** Текущее значение: LTM или последнее непустое. */
  current: Record<string, number | null>;
  /** Медиана за последние 5 лет по каждому полю. */
  medians: Record<string, number | null>;
  /** Структура страницы распознана и значения извлечены. */
  parseOk: boolean;
  /** Поля, которые не удалось распознать. */
  missingFields: string[];
  /** Человекочитаемая причина ошибки парсинга. */
  parseError?: string;
}

/** Запись дивидендной истории smart-lab.ru. */
export interface SmartLabDividendRecord {
  ticker: string;
  /** Дата отсечки (YYYY-MM-DD). */
  registryDate: string | null;
  period: string | null;
  dividend: number | null;
  price: number | null;
  yieldPct: number | null;
}

/** Результат парсинга дивидендной страницы smart-lab.ru. */
export interface SmartLabDividends {
  ticker: string;
  asOf: string;
  records: SmartLabDividendRecord[];
  /** Годовой дивиденд на акцию из сводки, руб. */
  annualDividend: number | null;
  /** Текущая дивидендная доходность из сводки, %. */
  currentYield: number | null;
  /** Ближайшая будущая дата отсечки (если найдена). */
  nextRegistryDate: string | null;
  parseOk: boolean;
  parseError?: string;
}
