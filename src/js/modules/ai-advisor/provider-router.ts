/**
 * AiProviderRouter — маршрутизация запросов между AI-провайдерами.
 *
 * Fallback-цепочка: Ollama → OpenRouter → GigaChat → YandexGPT.
 * Каждый провайдер защищён собственным CircuitBreaker (+ retry с backoff):
 * - после N ошибок подряд цепь размыкается — провайдер пропускается мгновенно,
 *   без повторного нагружения;
 * - транзиентные ошибки повторяются с экспоненциальной задержкой;
 * - открытая цепь одного провайдера НЕ блокирует остальных (shouldFallback=true).
 *
 * Модуль не меняет контракты AiClient: сюда передаются функции запросов,
 * результат — текст ответа и имя провайдера.
 */

import {
  CircuitBreaker,
  withRetry,
  withFallback,
  type CircuitBreakerSnapshot,
} from '../pipeline/infrastructure/circuit-breaker.js';

/** Функция запроса к конкретному AI-провайдеру */
export interface AiProviderQuery {
  (systemPrompt: string, userPrompt: string): Promise<string>;
}

export interface AiProviderDescriptor {
  /** id провайдера (соответствует id модели в ai-config) */
  id: string;
  /** Человекочитаемое имя для логов */
  name: string;
  /** Запрос к провайдеру */
  query: AiProviderQuery;
  /** Порог ошибок circuit breaker (по умолчанию 3) */
  failureThreshold?: number;
  /** Cooldown circuit breaker, мс (по умолчанию 30_000) */
  resetTimeoutMs?: number;
  /** Число повторов при транзиентной ошибке (по умолчанию 2) */
  retries?: number;
  /** Базовая задержка retry, мс (по умолчанию 100) */
  baseDelayMs?: number;
  /** Jitter для retry (по умолчанию false) */
  jitter?: boolean;
}

export interface AiProviderRouteResult {
  /** Текст ответа */
  text: string;
  /** id провайдера, который ответил */
  providerId: string;
  /** Имя провайдера для логов */
  providerName: string;
  /** Сколько провайдеров опробовано */
  attempts: number;
}

export class AiProviderRouter {
  private readonly breakers = new Map<string, CircuitBreaker>();

  /**
   * Выполнить запрос через fallback-цепочку провайдеров.
   * Провайдеры передаются в порядке приоритета (первый — primary).
   */
  async execute(
    providers: readonly AiProviderDescriptor[],
    systemPrompt: string,
    userPrompt: string,
  ): Promise<AiProviderRouteResult> {
    if (providers.length === 0) {
      throw new Error('AiProviderRouter: нет доступных провайдеров');
    }

    const steps = providers.map((provider) => {
      const breaker = this.getOrCreateBreaker(provider);
      return (): Promise<string> =>
        withRetry(
          () => breaker.execute(() => provider.query(systemPrompt, userPrompt)),
          {
            retries: provider.retries ?? 2,
            baseDelayMs: provider.baseDelayMs ?? 100,
            jitter: provider.jitter ?? false,
          },
        );
    });

    const result = await withFallback(steps[0]!, steps.slice(1), {
      labels: providers.map((p) => p.id),
      // Открытая цепь провайдера — не причина останавливать всю цепочку:
      // пропускаем разомкнутый провайдер и пробуем следующего.
      shouldFallback: () => true,
      onFallback: (from, to, error) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.log(`[AiRouter] ${from} → ${to}: ${msg}`);
      },
    });

    const winner = providers.find((p) => p.id === result.source);
    return {
      text: result.value,
      providerId: result.source,
      providerName: winner?.name ?? result.source,
      attempts: result.attempts,
    };
  }

  /** Снимки состояний всех известных circuit breaker (для мониторинга) */
  getState(): Record<string, CircuitBreakerSnapshot> {
    const snapshots: Record<string, CircuitBreakerSnapshot> = {};
    for (const [id, breaker] of this.breakers) {
      snapshots[id] = breaker.getState();
    }
    return snapshots;
  }

  private getOrCreateBreaker(provider: AiProviderDescriptor): CircuitBreaker {
    const existing = this.breakers.get(provider.id);
    if (existing) {
      return existing;
    }
    const breaker = new CircuitBreaker({
      failureThreshold: provider.failureThreshold ?? 3,
      resetTimeoutMs: provider.resetTimeoutMs ?? 30_000,
      onStateChange: (state, previous) => {
        console.log(
          `[AiRouter] Провайдер '${provider.id}' (${provider.name}): ${previous} → ${state}`,
        );
      },
    });
    this.breakers.set(provider.id, breaker);
    return breaker;
  }
}
