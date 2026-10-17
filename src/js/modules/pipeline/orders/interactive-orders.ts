/**
 * Interactive Orders — интерактивная обёртка для ордеров.
 *
 * Упаковывает рекомендации ИИ в структуру данных для:
 * 1. Инлайн-кнопок UI-дашборда
 * 2. Telegram-бота (кнопки [Утвердить и отправить в QUIK])
 * 3. Аудита и логирования
 *
 * Системе СТРОГО ЗАПРЕЩЕНО отправлять транзакции в QUIK автоматически.
 * Любое действие SELL/BUY должно быть утверждено пользователем.
 */

import { loadUserPolicy } from '../../../config/user-policy.js';
import type { AssetAnalysis } from '../../portfolio-math/portfolio-math.js';
import type { MathAiAgreement } from '../../ai-advisor/math-ai-agreement.js';

/** Минимальный интерфейс заявки QUIK (совместим с xlsx-parser и db-manager) */
interface OrderLike {
  ticker: string;
  operation?: 'BUY' | 'SELL';
  qty?: number;
  price?: number;
  status?: string;
  quantity?: number;
  side?: 'BUY' | 'SELL';
  type?: 'MARKET' | 'LIMIT';
  /** Идентификатор счёта (для разграничения ордеров на разных счетах) */
  accountId?: string;
}

// ──────────────────────────────────────────────
// 1. Типы данных интерактивных ордеров
// ────────────────────────

/** Статус утверждения ордера */
export type OrderApprovalStatus =
  'PENDING' | 'APPROVED' | 'REJECTED' | 'MODIFIED';

/** Тип действия ордера */
export type OrderActionType = 'BUY' | 'SELL' | 'HOLD' | 'REDUCE' | 'EXIT';

/** Интерактивный ордер для UI/Telegram */
export interface InteractiveOrder {
  /** Уникальный идентификатор ордера */
  id: string;
  /** Тикер актива */
  ticker: string;
  /** Название актива */
  assetName: string;
  /** Тип действия */
  action: OrderActionType;
  /** Рекомендуемое количество (шт.) */
  recommendedQuantity: number;
  /** Рекомендуемая цена (₽) */
  recommendedPrice?: number;
  /** Сумма операции (₽) */
  totalAmount: number;
  /** Статус утверждения */
  approvalStatus: OrderApprovalStatus;
  /** Причина рекомендации */
  rationale: string;
  /** Guardrail-предупреждения (если есть) */
  guardrailWarnings?: string[];
  /** Метка времени создания */
  createdAt: string;
}

/** Результат обработки интерактивного ордера */
export interface OrderActionResult {
  /** Успешно ли обработан */
  success: boolean;
  /** Сообщение для пользователя */
  message: string;
  /** Обновлённый ордер */
  order: InteractiveOrder;
}

// ──────────────────────────────────────────────
// 2. Генерация интерактивных ордеров из рекомендаций ИИ
// ──────────────────────

/**
 * Формирует массив интерактивных ордеров из анализа активов.
 * ИСПРАВЛЕНИЕ P0:
 * - ID ордера включает accountId для разграничения заявок на разных счетах
 * - MathAiAgreement обязателен при наличии assetsAnalysis
 * - Дедупликация учитывает реальные статусы заявок QUIK
 *
 * @param assetsAnalysis — результаты анализа портфеля
 * @param existingOrders — существующие заявки QUIK (для дедупликации)
 * @param mathAiAgreements — результаты согласования PortfolioMath и ИИ (ОБЯЗАТЕЛЕН при наличии активов)
 * @returns массив интерактивных ордеров
 */
