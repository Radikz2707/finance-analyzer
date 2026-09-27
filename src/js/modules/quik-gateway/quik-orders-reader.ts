/**
 * QuikOrdersReader — чтение активных заявок QUIK из файлов, экспортированных
 * скриптом quik/export_orders.lua, и конвертация в интерфейс QuikOrder
 * (src/js/modules/xlsx-parser/quik-orders-parser.ts).
 *
 * Формат файла: orders_ГГГГММДД.json — JSON-массив QuikOrderData[]
 * (ридер также принимает обёртку { exportedAt, orders }).
 *
 * Заявки — только чтение. Отправка транзакций в QUIK запрещена.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getLogger } from '../logger/logger.js';
import type { QuikOrder } from '../xlsx-parser/quik-orders-parser.js';
import type {
  QuikOrderData,
  QuikOrderStatus,
  QuikOrdersReaderConfig,
} from './types.js';

/** Логгер модуля */
const log = getLogger('quik-orders-reader');

/** Формат имени файла заявок: orders_ГГГГММДД.json */
const ORDERS_FILE_PATTERN = /^orders_\d{8}\.json$/i;

/** Допустимые статусы QuikOrder */
const KNOWN_STATUSES: QuikOrderStatus[] = [
  'АКТИВНА',
  'ИСПОЛНЕНА',
  'СНЯТА',
  'GTC (ПЕРЕНОС)',
];

/** Числовой статус QLua → текстовый (по соглашению export_orders.lua) */
function statusFromCode(code: number): QuikOrderStatus {
  if (code === 0) return 'АКТИВНА';
  if (code === 1) return 'ИСПОЛНЕНА';
  return 'СНЯТА';
}

/** Привести статус из JSON к допустимому значению QuikOrderStatus */
function normalizeStatus(
  rawStatus: unknown,
  rawCode: unknown,
): QuikOrderStatus {
  if (typeof rawStatus === 'string') {
    const upper = rawStatus.trim().toUpperCase();
    if (upper.includes('ИСПОЛН')) return 'ИСПОЛНЕНА';
    if (upper.includes('АКТИВН')) return 'АКТИВНА';
    if (upper.includes('GTC')) return 'GTC (ПЕРЕНОС)';
    if (upper.includes('СНЯТ')) return 'СНЯТА';
    // Возможен русский статус в произвольном регистре/словах
    for (const known of KNOWN_STATUSES) {
      if (upper === known.toUpperCase()) return known;
    }
  }
  if (typeof rawCode === 'number' && Number.isFinite(rawCode)) {
    return statusFromCode(rawCode);
  }
  return 'СНЯТА';
}

/** Конвертация записи из JSON в QuikOrder (null — запись невалидна) */
function toQuikOrder(data: QuikOrderData): QuikOrder | null {
  const number = String(data.number ?? '').trim();
  const ticker = String(data.ticker ?? '').trim();
  const qty = Number(data.qty) || 0;
  const price = Number(data.price) || 0;

  // Пропускаем заявки без номера/тикера или с нулевыми qty/price
  if (!number || !ticker || qty <= 0 || price <= 0) return null;

  const operation: QuikOrder['operation'] =
    data.operation === 'SELL' ? 'SELL' : 'BUY';

  const pricePercent = Number(data.pricePercent) || price;
  const isBond = Boolean(data.isBond);
  const sum =
    Number(data.sum) > 0
      ? Number(data.sum)
      : Math.round(qty * price * 100) / 100;
  const account = String(data.account ?? 'НЕИЗВЕСТЕН').trim() || 'НЕИЗВЕСТЕН';

  return {
    number,
    ticker,
    operation,
    qty,
    price,
    pricePercent,
    isBond,
    sum,
    status: normalizeStatus(data.status, data.statusCode),
    account,
  };
}

/** Извлечь массив QuikOrderData из произвольного JSON-значения */
function extractOrderItems(parsed: unknown): QuikOrderData[] {
  if (Array.isArray(parsed)) {
    return parsed as QuikOrderData[];
  }
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    Array.isArray((parsed as { orders?: unknown }).orders)
  ) {
    return (parsed as { orders: unknown[] }).orders as QuikOrderData[];
  }
  return [];
}

/**
 * Читатель заявок QUIK.
 */
export class QuikOrdersReader {
  private readonly ordersDir: string;

  constructor(config?: QuikOrdersReaderConfig) {
    // Пути QUIK берутся ТОЛЬКО из .env (QUIK_ORDERS_DIR) с fallback на дефолт
    this.ordersDir =
      config?.ordersDir ||
      process.env.QUIK_ORDERS_DIR ||
      path.resolve(process.cwd(), 'data', 'quik');
  }

  /** Абсолютный путь к папке с заявками */
  getDirectory(): string {
    return this.ordersDir;
  }

  /** Доступен ли источник: папка существует и содержит файлы заявок */
  async isAvailable(): Promise<boolean> {
    try {
      const stat = await fs.stat(this.ordersDir);
      if (!stat.isDirectory()) return false;
      const files = await fs.readdir(this.ordersDir);
      return files.some((f) => ORDERS_FILE_PATTERN.test(f));
    } catch {
      return false;
    }
  }

  /** Список файлов заявок (по возрастанию даты в имени) */
  async listOrdersFiles(): Promise<string[]> {
    let files: string[];
    try {
      files = await fs.readdir(this.ordersDir);
    } catch {
      return [];
    }
    return files
      .filter((f) => ORDERS_FILE_PATTERN.test(f))
      .sort()
      .map((f) => path.join(this.ordersDir, f));
  }

  /** Путь к самому свежему файлу заявок (или null) */
  async findLatestOrdersFile(): Promise<string | null> {
    const files = await this.listOrdersFiles();
    return files.length > 0 ? files[files.length - 1]! : null;
  }

  /**
   * Прочитать активные заявки из последнего файла.
   * При отсутствии файлов возвращает пустой массив.
   */
  async readOrders(): Promise<QuikOrder[]> {
    const latestFile = await this.findLatestOrdersFile();
    if (!latestFile) return [];
    return this.parseOrdersFile(latestFile);
  }

  /**
   * Разобрать конкретный файл заявок в массив QuikOrder.
   * Невалидные записи пропускаются.
   */
  async parseOrdersFile(filePath: string): Promise<QuikOrder[]> {
    let raw: string;
    try {
      raw = await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn(`Не удалось прочитать ${filePath}: ${message}`);
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn(`Битый JSON в ${filePath}: ${message}`);
      return [];
    }

    const items = extractOrderItems(parsed);
    const orders: QuikOrder[] = [];

    for (const item of items) {
      if (typeof item !== 'object' || item === null) continue;
      const order = toQuikOrder(item as QuikOrderData);
      if (order !== null) {
        orders.push(order);
      }
    }
    return orders;
  }
}
