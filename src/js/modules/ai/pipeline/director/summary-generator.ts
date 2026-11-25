/**
 * SummaryGenerator — создаёт краткие выводы и объяснения "почему".
 *
 * Формирует:
 * - TL;DR: 2-3 предложения с главным выводом
 * - Объяснения: почему такая рекомендация
 * - Сценарии: A/B варианты с прогнозами
 * - Быстрые действия: кнопки для пользователя
 *
 * Используется Director для формирования структурированных ответов.
 */

export interface StructuredResponse {
  /** Краткий вывод (TL;DR) */
  summary: string;
  /** Объяснение "почему" */
  reasoning: string;
  /** Сценарии A/B */
  scenarios: Array<{
    name: string;
    description: string;
    expectedOutcome: string;
    risk: 'low' | 'medium' | 'high';
  }>;
  /** Быстрые действия (кнопки) */
  quickActions: Array<{
    label: string;
    action: string;
    emoji: string;
  }>;
  /** Полный ответ (если нужно больше деталей) */
  fullResponse?: string;
}

// STRUCTURED_PROMPT используется для генерации структурированных ответов через AI
// const STRUCTURED_PROMPT = `...`;

/** Генерация TL;DR из полного ответа */
export function extractTLDR(fullResponse: string): string {
  // Ищем первый абзац или первые 2-3 предложения
  const sentences = fullResponse.split(/[.!?]+/).filter((s) => s.trim().length > 10);
  if (sentences.length === 0) return fullResponse.substring(0, 200);

  // Берём первые 2-3 предложения
  const summary = sentences.slice(0, 3).join('.').trim() + '.';
  return summary.length > 300
    ? summary.substring(0, 300) + '...'
    : summary;
}

/** Добавление объяснения "почему" к ответу */
export function addReasoning(
  baseResponse: string,
  tickers: string[],
  _recommendation: string,
): string {
  if (tickers.length === 0) return baseResponse;

  const tickerList = tickers.map((t) => '• ' + t).join('\n');

  return baseResponse + '\n\n### Почему такая рекомендация:\n\n' +
    'Я учитываю:\n' +
    '• Концентрацию по ' + tickerList + '\n' +
    '• Текущую рыночную ситуацию\n' +
    '• Ваши предпочтения (консервативная стратегия)\n' +
    '• Историческую волатильность активов\n\n' +
    'Это не просто интуиция — это анализ данных.';
}

/** Формирование сценариев A/B */
export function generateScenarios(
  _ticker: string,
  _recommendation: string,
): Array<{ name: string; description: string; expectedOutcome: string; risk: 'low' | 'medium' | 'high' }> {
  const scenarios = [
    {
      name: 'Вариант А: Следовать рекомендации',
      description: 'Реализовать рекомендацию',
      expectedOutcome: 'Ожидаемый результат в течение 3-6 месяцев',
      risk: 'medium' as const,
    },
    {
      name: 'Вариант Б: Удержать позицию',
      description: 'Сохранить текущую позицию до лучших условий',
      expectedOutcome: 'Возможное восстановление или дальнейшее падение',
      risk: 'high' as const,
    },
  ];

  return scenarios;
}

/** Генерация быстрых действий */
export function generateQuickActions(
  _recommendation: string,
): Array<{ label: string; action: string; emoji: string }> {
  const actions = [
    { label: 'Принять рекомендацию', action: 'accept', emoji: '✅' },
    { label: 'Отклонить', action: 'reject', emoji: '❌' },
    { label: 'Подробнее', action: 'details', emoji: '📊' },
    { label: 'Обсудить', action: 'discuss', emoji: '💬' },
  ];

  return actions;
}

/** Создать структурированный ответ из AI-ответа */
export function createStructuredResponse(
  aiResponse: string | undefined,
  tickers: string[],
  recommendation: string,
): StructuredResponse {
  const summary = extractTLDR(aiResponse ?? '');
  const reasoning = addReasoning(aiResponse ?? '', tickers, recommendation);
  const scenarios = tickers.length > 0 && tickers[0]
    ? generateScenarios(tickers[0], recommendation)
    : [];
  const quickActions = generateQuickActions(recommendation);

  return {
    summary,
    reasoning,
    scenarios,
    quickActions,
    fullResponse: aiResponse,
  };
}

/** Форматирование структурированного ответа для отображения */
export function formatStructuredResponse(response: StructuredResponse): string {
  let formatted = '**TL;DR:** ' + response.summary + '\n\n';

  if (response.reasoning) {
    formatted += '**Почему такая рекомендация:**\n' + response.reasoning + '\n\n';
  }

  if (response.scenarios.length > 0) {
    formatted += '**Сценарии:**\n\n';
    for (const scenario of response.scenarios) {
      const riskEmoji = scenario.risk === 'low' ? '🟢' : scenario.risk === 'medium' ? '🟡' : '🔴';
      formatted += riskEmoji + ' **' + scenario.name + '**\n';
      formatted += scenario.description + '\n';
      formatted += 'Прогноз: ' + scenario.expectedOutcome + '\n\n';
    }
  }

  if (response.quickActions.length > 0) {
    formatted += '**Быстрые действия:**\n';
    for (const action of response.quickActions) {
      formatted += action.emoji + ' [' + action.label + ']\n';
    }
  }

  return formatted;
}