export function buildInteractiveOrders(
  assetsAnalysis: AssetAnalysis[],
  existingOrders: OrderLike[] = [],
  mathAiAgreements?: Map<string, MathAiAgreement>,
): InteractiveOrder[] {
  const orders: InteractiveOrder[] = [];

  // ─── КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: дедупликация по тикеру + счёт ───
  // Существующие активные заявки группируются по (ticker, accountId)
  // чтобы заявки на разных счетах не сливались.
  const existingOrderKeys = new Map<string, OrderActionType>();

  for (const order of existingOrders) {
    const status = order.status || '';
    const side = (order.side || order.operation) as OrderActionType | undefined;
    const accountId = order.accountId || 'DEFAULT';

    // Учитываем только активные заявки
    if (
      (status === 'NEW' || status === 'PARTIAL' || status === 'АКТИВНА') &&
      side
    ) {
      const key = `${order.ticker.toUpperCase()}:${accountId}`;
      existingOrderKeys.set(key, side);
    }
  }

  // ─── КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: MathAiAgreement обязателен ───
  // Если assetsAnalysis не пустой и mathAiAgreements отсутствует —
  // это ошибка конфигурации. Блокируем генерацию ордеров.
  if (assetsAnalysis.length > 0 && !mathAiAgreements) {
    console.warn(
      '[InteractiveOrders] [BLOCKED] mathAiAgreements отсутствует при наличии активов. ' +
      'Генерация ордеров заблокирована для безопасности.',
    );
    return [];
  }

  for (const asset of assetsAnalysis) {
    // Пропускаем активы без позиции
    if (asset.currentPercent === 0) {
      continue;
    }

    // Пропускаем активы без целевой доли (NO_TARGET)
    if (asset.targetPercent === undefined) {
      continue;
    }

    // ─── Обязательная проверка MathAiAgreement ───
    const agreement = mathAiAgreements?.get(asset.ticker);
    if (agreement) {
      // conflict=true → requiresReview=true → executionAllowed=false
      if (agreement.conflict || agreement.requiresReview) {
        console.log(
          `[InteractiveOrders] [BLOCKED] ${asset.ticker}: ` +
          `conflict=${agreement.conflict}, requiresReview=${agreement.requiresReview}, ` +
          `executionAllowed=${agreement.executionAllowed}`,
        );
        continue; // Пропускаем создание ордера
      }

      // executionAllowed=false → блокируем
      if (!agreement.executionAllowed) {
        console.log(
          `[InteractiveOrders] [BLOCKED] ${asset.ticker}: executionAllowed=false`,
        );
        continue;
      }
    } else {
      // MathAiAgreement отсутствует для актива — это риск.
      // Блокируем ордер, если есть хоть один актив с agreement.
      const hasAnyAgreement = mathAiAgreements && mathAiAgreements.size > 0;
      if (hasAnyAgreement) {
        console.warn(
          `[InteractiveOrders] [BLOCKED] ${asset.ticker}: MathAiAgreement отсутствует, ` +
          'но другие активы имеют agreement. Блокируем для безопасности.',
        );
        continue;
      }
    }

    // Определяем действие на основе статуса PortfolioMath
    let action = mapPortfolioMathStatusToAction(asset.status);
    if (!action) {
      continue;
    }

    // Политика пользователя: тикеры из noSellTickers не продаются.
    // Снижение их доли — только размыванием (докупкой других активов).
    let noSellDowngraded = false;
    if (
      (action === 'REDUCE' || action === 'EXIT') &&
      loadUserPolicy().noSellTickers.includes(asset.ticker.toUpperCase())
    ) {
      action = 'HOLD';
      noSellDowngraded = true;
    }

    // ─── Дедупликация: проверяем (ticker, accountId) ───
    // Определяем accountId из asset (если есть) или используем DEFAULT
    const assetAccountId = asset.accountId || 'DEFAULT';
    const existingKey = `${asset.ticker.toUpperCase()}:${assetAccountId}`;

    if (existingOrderKeys.has(existingKey)) {
      const existingAction = existingOrderKeys.get(existingKey)!;
      if (existingAction === action) {
        // Уже есть активная заявка с таким же действием на этом счёте
        console.log(
          `[InteractiveOrders] [DUPLICATE] ${asset.ticker} (${assetAccountId}): ` +
          `existing=${existingAction}, proposed=${action}, skipping`,
        );
        continue;
      }
    }

    // Рассчитываем количество и сумму
    const quantity = calculateRecommendedQuantity(asset, action);
    const price = asset.currentPrice || asset.balancePrice;
    const totalAmount = quantity * price;

    // Формируем rationale
    const rationale = buildRationale(asset, action);

    // Проверяем guardrail-предупреждения
    let guardrailWarnings = checkGuardrailWarnings(asset);
    if (noSellDowngraded) {
      guardrailWarnings = [
        ...guardrailWarnings,
        `NO_SELL_POLICY: ${asset.ticker} — пользователь держит позицию, продажа ` +
          'не предлагается. Доля снижается докупкой других активов ' +
          `(математика PortfolioMath: ${asset.status})`,
      ];
    }

    orders.push({
      id: generateOrderId(asset.ticker, action, assetAccountId),
      ticker: asset.ticker,
      assetName: asset.name,
      action,
      recommendedQuantity: noSellDowngraded ? 0 : quantity,
      recommendedPrice: price,
      totalAmount: noSellDowngraded ? 0 : Math.round(totalAmount * 100) / 100,
      approvalStatus: 'PENDING',
      rationale,
      guardrailWarnings:
        guardrailWarnings.length > 0 ? guardrailWarnings : undefined,
      createdAt: new Date().toISOString(),
    });
  }

  return orders;
}

/**
 * Маппинг статуса PortfolioMath в действие ордера.
 */
function mapPortfolioMathStatusToAction(
  status: string,
): OrderActionType | null {
  switch (status) {
    case 'BUY':
      return 'BUY';
    case 'REDUCE':
      return 'REDUCE';
    case 'EXIT':
      return 'EXIT';
    case 'STABLE':
      return 'HOLD';
    default:
      return null;
  }
}

