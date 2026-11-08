/**
 * Quik Gateway — прямой двухсторонний канал данных из терминала QUIK.
 *
 * Модуль: src/js/modules/quik-gateway/
 * Скрипты-экспортёры: quik/export_news.lua, quik/export_orders.lua,
 *                     quik/send_order.lua
 *
 * Использование:
 *   const gateway = new QuikGateway();
 *   if (await gateway.isAvailable()) {
 *     const news = await gateway.readNews();
 *     const orders = await gateway.readOrders();
 *   }
 *
 * ⚠️ Канал работает ТОЛЬКО на чтение: отправка транзакций в QUIK запрещена.
 * Подготовка заявок (без автоотправки) — transaction-builder.ts: формирует
 * файл order_request.json для ручного запуска quik/send_order.lua.
 */

export * from './types.js';
export { QuikNewsReader, defaultQuikDir } from './quik-news-reader.js';
export { QuikOrdersReader } from './quik-orders-reader.js';
export { QuikNewsSource } from './quik-news-source.js';
export { QuikGateway } from './quik-gateway.js';
export * from './transaction-builder.js';
