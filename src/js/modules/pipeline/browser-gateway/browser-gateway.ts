/**
 * BrowserGateway — мост между Node.js и внешним миром.
 *
 * Архитектура:
 *   [Директор] → [BrowserGateway] → [happ.exe VPN] → [Playwright Browser] → [External AI]
 *
 * Функции:
 * 1. Запуск/остановка happ.exe (VPN-клиент)
 * 2. Управление headless браузером через Playwright
 * 3. Авторизация на внешних ИИ-сервисах
 * 4. Отправка запросов на валидацию качества
 * 5. Получение результатов внешнего судьи
 */

import { spawn } from 'child_process';
import type {
  GatewayState,
  GatewayStats,
  ExternalAiProvider,
  ExternalAiRequest,
  ExternalAiResponse,
  HappConfig,
  BrowserConfig,
  ExternalAiConfig,
} from './types.js';
import {
  DEFAULT_HAPP_PATH,
  DEFAULT_HAPP_ARGS,
  DEFAULT_HAPP_TIMEOUT_MS,
  DEFAULT_BROWSER_CONFIG,
  DEFAULT_OPENAI_MODEL,
} from './types.js';

// ──────────────────────────────────────────────
// BrowserGateway
// ──────────────────────────────────────────────

/**
 * BrowserGateway — браузерный/ОС шлюз.
 */
export class BrowserGateway {
  private _state: GatewayState = 'idle';
  private happProcess: ReturnType<typeof spawn> | null = null;
  private browser: Record<string, unknown> | null = null;
  private page: Record<string, unknown> | null = null;
  private happConfig: HappConfig;
  private browserConfig: BrowserConfig;
  private aiConfig: ExternalAiConfig | null = null;
  private stats: GatewayStats = {
    totalRequests: 0,
    successfulRequests: 0,
    errors: 0,
    avgResponseTimeMs: 0,
    happStarts: 0,
    browserStarts: 0,
  };
  private responseTimes: number[] = [];

  constructor(
    happConfig?: Partial<HappConfig>,
    browserConfig?: Partial<BrowserConfig>,
  ) {
    this.happConfig = {
      exePath: happConfig?.exePath ?? DEFAULT_HAPP_PATH,
      args: happConfig?.args ?? DEFAULT_HAPP_ARGS,
      startupTimeoutMs: happConfig?.startupTimeoutMs ?? DEFAULT_HAPP_TIMEOUT_MS,
      proxyPort: happConfig?.proxyPort,
    };
    this.browserConfig = {
      ...DEFAULT_BROWSER_CONFIG,
      ...browserConfig,
    };
  }

  /** Запустить happ.exe */
  async startHapp(): Promise<boolean> {
    if (this._state === 'running' && this.happProcess) {
      console.log('[BrowserGateway] happ.exe already running');
      return true;
    }

    this._state = 'starting';

    try {
      const args = this.happConfig.args ?? [];
      const exePath = this.happConfig.exePath ?? DEFAULT_HAPP_PATH;

      console.log(
        `[BrowserGateway] Запуск happ.exe: ${exePath} ${args.join(' ') || ''}`,
      );

      this.happProcess = spawn(exePath, args);

      this.happProcess?.stdout?.on('data', (data) => {
        console.log(`[happ.exe] ${data.toString().trim()}`);
      });

      this.happProcess?.stderr?.on('data', (data) => {
        console.error(`[happ.exe error] ${data.toString().trim()}`);
      });

      this.happProcess?.on('error', (err) => {
        console.error(`[BrowserGateway] happ.exe error: ${err.message}`);
        this._state = 'error';
      });

      this.happProcess?.on('close', (code) => {
        console.log(`[BrowserGateway] happ.exe closed with code ${code}`);
        if (this._state === 'starting' || this._state === 'running') {
          this._state = 'stopped';
        }
      });

      // Ждём запуска
      const timeout = this.happConfig.startupTimeoutMs ?? DEFAULT_HAPP_TIMEOUT_MS;
      await this.sleep(timeout);

      if (this.happProcess?.pid) {
        this._state = 'running';
        this.stats.happStarts++;
        console.log('[BrowserGateway] ✅ happ.exe запущен (PID: ' + this.happProcess.pid + ')');
        return true;
      }

      console.error('[BrowserGateway] ❌ happ.exe не удалось запустить');
      this._state = 'error';
      return false;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[BrowserGateway] Ошибка запуска happ.exe: ${errorMsg}`);
      this._state = 'error';
      return false;
    }
  }

  /** Остановить happ.exe */
  async stopHapp(): Promise<void> {
    if (!this.happProcess) return;

    console.log('[BrowserGateway] Остановка happ.exe...');

    try {
      // Graceful shutdown
      this.happProcess.kill('SIGTERM');

      await this.sleep(2000);

      // Если не остановился — force kill
      if (this.happProcess.pid) {
        try {
          this.happProcess.kill('SIGKILL');
        } catch {
          // Уже остановлен
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[BrowserGateway] Ошибка остановки happ.exe: ${errorMsg}`);
    }