/**
 * Рассчитывает рекомендуемое количество для ордера.
 */
function calculateRecommendedQuantity(
  asset: AssetAnalysis,
  action: OrderActionType,
): number {
  switch (action) {
    case 'BUY': {
      // Для покупки: deficitRub / currentPrice
      if (asset.deficitRub > 0 && asset.currentPrice > 0) {
        return Math.floor(asset.deficitRub / asset.currentPrice);
      }
      return 0;
    }
    case 'REDUCE': {
      // Для редукции: часть позиции
      return Math.floor(asset.quantity * 0.5);
    }
    case 'EXIT': {
      // Для выхода: вся позиция
      return asset.quantity;
    }
    default:
      return 0;
  }
}

/**
 * Формирует обоснование ордера.
 */
function buildRationale(asset: AssetAnalysis, action: OrderActionType): string {
  const pnlPercent =
    asset.balancePrice > 0 && asset.currentPrice > 0
      ? ((asset.currentPrice - asset.balancePrice) / asset.balancePrice) * 100
      : 0;

  switch (action) {
    case 'BUY':
      return `Дефицит позиции: ${asset.deficitRub.toLocaleString('ru-RU')} ₽. Текущая доля ${asset.currentPercent.toFixed(1)}% vs целевая ${asset.targetPercent?.toFixed(1)}%. P&L: ${pnlPercent.toFixed(1)}%`;
    case 'REDUCE':
      return `Профицит позиции: ${Math.abs(asset.deficitRub).toLocaleString('ru-RU')} ₽. Текущая доля ${asset.currentPercent.toFixed(1)}% vs целевая ${asset.targetPercent?.toFixed(1)}%. P&L: ${pnlPercent.toFixed(1)}%`;
    case 'EXIT':
      return `Целевая доля 0%. Полная ликвидация позиции. P&L: ${pnlPercent.toFixed(1)}%`;
    case 'HOLD':
      return `Позиция в цели. Текущая доля ${asset.currentPercent.toFixed(1)}% ≈ целевая ${asset.targetPercent?.toFixed(1)}%. P&L: ${pnlPercent.toFixed(1)}%`;
    default:
      return 'Неизвестное действие';
  }
}

/**
 * Проверяет guardrail-предупреждения для актива.
 */
function checkGuardrailWarnings(asset: AssetAnalysis): string[] {
  const warnings: string[] = [];

  // Проверка на большую концентрацию
  if (asset.currentPercent > 25) {
    warnings.push(
      `⚠️ Концентрация ${asset.ticker} составляет ${asset.currentPercent.toFixed(1)}% — превышен лимит 25%`,
    );
  }

  // Проверка на большой убыток
  const pnlPercent =
    asset.balancePrice > 0 && asset.currentPrice > 0
      ? ((asset.currentPrice - asset.balancePrice) / asset.balancePrice) * 100
      : 0;

  if (pnlPercent < -30) {
    warnings.push(
      `⚠️ Глубокий убыток ${asset.ticker}: ${pnlPercent.toFixed(1)}%. Рассмотреть усреднение вместо продажи`,
    );
  }

  return warnings;
}

/**
 * Генерирует детерминированный ID ордера на основе тикера, действия и счёта.
 *
 * ИСПРАВЛЕНИЕ P0:
 * - ID включает accountId для разграничения ордеров на разных счетах
 * - Формат: `${ticker}_${action}_${accountId}` (например, "STME_SELL_S04J3LB")
 * - Повторная обработка отчёта не создаёт дублирующие заявки
 *
 * @param ticker — тикер актива
 * @param action — тип действия
 * @param accountId — идентификатор счёта (по умолчанию 'DEFAULT')
 */
function generateOrderId(
  ticker: string,
  action: OrderActionType,
  accountId: string = 'DEFAULT',
): string {
  return `${ticker}_${action}_${accountId}`;
}

// ──────────────────────────────────────────────
// 3. Форматирование для Telegram-кнопок
// ──────────────────────

/**
 * Формирует текст сообщения для Telegram с инлайн-кнопками.
 */
