/**
 * External AI Judge — фабрика внешнего AI-судьи поверх BrowserGateway.
 *
 * Соединяет ReviewAgent с браузерным шлюзом:
 *   [ReviewAgent] → [ExternalAiJudge] → [BrowserGateway.validate()] → [External AI]
 *
 * Шлюз считается «сконфигурированным», когда после authenticate()
 * его состояние — 'running'. Если шлюз не сконфигурирован (idle/stopped/error)
 * или не передан — фабрика возвращает null, и внешний судья просто отключается
 * (no-op в ReviewAgent).
 */

import type {
  ExternalAiProvider,
  ExternalAiRequest,
  ExternalAiResponse,
} from '../browser-gateway/types.js';
import type { BrowserGateway } from '../browser-gateway/browser-gateway.js';
import type { ExternalAiJudge } from './review-agent.js';

/** Минимальный контракт шлюза, нужный фабрике */
export type ExternalJudgeGateway = Pick<
  BrowserGateway,
  'validate' | 'getState'
>;

/** Провайдер по умолчанию */
export const DEFAULT_EXTERNAL_JUDGE_PROVIDER: ExternalAiProvider = 'openai';

/**
 * Создать внешнего AI-судью поверх BrowserGateway.
 *
 * @param gateway — сконфигурированный шлюз (после authenticate)
 * @param provider — провайдер для отчёта (по умолчанию 'openai')
 * @returns судья для ReviewAgent или null, если шлюз не сконфигурирован
 */
export function createExternalAiJudge(
  gateway: ExternalJudgeGateway | null | undefined,
  provider: ExternalAiProvider = DEFAULT_EXTERNAL_JUDGE_PROVIDER,
): ExternalAiJudge | null {
  if (!gateway || gateway.getState() !== 'running') {
    console.log(
      '[ExternalAiJudge] Шлюз не сконфигурирован (state≠running) — ' +
        'внешний судья отключён',
    );
    return null;
  }

  return {
    provider,
    request: (req: ExternalAiRequest): Promise<ExternalAiResponse> =>
      gateway.validate(req),
  };
}
