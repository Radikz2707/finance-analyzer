/**
 * BrowserGateway Types — типы и интерфейсы для браузерного/ОС шлюза.
 *
 * BrowserGateway — мост между Node.js и внешним миром:
 * 1. Запуск happ.exe (VPN-клиент)
 * 2. Управление Playwright браузером (headless)
 * 3. Авторизация на внешних ИИ-сервисах (OpenAI/ChatGPT)
 * 4. Отправка запросов на валидацию качества
 * 5. Получение результатов внешнего судьи
 */

// ──────────────────────────────────────────────
// 1. Состояние шлюза
// ──────────────────────────────────────────────

/** Состояние BrowserGateway */
export type GatewayState = 'idle' | 'starting' | 'running' | 'authenticating' | 'stopped' | 'error';

/** Тип внешнего ИИ-сервиса */
export type ExternalAiProvider = 'openai' | 'anthropic' | 'custom';

// ──────────────────────────────────────────────
// 2. Конфигурация happ.exe
// ──────────────────────────────────────────────

/** Конфигурация happ.exe */
export interface HappConfig {
  /** Путь к happ.exe */
  exePath?: string;
  /** Аргументы запуска */
  args?: string[];
  /** Таймаут ожидания запуска (мс) */
  startupTimeoutMs?: number;
  /** Порт локального прокси */
  proxyPort?: number;
}

/** Дефолтный путь к happ.exe */
export const DEFAULT_HAPP_PATH = 'C:\\Program Files\\happ\\happ.exe';
export const DEFAULT_HAPP_ARGS = ['--silent', '--vpn'];
export const DEFAULT_HAPP_TIMEOUT_MS = 10000;

// ──────────────────────────────────────────────
// 3. Конфигурация браузера
// ──────────────────────────────────────────────

/** Конфигурация Playwright браузера */
export interface BrowserConfig {
  /** Заголовочный браузер (headless) */
  headless: boolean;
  /** Браузер: chromium/firefox/webkit */
  browserName?: 'chromium' | 'firefox' | 'webkit';
  /** Таймаут страницы (мс) */
  timeoutMs?: number;
  /** User-Agent */
  userAgent?: string;
  /** Cookies для авторизации */
  cookies?: Array<{
    name: string;
    value: string;
    domain: string;
    path?: string;
  }>;
  /** Local storage items */
  localStorage?: Record<string, string>;
}

/** Дефолтная конфигурация браузера */
export const DEFAULT_BROWSER_CONFIG: BrowserConfig = {
  headless: true,
  browserName: 'chromium',
  timeoutMs: 30000,
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

// ──────────────────────────────────────────────
// 4. Конфигурация внешнего ИИ
// ──────────────────────────────────────────────

/** Конфигурация внешнего ИИ-провайдера */
export interface ExternalAiConfig {
  /** Провайдер */
  provider: ExternalAiProvider;
  /** API ключ */
  apiKey: string;
  /** Base URL (для совместимых API) */
  baseUrl?: string;
  /** Модель */
  model?: string;
  /** Система промпт */
  systemPrompt?: string;
}

/** Дефолтная модель OpenAI */
export const DEFAULT_OPENAI_MODEL = 'gpt-4o';

// ──────────────────────────────────────────────
// 5. Запрос/ответ к внешнему ИИ
// ──────────────────────────────────────────────

/** Запрос к внешнему ИИ для валидации */
export interface ExternalAiRequest {
  /** Задача: validate/review/analyze */
  task: 'validate' | 'review' | 'analyze' | 'judge';
  /** Входные данные */
  input: Record<string, unknown>;
  /** Контекст (предыдущие результаты) */
  context?: Record<string, unknown>;
  /** Дополнительные параметры */
  options?: Record<string, unknown>;
}

/** Ответ от внешнего ИИ */
export interface ExternalAiResponse {
  /** Успешен ли ответ */
  success: boolean;
  /** Текст ответа */
  content: string;
  /** Ошибка (если была) */
  error?: string;
  /** Использованная модель */
  modelUsed: string;
  /** Затраченное время (мс) */
  durationMs: number;
  /** Оценка качества (0-100) */
  qualityScore?: number;
  /** Рекомендации */
  recommendations?: string[];
  /** Предупреждения */
  warnings?: string[];
}

// ──────────────────────────────────────────────
// 6. Результат работы шлюза
// ──────────────────────────────────────────────

/** Результат валидации внешним ИИ */
export interface GatewayValidationResult {
  /** ID сессии */
  sessionId: string;
  /** Время выполнения */
  executedAt: string;
  /** Провайдер */
  provider: ExternalAiProvider;
  /** Модель */
  modelUsed: string;
  /** Результат валидации */
  validation: ExternalAiResponse;
  /** Статус happ.exe */
  happStatus: 'running' | 'stopped' | 'error';
  /** Статус браузера */
  browserStatus: 'connected' | 'disconnected' | 'error';
}

// ──────────────────────────────────────────────
// 7. Интерфейс BrowserGateway
// ──────────────────────────────────────────────

/** Интерфейс BrowserGateway */
export interface IGateway {
  /** Запустить happ.exe */
  startHapp(): Promise<boolean>;
  /** Остановить happ.exe */
  stopHapp(): Promise<void>;
  /** Запустить браузер */
  startBrowser(): Promise<boolean>;
  /** Остановить браузер */
  stopBrowser(): Promise<void>;
  /** Авторизоваться на внешнем ИИ */
  authenticate(provider: ExternalAiProvider, config: ExternalAiConfig): Promise<boolean>;
  /** Отправить запрос на валидацию */
  validate(input: ExternalAiRequest): Promise<ExternalAiResponse>;
  /** Получить состояние */
  getState(): GatewayState;
  /** Очистить сессию */
  clearSession(): Promise<void>;
}

// ──────────────────────────────────────────────
// 8. Статистика
// ──────────────────────────────────────────────

/** Статистика BrowserGateway */
export interface GatewayStats {
  /** Всего запросов к внешнему ИИ */
  totalRequests: number;
  /** Успешных запросов */
  successfulRequests: number;
  /** Ошибок */
  errors: number;
  /** Среднее время ответа (мс) */
  avgResponseTimeMs: number;
  /** Запусков happ.exe */
  happStarts: number;
  /** Запусков браузера */
  browserStarts: number;
}