export function formatTelegramOrderMessage(orders: InteractiveOrder[]): string {
  if (orders.length === 0) {
    return '📊 <b>Рекомендации по портфелю</b>\n\nНет активных рекомендаций. Портфель в цели.';
  }

  let message = '📊 <b>Рекомендации по портфелю</b>\n\n';
  message += '⚠️ <i>Все операции требуют подтверждения!</i>\n\n';

  for (const order of orders) {
    const actionEmoji = getActionEmoji(order.action);
    const statusText = getStatusText(order.approvalStatus);

    message += `${actionEmoji} <b>${order.ticker}</b> (${order.assetName})\n`;
    message += `   Действие: ${order.action}\n`;
    message += `   Количество: ${order.recommendedQuantity} шт.\n`;
    message += `   Сумма: ${order.totalAmount.toLocaleString('ru-RU')} ₽\n`;
    message += `   ${order.rationale}\n`;

    if (order.guardrailWarnings) {
      for (const warning of order.guardrailWarnings) {
        message += `   ${warning}\n`;
      }
    }

    message += `   Статус: ${statusText}\n\n`;
  }

  message += '🔘 <b>Что делать?</b>\n';
  message += '/approve_all — утвердить все\n';
  message += '/reject_all — отклонить все\n';
  message += '/status — проверить статус ордеров';

  return message;
}

/**
 * Формирует массив инлайн-кнопок для Telegram.
 */
export function buildTelegramInlineKeyboard(
  orders: InteractiveOrder[],
): Array<Array<{ text: string; callback_data: string }>> {
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];

  // Кнопки для каждого ордера
  for (const order of orders) {
    const approveButton = {
      text: `✅ Утвердить ${order.ticker}`,
      callback_data: `order_approve:${order.id}`,
    };
    const rejectButton = {
      text: `❌ Отклонить ${order.ticker}`,
      callback_data: `order_reject:${order.id}`,
    };
    keyboard.push([approveButton, rejectButton]);
  }

  // Кнопки массовых действий
  keyboard.push([
    { text: '✅ Утвердить все', callback_data: 'approve_all' },
    { text: '❌ Отклонить все', callback_data: 'reject_all' },
  ]);

  keyboard.push([{ text: '📊 Статус ордеров', callback_data: 'order_status' }]);

  return keyboard;
}

// ──────────────────────────────────────────────
// 4. Обработка утверждения/отклонения
// ──────────────────────

/**
 * Обрабатывает утверждение ордера.
 */
export function approveOrder(
  orders: InteractiveOrder[],
  orderId: string,
): OrderActionResult {
  const orderIndex = orders.findIndex((o) => o.id === orderId);
  if (orderIndex === -1) {
    return {
      success: false,
      message: `Ордер ${orderId} не найден`,
      order: orders[0]!,
    };
  }

  const order = orders[orderIndex]!;
  order.approvalStatus = 'APPROVED';
  orders[orderIndex] = order;

  return {
    success: true,
    message: `✅ Ордер ${order.ticker} (${order.action}) утверждён. Ожидает подтверждения пользователем.`,
    order,
  };
}

/**
 * Обрабатывает отклонение ордера.
 */
export function rejectOrder(
  orders: InteractiveOrder[],
  orderId: string,
): OrderActionResult {
  const orderIndex = orders.findIndex((o) => o.id === orderId);
  if (orderIndex === -1) {
    return {
      success: false,
      message: `Ордер ${orderId} не найден`,
      order: orders[0]!,
    };
  }

  const order = orders[orderIndex]!;
  order.approvalStatus = 'REJECTED';
  orders[orderIndex] = order;

  return {
    success: true,
    message: `❌ Ордер ${order.ticker} (${order.action}) отклонён.`,
    order,
  };
}

/**
 * Получает статус всех ордеров.
 */
export function getOrderStatus(orders: InteractiveOrder[]): string {
  if (orders.length === 0) {
    return 'Нет активных ордеров';
  }

  let status = '📊 <b>Статус ордеров</b>\n\n';

  for (const order of orders) {
    const statusEmoji = getStatusEmoji(order.approvalStatus);
    status += `${statusEmoji} ${order.ticker}: ${order.action} — ${order.approvalStatus}\n`;
  }

  return status;
}

// ──────────────────────────────────────────────
// 5. Утилиты форматирования
// ──────────────────────

function getActionEmoji(action: OrderActionType): string {
  switch (action) {
    case 'BUY':
      return '🟢';
    case 'SELL':
      return '🔴';
    case 'HOLD':
      return '🟡';
    case 'REDUCE':
      return '🟠';
    case 'EXIT':
      return '⛔';
    default:
      return '⚪';
  }
}

function getStatusEmoji(status: OrderApprovalStatus): string {
  switch (status) {
    case 'PENDING':
      return '⏳';
    case 'APPROVED':
      return '✅';
    case 'REJECTED':
      return '❌';
    case 'MODIFIED':
      return '✏️';
    default:
      return '⚪';
  }
}

function getStatusText(status: OrderApprovalStatus): string {
  switch (status) {
    case 'PENDING':
      return 'Ожидает подтверждения';
    case 'APPROVED':
      return 'Утверждён';
    case 'REJECTED':
      return 'Отклонён';
    case 'MODIFIED':
      return 'Изменён';
    default:
      return 'Неизвестно';
  }
}
