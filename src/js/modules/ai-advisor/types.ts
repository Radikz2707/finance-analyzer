/** Данные ордеров для UI (markdown-фрагмент). */
export interface UIOrdersData {
  /** Markdown-текст блока ордеров. */
  md: string;
}

/** Конфигурация ценового алерта для одного инструмента. */
export interface PriceAlertConfig {
  /** Верхний предел цены, при достижении которого срабатывает алерт. */
  upperLimit: number;
  /** Нижний предел цены, при достижении которого срабатывает алерт. */
  lowerLimit: number;
  /** Сообщение при пробое верхнего предела. */
  upperMessage: string;
  /** Сообщение при пробое нижнего предела. */
  lowerMessage: string;
}

/** Сработавший ценовой алерт по инструменту. */
export interface PriceAlert {
  /** Тикер инструмента. */
  ticker: string;
  /** Человекочитаемое название инструмента. */
  name: string;
  /** Текущая цена инструмента. */
  currentPrice: number;
  /** Настроенный верхний предел цены. */
  upperLimit: number;
  /** Настроенный нижний предел цены. */
  lowerLimit: number;
  /** Направление пробоя: 'upper' (выше верхнего) | 'lower' (ниже нижнего) | null (в диапазоне). */
  direction: 'upper' | 'lower' | null;
  /** Текст сообщения алерта. */
  message: string;
}