    this.happProcess = null;
    this._state = this.browser ? 'running' : 'idle';
    console.log('[BrowserGateway] ✅ happ.exe остановлен');
  }

  /** Запустить браузер */
  async startBrowser(): Promise<boolean> {
    if (this._state === 'running' && this.browser) {
      console.log('[BrowserGateway] Browser already running');
      return true;
    }

    this._state = 'starting';

    try {
      console.log('[BrowserGateway] Запуск headless браузера...');

      // Динамический импорт Playwright (установить: npm install playwright)
      // playwright устанавливается опционально — тип определяется динамически
      let playwrightModule: Record<string, unknown>;
      try {
        // playwright устанавливается опционально
        // @ts-expect-error — playwright устанавливается опционально
        playwrightModule = await import('playwright');
      } catch {
        throw new Error(
          'Playwright not installed. Run: npm install playwright && npx playwright install',
        );
      }
      const { chromium } = playwrightModule;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const browserInstance = await (chromium as any).launch({
        headless: this.browserConfig.headless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
        ],
      });

      this.browser = browserInstance;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const context = await (browserInstance as any).newContext({
        userAgent: this.browserConfig.userAgent,
        viewport: { width: 1920, height: 1080 },
      });

      // Добавляем cookies если есть
      if (this.browserConfig.cookies && this.browserConfig.cookies.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (context as any).addCookies(this.browserConfig.cookies);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.page = await (context as any).newPage();

      // Устанавливаем localStorage если есть
      if (this.browserConfig.localStorage) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (this.page as any).addInitScript((storage: Record<string, string>) => {
          for (const [key, value] of Object.entries(storage)) {
            localStorage.setItem(key, value);
          }
        }, this.browserConfig.localStorage as Record<string, string>);
      }

      this._state = 'running';
      this.stats.browserStarts++;
      console.log('[BrowserGateway] ✅ Браузер запущен (headless)');
      return true;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[BrowserGateway] Ошибка запуска браузера: ${errorMsg}`);
      this._state = 'error';
      return false;
    }
  }

  /** Остановить браузер */
  async stopBrowser(): Promise<void> {
    if (!this.browser) return;

    console.log('[BrowserGateway] Остановка браузера...');

    try {
      if (this.page) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (this.page as any).close().catch(() => {});
        this.page = null;
      }

      if (this.browser) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (this.browser as any).close().catch(() => {});
        this.browser = null;
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[BrowserGateway] Ошибка остановки браузера: ${errorMsg}`);
    }

    this._state = this.happProcess ? 'running' : 'idle';
    console.log('[BrowserGateway] ✅ Браузер остановлен');
  }

  /** Авторизоваться на внешнем ИИ */
  async authenticate(
    provider: ExternalAiProvider,
    config: ExternalAiConfig,
  ): Promise<boolean> {
    this.aiConfig = config;
    this._state = 'authenticating';

    console.log(`[BrowserGateway] Авторизация на ${provider}...`);

    try {
      // Сохраняем API ключ в памяти
      // В продакшене — использовать secure storage

      if (provider === 'openai') {
        // Проверка API ключа через простой запрос
        const response = await fetch('https://api.openai.com/v1/models', {
          headers: {
            'Authorization': `Bearer ${config.apiKey}`,
          },
        });

        if (response.ok) {
          this._state = 'running';
          console.log('[BrowserGateway] ✅ Авторизация на OpenAI успешна');
          return true;
        } else {
          throw new Error(`HTTP ${response.status}: Invalid API key`);
        }
      } else {
        // Для других провайдеров — заглушка
        console.log(`[BrowserGateway] ⚠️ Авторизация на ${provider} — заглушка`);
        this._state = 'running';
        return true;
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[BrowserGateway] Ошибка авторизации: ${errorMsg}`);
      this._state = 'error';
      return false;
    }
  }

  /** Отправить запрос на валидацию */
  async validate(request: ExternalAiRequest): Promise<ExternalAiResponse> {
    this.stats.totalRequests++;
    const startTime = Date.now();

    console.log(
      `[BrowserGateway] Отправка запроса: ${request.task} (${this.aiConfig?.provider ?? 'not configured'})`,
    );

    try {
      if (!this.aiConfig) {
        throw new Error('AI provider not configured. Call authenticate() first.');
      }

      let content: string;

      if (this.aiConfig.provider === 'openai') {
        content = await this.callOpenAi(request);
      } else {
        throw new Error(`Unsupported provider: ${this.aiConfig.provider}`);
      }

      const durationMs = Date.now() - startTime;
      this.responseTimes.push(durationMs);

      // Обновляем статистику
      this.stats.successfulRequests++;
      this.stats.avgResponseTimeMs =
        this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length;

      // Извлекаем quality score из ответа если есть
      const qualityScore = this.extractQualityScore(content);

      return {
        success: true,
        content,
        modelUsed: this.aiConfig.model ?? DEFAULT_OPENAI_MODEL,
        durationMs,
        qualityScore,
        recommendations: this.extractRecommendations(content),
        warnings: this.extractWarnings(content),
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.stats.errors++;
      console.error(`[BrowserGateway] Ошибка запроса: ${errorMsg}`);

      return {
        success: false,
        content: '',
        error: errorMsg,
        modelUsed: this.aiConfig?.model ?? 'UNKNOWN',
        durationMs: Date.now() - startTime,
      };
    }
  }

  /** Получить состояние */
  getState(): GatewayState {
    return this._state;
  }

  /** Получить статистику */
  getStats(): GatewayStats {
    return { ...this.stats };
  }

  /** Очистить сессию */
  async clearSession(): Promise<void> {
    await this.stopBrowser();
    this.aiConfig = null;
    this.responseTimes = [];
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      errors: 0,
      avgResponseTimeMs: 0,
      happStarts: this.stats.happStarts,
      browserStarts: this.stats.browserStarts,
    };
    this._state = 'idle';
    console.log('[BrowserGateway] Сессия очищена');
  }

  // ── Helpers ──

  /** Вызов OpenAI API */
  private async callOpenAi(request: ExternalAiRequest): Promise<string> {
    if (!this.aiConfig) {
      throw new Error('AI config not set');
    }

    const baseUrl = this.aiConfig.baseUrl ?? 'https://api.openai.com/v1';
    const model = this.aiConfig.model ?? DEFAULT_OPENAI_MODEL;
    const systemPrompt =
      this.aiConfig.systemPrompt ??
      'Ты — внешний судья качества для финансовой аналитической системы. Оценивай объективно и предоставляй конкретные рекомендации.';

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.aiConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify(request, null, 2) },
        ],
        temperature: 0.3,
        max_tokens: 4000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? '';
  }

  /** Извлечь quality score из текста ответа */
  private extractQualityScore(content: string): number | undefined {
    const match = content.match(/quality[_\s]?score[:\s]*(\d{1,3})/i);
    if (match) {
      const score = parseInt(match[1], 10);
      if (!isNaN(score) && score >= 0 && score <= 100) {
        return score;
      }
    }
    return undefined;
  }

  /** Извлечь рекомендации из текста ответа */
  private extractRecommendations(content: string): string[] {
    const recommendations: string[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      // Ищем строки с рекомендациями (начинаются с -, *, •, или "Рекомендация:")
      if (
        trimmed.startsWith('- ') ||
        trimmed.startsWith('* ') ||
        trimmed.startsWith('• ') ||
        trimmed.toLowerCase().startsWith('рекомендация:')
      ) {
        recommendations.push(trimmed.replace(/^[-*•]\s*/i, '').replace(/^рекомендация:\s*/i, ''));
      }
    }

    return recommendations;
  }

  /** Извлечь предупреждения из текста ответа */
  private extractWarnings(content: string): string[] {
    const warnings: string[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      // Ищем строки с предупреждениями
      if (
        trimmed.toLowerCase().includes('warning') ||
        trimmed.toLowerCase().includes('предупреждение') ||
        trimmed.toLowerCase().includes('⚠️')
      ) {
        warnings.push(trimmed);
      }
    }

    return warnings;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
