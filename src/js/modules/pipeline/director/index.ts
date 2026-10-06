/**
 * Director Agent Module — главный интеллектуальный координатор системы.
 *
 * Экспортирует:
 * - типы (DirectorTask, DirectorPlan, ConsiliumRound, ...);
 * - NL-парсер естественного языка;
 * - планировщик делегирования;
 * - многораундовый Consilium;
 * - фасад делегирования агентам;
 * - стратегическую память Director;
 * - аудит-трейл решений;
 * - хранилище чат-сессий;
 * - проактивные сообщения;
 * - ядро DirectorAgent;
 * - браузерный чат-виджет.
 */

export * from './director-types.js';
export * from './nl-parser.js';
export * from './delegation-planner.js';
export * from './multi-round-consilium.js';
export * from './agent-facade.js';
export * from './director-memory.js';
export * from './director-audit.js';
export * from './chat-session.js';
export * from './proactive-suggester.js';
export * from './director-chat-commands.js';
export * from './director.js';
export * from './director-chat-widget.js';
