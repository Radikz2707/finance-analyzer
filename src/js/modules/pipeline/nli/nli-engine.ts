/**
 * NliEngine (Задача 3.2.2): фасад интерфейса на естественном языке.
 *
 * Разбирает запрос (IntentParser) и маршрутизирует к возможностям системы:
 * - dashboard → SmartDashboard.build (требует profile/interests/metrics).
 * - forecast/scenarios/anomalies/portfolio-status → честная подсказка,
 *   какие данные нужны (без выдуманных ответов — данные не выдумываются).
 * - help → список возможностей.
 * - unknown → честный отказ + подсказки.
 */

import type { NliParseResult, NliResponse } from './types.js';
import { IntentParser } from './intent-parser.js';
import {
  SmartDashboard,
  type SmartDashboardOutput,
} from '../visualization/smart-dashboard/smart-dashboard.js';
import type { DashboardMetrics } from '../visualization/smart-dashboard/types.js';
import type {
  InterestWeight,
  UserProfile,
} from '../personalization-engine/types.js';

export {
  IntentParser,
  INTENT_KEYWORDS,
  CATEGORY_KEYWORDS,
  IntentParserError,
  type IntentParserOptions,
} from './intent-parser.js';
export type {
  NliEntities,
  NliIntent,
  NliParseResult,
  NliResponse,
} from './types.js';

const HELP_MESSAGE = [
  'Я понимаю запросы:',
  '• «покажи портфель / dashboard» — сводка и адаптивный дашборд;',
  '• «прогноз потребностей на N дней» — предсказание нужных действий;',
  '• «сценарии для PORT» — best/base/worst;',
  '• «аномалии в портфеле» — spikes/drops/сдвиги;',
  '• «помощь» — этот список.',
].join('\n');

const HELP_SUGGESTIONS = [
  'покажи сводку портфеля',
  'прогноз потребностей на 7 дней',
  'аномалии',
  'помощь',
];

export interface NliEngineOptions {
  parser?: IntentParser;
  dashboard?: SmartDashboard;
}

export class NliEngine {
  private readonly parser: IntentParser;
  private readonly dashboard: SmartDashboard;

  constructor(options: NliEngineOptions = {}) {
    this.parser = options.parser ?? new IntentParser();
    this.dashboard = options.dashboard ?? new SmartDashboard();
  }

  /** Разбор запроса без выполнения. */
  parse(text: string): NliParseResult {
    return this.parser.parse(text);
  }

  /**
   * Полный цикл: parse → маршрутизация → NliResponse.
   * Никогда не бросает (честный success=false при проблемах).
   */
  async execute(
    text: string,
    context?: {
      profile?: UserProfile;
      interests?: InterestWeight[];
      metrics?: DashboardMetrics;
    },
  ): Promise<NliResponse> {
    try {
      const parsed = this.parse(text);
      switch (parsed.intent) {
        case 'help':
          return this.success(parsed, HELP_MESSAGE, HELP_SUGGESTIONS);
        case 'dashboard': {
          if (!context?.profile || !context.interests || !context.metrics) {
            return this.success(
              parsed,
              'Для дашборда нужны профиль, интересы и метрики — передайте их в контексте запроса.',
              ['пример: execute("сводка", { profile, interests, metrics })'],
            );
          }
          const output: SmartDashboardOutput = this.dashboard.build(
            context.profile,
            context.interests,
            context.metrics,
          );
          const widgetKinds = output.layout.widgets
            .map((w) => w.kind)
            .join(', ');
          return this.success(
            parsed,
            `Собрал дашборд: ${output.layout.widgets.length} виджетов (${widgetKinds}); сетка: ${output.layout.grid}.`,
            undefined,
            output,
          );
        }
        case 'forecast': {
          const horizon = parsed.entities.horizonDays;
          return this.success(
            parsed,
            `Прогноз потребностей готовится через PredictionEngine${horizon ? ` на ${horizon} дн.` : ''}. Данные истории решений пока не подключены к NLI — передайте их через prediction-engine.full-report.`,
            ['подключите PredictionEngine к NliEngine для сквозного ответа'],
          );
        }
        case 'scenarios':
          return this.success(
            parsed,
            'Сценарии best/base/worst строятся через PredictionEngine.plan-scenarios по временному ряду. Передайте ряд данных, чтобы получить расчёт.',
            [
              'пример: execute("сценарии", { metrics }) после подключения данных',
            ],
          );
        case 'anomalies':
          return this.success(
            parsed,
            'Аномалии (spike/drop/shift/volatility/flatline) детектирует PredictionEngine.detect-anomalies. Нужен временной ряд значений.',
            ['передайте ряд через context.metrics'],
          );
        case 'portfolio-status':
          return this.success(
            parsed,
            'Статус портфеля берётся из агрегатора дашборда. Передайте context.metrics.portfolio для числового ответа.',
            ['пример: execute("сколько стоит портфель", { metrics })'],
          );
        default:
          return {
            success: false,
            intent: 'unknown',
            message: `Не распознал запрос "${text}".`,
            suggestions: HELP_SUGGESTIONS,
          };
      }
    } catch (error) {
      return {
        success: false,
        intent: 'unknown',
        message: `Ошибка обработки запроса: ${
          error instanceof Error ? error.message : String(error)
        }`,
        suggestions: HELP_SUGGESTIONS,
      };
    }
  }

  private success(
    parsed: NliParseResult,
    message: string,
    suggestions?: string[],
    data?: unknown,
  ): NliResponse {
    return { success: true, intent: parsed.intent, message, suggestions, data };
  }
}
