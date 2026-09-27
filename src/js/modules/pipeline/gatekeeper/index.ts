/**
 * Gatekeeper — привратник источников данных конвейера.
 *
 * Экспортирует типы и реализацию фильтрации/валидации входящих данных
 * (новости из RSS/MOEX и котировки) перед передачей агентам.
 */
export * from './types.js';
export * from './gatekeeper.js';
export * from './rss-source.js';
export * from './moex-source.js';
