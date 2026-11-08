/**
 * OSIntegration (Задача 2.3): мост к возможностям ОС через DI-провайдеры.
 */

export {
  ClipboardManager,
  LinkOpener,
  NotificationQueue,
  OS_DEFAULTS,
  OsIntegration,
  type NotificationInput,
  type OsIntegrationOptions,
} from './os-integration.js';
export type {
  ClipboardProvider,
  ClipboardRecord,
  ExternalOpener,
  NotificationProvider,
  NotificationRecord,
  NotificationUrgency,
  OsIntegrationAction,
  OsIntegrationOutput,
  OsIntegrationStatus,
  OsNotification,
} from './types.js';
