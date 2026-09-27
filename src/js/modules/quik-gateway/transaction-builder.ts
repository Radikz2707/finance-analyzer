/**
 * Transaction Builder — подготовка транзакций QUIK БЕЗ автоотправки.
 *
 * Модуль: src/js/modules/quik-gateway/
 * Скрипт-исполнитель: quik/send_order.lua
 *
 * Поток безопасности (guardrails):
 *   InteractiveOrder PENDING → APPROVED (пользователем) → buildOrderRequest()
 *   → файл data/quik/order_request.json → РУЧНОЙ запуск send_order.lua в QUIK
 *   → результат в data/quik/order_result.json → readOrderResult().
 *
 * ⚠️ ВАЖНО: этот модуль ТОЛЬКО ПОДГОТАВЛИВАЕТ заявку (пишет JSON-файл).
 * Никакого автоматического вызова QUIK здесь нет и не будет.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getLogger } from '../logger/logger.js';
import type { InteractiveOrder } from '../pipeline/orders/interactive-orders.js';

/** Логгер модуля */
const log = getLogger('transaction-builder');

/** Операция заявки для QUIK: B = покупка, S = продажа */
export type QuikTransactionOperation = 'B' | 'S';

/**
 * Заявка QUIK (сериализуется в data/quik/order_request.json).
 * Поля соответствуют формату quik/send_order.lua.
 */
export interface QuikTransactionRequest {
  /** Класс инструмента (например, TQBR). Опционально — Lua использует дефолт. */
  classCode?: string;
  /** Код инструмента (тикер) */
  secCode: string;
  /** Операция: B (покупка) / S (продажа) */
  operation: QuikTransactionOperation;
  /** Количество (шт.) */
  qty: number;
  /** Цена (₽). Пусто/0 → рыночная заявка (Lua ставит TYPE='M') */
  price?: number;
  /** Код счёта (опционально) */
  account?: string;
  /** Комментарий (причина рекомендации) */
  comment?: string;
}

/** Результат выполнения send_order.lua (data/quik/order_result.json) */
export interface QuikOrderResult {
  /** Успешно ли принята заявка QUIK */
  ok: boolean;
  /** Номер заявки (при успехе) */
  orderNum?: string;
  /** Текст ошибки (при неудаче) */
  error?: string;
  /** Время выполнения (ISO, локальное) */
  time: string;
}

/** Единственное допустимое подтверждение для формирования заявки */
export type OrderUserConfirmation = 'APPROVED';

/** Папка по умолчанию для файлов заявок */
function defaultOrdersDir(): string {
  return (
    process.env.QUIK_ORDERS_DIR || path.resolve(process.cwd(), 'data', 'quik')
  );
}

/** Отображение действия ордера → операция QUIK (null — не отправляем) */
function mapActionToOperation(
  action: InteractiveOrder['action'],
): QuikTransactionOperation | null {
  switch (action) {
    case 'BUY':
      return 'B';
    case 'SELL':
    case 'REDUCE':
    case 'EXIT':
      return 'S';
    default:
      // HOLD и прочие действия не порождают заявок
      return null;
  }
}

/**
 * Сформировать запрос на заявку из подтверждённого интерактивного ордера.
 *
 * ЗАЩИТА ОТ СЛУЧАЙНОЙ ОТПРАВКИ: запрос формируется ТОЛЬКО при двойном
 * подтверждении — статус ордера APPROVED И аргумент userConfirmation === 'APPROVED'.
 * В противном случае возвращается null (заявка не готовится).
 *
 * @param interactiveOrder — ордер из конвейера (PENDING/REJECTED → null)
 * @param userConfirmation — явное подтверждение пользователя
 * @returns запрос заявки или null
 */
export function buildOrderRequest(
  interactiveOrder: InteractiveOrder,
  userConfirmation: OrderUserConfirmation,
): QuikTransactionRequest | null {
  if (!interactiveOrder || userConfirmation !== 'APPROVED') {
    return null;
  }
  if (interactiveOrder.approvalStatus !== 'APPROVED') {
    return null;
  }

  const operation = mapActionToOperation(interactiveOrder.action);
  if (!operation) {
    return null;
  }

  const qty = Math.floor(interactiveOrder.recommendedQuantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    return null;
  }

  const price =
    typeof interactiveOrder.recommendedPrice === 'number' &&
    Number.isFinite(interactiveOrder.recommendedPrice) &&
    interactiveOrder.recommendedPrice > 0
      ? interactiveOrder.recommendedPrice
      : undefined;

  return {
    secCode: interactiveOrder.ticker,
    operation,
    qty,
    price,
    comment: interactiveOrder.rationale || undefined,
  };
}

/**
 * Записать заявку в data/quik/order_request.json.
 *
 * @param request — сформированный запрос заявки
 * @param dir — папка (по умолчанию QUIK_ORDERS_DIR или <root>/data/quik)
 * @returns true при успешной записи
 */
export async function saveOrderRequest(
  request: QuikTransactionRequest,
  dir?: string,
): Promise<boolean> {
  const targetDir = dir ?? defaultOrdersDir();
  try {
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(
      path.join(targetDir, 'order_request.json'),
      JSON.stringify(request, null, 2) + '\n',
      'utf-8',
    );
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`Не удалось сохранить заявку: ${message}`);
    return false;
  }
}

/**
 * Прочитать результат выполнения send_order.lua.
 *
 * @param dir — папка (по умолчанию QUIK_ORDERS_DIR или <root>/data/quik)
 * @returns QuikOrderResult или null (файл отсутствует / битый JSON)
 */
export async function readOrderResult(
  dir?: string,
): Promise<QuikOrderResult | null> {
  const targetDir = dir ?? defaultOrdersDir();
  const filePath = path.join(targetDir, 'order_result.json');

  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch {
    // Файла ещё нет — это штатная ситуация (заявка не отправлялась)
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<QuikOrderResult>;
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    return {
      ok: Boolean(parsed.ok),
      orderNum:
        typeof parsed.orderNum === 'string' ? parsed.orderNum : undefined,
      error: typeof parsed.error === 'string' ? parsed.error : undefined,
      time: typeof parsed.time === 'string' ? parsed.time : '',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`Битый order_result.json: ${message}`);
    return null;
  }
}
