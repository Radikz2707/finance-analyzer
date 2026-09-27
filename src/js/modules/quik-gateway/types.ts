/**
 * Quik Gateway — типы для прямого канала данных из терминала QUIK.
 *
 * Модуль: src/js/modules/quik-gateway/
 * Скрипты-экспортёры: quik/export_news.lua, quik/export_orders.lua
 *
 * ⚠️ Политика безопасности: канал ТОЛЬКО на чтение. Отправка транзакций
 * в QUIK из этого модуля запрещена и не реализована.
 */

/** Одна запись новости из окна новостей QUIK (OnNews) */
export interface QuikNewsRecord {
  /** Уникальный код новости (из QLua news.code или сгенерированный) */
  id: string;
  /** Класс новости (передаётся первым аргументом OnNews) */
  className?: string;
  /** Время в формате ISO: "ГГГГ-ММ-ДДTЧЧ:ММ:СС" */
  time: string;
  /** Текст сообщения */
  text: string;
}

/** Операция заявки */
export type QuikOrderOperation = 'BUY' | 'SELL';

/** Статус заявки (совместим с QuikOrder из xlsx-parser) */
export type QuikOrderStatus =
  'АКТИВНА' | 'ИСПОЛНЕНА' | 'СНЯТА' | 'GTC (ПЕРЕНОС)';

/**
 * Запись заявки в JSON-файле (формат quik/export_orders.lua).
 * Поля согласованы с интерфейсом QuikOrder из
 * src/js/modules/xlsx-parser/quik-orders-parser.ts
 */
export interface QuikOrderData {
  /** Номер заявки */
  number: string;
  /** Код инструмента */
  ticker: string;
  /** Операция */
  operation: QuikOrderOperation;
  /** Количество */
  qty: number;
  /** Цена */
  price: number;
  /** Цена в % от номинала (для облигаций) */
  pricePercent: number;
  /** Признак облигации */
  isBond: boolean;
  /** Объём заявки (qty × price) */
  sum: number;
  /** Статус заявки */
  status: QuikOrderStatus;
  /** Код счёта */
  account: string;
  /** Исходный числовой статус QLua (0=активна, 1=исполнена, 2=снята) */
  statusCode?: number;
}

/**
 * Содержимое файла заявок.
 * Lua-скрипт пишет голый массив QuikOrderData[];
 * ридер дополнительно принимает обёртку { exportedAt, orders }.
 */
export interface QuikOrdersFile {
  /** Время экспорта (опционально) */
  exportedAt?: string;
  /** Заявки */
  orders: QuikOrderData[];
}

/** Конфигурация фасада QuikGateway */
export interface QuikGatewayConfig {
  /** Папка с файлами новостей (по умолчанию: <project>/data/quik) */
  newsDir?: string;
  /** Папка с файлами заявок (по умолчанию: <project>/data/quik) */
  ordersDir?: string;
}

/** Конфигурация читателя новостей */
export interface QuikNewsReaderConfig {
  /** Папка с файлами новостей (по умолчанию: <project>/data/quik) */
  newsDir?: string;
}

/** Конфигурация читателя заявок */
export interface QuikOrdersReaderConfig {
  /** Папка с файлами заявок (по умолчанию: <project>/data/quik) */
  ordersDir?: string;
}

/** Конфигурация источника новостей QuikNewsSource */
export interface QuikNewsSourceConfig {
  /** Включить источник */
  enabled?: boolean;
  /** Папка с файлами новостей */
  newsDir?: string;
  /** Читать новости за последние N дней (0 = все файлы) */
  daysBack?: number;
}
