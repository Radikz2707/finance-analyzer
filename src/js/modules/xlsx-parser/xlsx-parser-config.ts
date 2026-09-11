/**
 * Конфигурация парсера Excel.
 *
 * Содержит ТОЛЬКО пути к файлам, имена листов и ключевые слова для поиска данных.
 * ВСЕ числовые значения должны браться из Excel-файла — никаких fallback-чисел.
 * Если данные не найдены — выбрасывается ошибка.
 */

// ─── Пути и имена ───────────────────────────────────────────────────────────

/** Путь к Excel-файлу с данными портфеля QUIK */
export const EXCEL_FILE_PATH =
  process.env.EXCEL_FILE_PATH ||
  'C:/Users/Радик/Documents/Бухгалтерия Радика/Отчет/Данные новые.xlsx';

/** Имя листа Excel с текущими позициями портфеля */
export const QUIK_SHEET_NAME = 'QUIK';

/** Имя листа Excel с целевыми долями активов */
export const GOALS_SHEET_NAME = 'Цели';

/** Имя листа Excel с историей сделок */
export const TRADES_SHEET_NAME = 'Отчет по сделкам';

/** Имя листа Excel с котировками всех акций Московской биржи */
export const QUOTES_SHEET_NAME = 'Акции';

// Столбцы листа "Акции" — левая таблица (сырые данные из QUIK)
export const QUOTES_COLUMN_INSTRUMENT = 'Инструмент';
export const QUOTES_COLUMN_TICKER = 'Код工具';
export const QUOTES_COLUMN_TICKER_ALT = 'Код';
export const QUOTES_COLUMN_CURRENT_PRICE = 'Цена';
export const QUOTES_COLUMN_DAILY_DYNAMICS = 'Динамика';
export const QUOTES_COLUMN_DAILY_DYNAMICS_ALT = 'Изменение';

// ─── Ключевые слова для поиска строк ────────────────────────────────────────

/** Набор ключевых слов для поиска строки «Рубль / Ликвидный кэш» в листе QUIK */
export const FREE_CASH_ROW_KEYWORDS = ['Рубль1', 'Рубль'];

/** Набор ключевых слов для фильтрации служебных строк в листе QUIK */
export const EXCLUDED_ROW_KEYWORDS = [
  'ИТОГО',
  'ИТОГ',
  'БАЛАНС',
  'ДОЛЯ АКЦИЙ',
  'ДОЛЯ ОБЛИГА',
];

/** Набор ключевых слов для поиска строки «Вложенные средства» */
export const INVESTED_FUNDS_KEYWORDS = [
  'ВНЕСЕНО',
  'ВЛОЖЕН',
  'ВНЕШН',
  'СРЕДСТВ',
  'ВНЕС',
  'ВЛОЖЕННЫХ СРЕДСТВ',
  'ЛИЧНО ВНЕСЕНО',
];

/** Набор ключевых слов для поиска объёма покупок */
export const PURCHASES_KEYWORDS = ['КУПЛЯ', 'ПОКУПК'];

/** Набор ключевых слов для поиска объёма продаж */
export const SALES_KEYWORDS = ['ПРОДАЖ'];

/** Набор ключевых слов для поиска комиссий */
export const COMMISSION_KEYWORDS = ['КОМИССИ'];

/** Набор ключевых слов для поиска количества сделок */
export const TRADES_COUNT_KEYWORDS = ['ВСЕГО СДЕЛОК', 'КОЛИЧЕСТВО СДЕЛОК'];

/** Набор ключевых слов для поиска строки прибыли/убытка C10 */
export const PROFIT_C10_KEYWORDS = ['ТЕКУЩАЯ(ИЙ) ПРИБЫЛЬ', 'ПРИБЫЛЬ (УБЫТОК)'];

/** Набор ключевых слов для поиска общей оценки активов */
export const TOTAL_BALANCE_KEYWORDS = [
  'ИТОГО АКТИВОВ',
  'ОЦЕНКА ПОРТФЕЛЯ',
  'СТОИМОСТЬ ПОРТФЕЛЯ',
  'ОЦЕНКА АКТИВОВ',
  'АКТИВОВ',
];

/** Набор ключевых слов для поиска ликвидного кэша */
export const FREE_CASH_KEYWORDS = ['ЛИКВИДН', 'СВОБОДН', 'КАШ', 'БАЛАНС'];

/** Ключевое слово для поиска строки «Целевая доля» на листе «Цели» */
export const TARGET_SHARE_ROW_KEYWORD = 'Целевая доля';

// ─── Ключи столбцов для поиска значений ─────────────────────────────────────

/** Набор альтернативных имён столбцов со значениями в рублях */
export const VALUE_COLUMN_KEYS = ['Сумма', 'Значение', 'C'];

/** Столбец с количеством позиций (ищет по подстроке «КОЛ» в имени) */
export const QUANTITY_COLUMN_SEARCH_KEY = 'КОЛ';

// ─── Столбцы листа QUIK ────────────────────────────────────────────────────

export const QUIK_COLUMN_INSTRUMENT = 'Инструмент';
export const QUIK_COLUMN_TICKER = 'Код工具';
export const QUIK_COLUMN_TICKER_ALT1 = 'Код инструмента';
export const QUIK_COLUMN_TICKER_ALT2 = 'Код';
export const QUIK_COLUMN_ASSET_TYPE = 'Вид активов';
export const QUIK_COLUMN_ASSET_TYPE_ALT = 'Тип';
export const QUIK_COLUMN_LIQ_PERCENT = '%, активов, по ликвидационной стоимости';
export const QUIK_COLUMN_LIQ_PERCENT_ALT = 'Доля';
export const QUIK_COLUMN_BAL_PERCENT = '%, активов, по балансовой стоимости';
export const QUIK_COLUMN_TARGET_PCT = 'Target Percent';
export const QUIK_COLUMN_TARGET_PCT_ALT1 = 'Целевая доля, %';
export const QUIK_COLUMN_TARGET_PCT_ALT2 = 'S';
export const QUIK_COLUMN_NKD = 'НКД';
export const QUIK_COLUMN_NKD_ALT = 'Накопленный купон';
export const QUIK_COLUMN_BALANCE_PRICE = 'Балансовая цена';
export const QUIK_COLUMN_LIQ_PRICE = 'Ликвидационная цена';
export const QUIK_COLUMN_DYNAMICS = 'Динамика актива';
export const QUIK_COLUMN_UNREALIZED_PROFIT = 'Нереализованная прибыль';
export const QUIK_COLUMN_COST = 'Стоимость';
export const QUIK_COLUMN_LIQ_COST = 'Ликвидационная стоимость';
export const QUIK_COLUMN_BAL_COST = 'Балансовая стоимость';

// ─── Константы ──────────────────────────────────────────────────────────────

/** Стандартный номинал российской облигации (₽) */
export const DEFAULT_BOND_NOMINAL = 1000;
