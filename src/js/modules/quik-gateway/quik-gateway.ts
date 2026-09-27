/**
 * QuikGateway — фасад прямого канала данных из терминала QUIK.
 *
 * Объединяет:
 * - QuikNewsReader  — новости из окна новостей QUIK (OnNews)
 * - QuikOrdersReader — активные заявки (getOrders)
 *
 * ⚠️ Политика безопасности: канал ТОЛЬКО на чтение. Отправка транзакций
 * в QUIK запрещена и не реализована.
 */

import { QuikNewsReader } from './quik-news-reader.js';
import { QuikOrdersReader } from './quik-orders-reader.js';
import type { QuikGatewayConfig, QuikNewsRecord } from './types.js';
import type { QuikOrder } from '../xlsx-parser/quik-orders-parser.js';

/**
 * Фасад QUIK-канала.
 */
export class QuikGateway {
  private readonly newsReader: QuikNewsReader;
  private readonly ordersReader: QuikOrdersReader;

  constructor(config?: QuikGatewayConfig) {
    this.newsReader = new QuikNewsReader({ newsDir: config?.newsDir });
    this.ordersReader = new QuikOrdersReader({
      ordersDir: config?.ordersDir,
    });
  }

  /** Читатель новостей (для точечного доступа) */
  get news(): QuikNewsReader {
    return this.newsReader;
  }

  /** Читатель заявок (для точечного доступа) */
  get orders(): QuikOrdersReader {
    return this.ordersReader;
  }

  /**
   * Доступен ли канал: папка data/quik существует и содержит
   * файлы новостей ИЛИ файлы заявок.
   */
  async isAvailable(): Promise<boolean> {
    const [news, orders] = await Promise.all([
      this.newsReader.isAvailable(),
      this.ordersReader.isAvailable(),
    ]);
    return news || orders;
  }

  /** Прочитать новости QUIK (с дедупликацией по тексту+времени) */
  async readNews(daysBack: number = 0): Promise<QuikNewsRecord[]> {
    return this.newsReader.readNews(daysBack);
  }

  /** Прочитать активные заявки QUIK из последнего файла */
  async readOrders(): Promise<QuikOrder[]> {
    return this.ordersReader.readOrders();
  }
}
