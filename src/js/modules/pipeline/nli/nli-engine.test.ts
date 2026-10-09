/**
 * Тесты NLI (Задача 3.2): IntentParser, фасад NliEngine.
 *
 * Глобальные describe/it/expect/vi предоставляются vitest (globals: true в
 * vitest.config.ts). Явный `import ... from 'vitest'` в этом проекте создаёт
 * второй экземпляр @vitest/runner и ломает контекст — поэтому глобалы.
 */

import { IntentParser, IntentParserError, NliEngine } from './index.js';
import type { DashboardMetrics } from '../visualization/smart-dashboard/types.js';
import type {
  InterestWeight,
  UserProfile,
} from '../personalization-engine/types.js';

const FIXED_NOW = new Date('2026-06-15T12:00:00.000Z');

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    userId: 'user-1',
    riskAppetite: 'moderate',
    goals: [],
    preferredCategories: [],
    detailLevel: '',
    updatedAt: FIXED_NOW.toISOString(),
    ...overrides,
  };
}

const metrics: DashboardMetrics = {
  portfolio: { totalValue: 500_000, changePercent: 1.2, assetsCount: 5 },
  agents: [{ name: 'DataAgent', state: 'running' }],
};

const interests: InterestWeight[] = [
  {
    category: 'risks',
    weight: 1,
    rawScore: 10,
    lastInteractionAt: null,
    interactions: 10,
  },
];

// ─── IntentParser ─────────────────────────────────────────────────────────

describe('IntentParser', () => {
  const parser = new IntentParser();

  it('portfolio-status по ключевым словам', () => {
    const result = parser.parse('покажи мой портфель');
    expect(result.intent).toBe('portfolio-status');
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    // В matchedKeywords — корни слов (для матчинга падежей)
    expect(result.matchedKeywords).toContain('портфел');
  });

  it('forecast с горизонтами: «на 7 дней» и «на 2 недели»', () => {
    const days = parser.parse('прогноз потребностей на 7 дней');
    expect(days.intent).toBe('forecast');
    expect(days.entities.horizonDays).toBe(7);

    const weeks = parser.parse('прогноз на 2 недели');
    expect(weeks.intent).toBe('forecast');
    expect(weeks.entities.horizonDays).toBe(14);
  });

  it('scenarios и anomalies распознаются', () => {
    expect(parser.parse('какие сценарии возможны').intent).toBe('scenarios');
    expect(parser.parse('есть ли аномалии в данных').intent).toBe('anomalies');
  });

  it('dashboard по «сводка»', () => {
    expect(parser.parse('дай сводку').intent).toBe('dashboard');
  });

  it('help', () => {
    expect(parser.parse('что ты умеешь').intent).toBe('help');
  });

  it('тикетеры извлекаются (3–5 заглавных латинских букв), без дублей', () => {
    const result = parser.parse('прогноз для SBER GAZP SBER');
    expect(result.entities.tickers).toEqual(['SBER', 'GAZP']);
  });

  it('русские слова заглавными не считаются тикерами', () => {
    const result = parser.parse('ПОРТФЕЛЬ ПРОГНОЗ');
    expect(result.entities.tickers).toEqual([]);
  });

  it('нераспознанный запрос → unknown с честным confidence', () => {
    const result = parser.parse('абракадабра фырфыр');
    expect(result.intent).toBe('unknown');
    expect(result.confidence).toBe(0);
  });

  it('низкая уверенность (одно слово) → unknown при minConfidence=0.6', () => {
    const strict = new IntentParser({ minConfidence: 0.6 });
    const result = strict.parse('прогноз');
    expect(result.intent).toBe('unknown');
    expect(result.confidence).toBe(0.5);
  });

  it('пустой и нестроковый вход → честные ошибки', () => {
    expect(() => parser.parse('   ')).toThrow(IntentParserError);
    expect(() => parser.parse(42 as never)).toThrow(IntentParserError);
  });
});

// ─── NliEngine (фасад) ────────────────────────────────────────────────────

describe('NliEngine', () => {
  const engine = new NliEngine();

  it('help: список возможностей и подсказки', async () => {
    const response = await engine.execute('помощь');
    expect(response.success).toBe(true);
    expect(response.intent).toBe('help');
    expect(response.message).toContain('прогноз');
    expect(response.suggestions!.length).toBeGreaterThan(0);
  });

  it('dashboard с полным контекстом: data содержит раскладку', async () => {
    const response = await engine.execute('покажи сводку', {
      profile: makeProfile(),
      interests,
      metrics,
    });
    expect(response.success).toBe(true);
    expect(response.intent).toBe('dashboard');
    const data = response.data as {
      layout: { widgets: unknown[]; grid: string };
      cards: { portfolio?: unknown };
    };
    expect(data.layout.widgets.length).toBeGreaterThan(0);
    expect(data.cards.portfolio).toBeDefined();
  });

  it('dashboard без контекста → честная подсказка без выдуманных данных', async () => {
    const response = await engine.execute('покажи сводку');
    expect(response.success).toBe(true);
    expect(response.data).toBeUndefined();
    expect(response.message).toContain('нужны');
  });

  it('forecast с горизонтом упоминает его в ответе', async () => {
    const response = await engine.execute('прогноз потребностей на 7 дней');
    expect(response.success).toBe(true);
    expect(response.intent).toBe('forecast');
    expect(response.message).toContain('7 дн');
  });

  it('unknown → success=false с подсказками', async () => {
    const response = await engine.execute('абракадабра фырфыр');
    expect(response.success).toBe(false);
    expect(response.intent).toBe('unknown');
    expect(response.suggestions!.length).toBeGreaterThan(0);
  });

  it('пустой запрос → честная ошибка в ответе (не throw)', async () => {
    const response = await engine.execute('   ');
    expect(response.success).toBe(false);
    expect(response.message).toContain('Ошибка');
  });

  it('parse: разбор без выполнения', () => {
    const parsed = engine.parse('сценарии для SBER');
    expect(parsed.intent).toBe('scenarios');
    expect(parsed.entities.tickers).toEqual(['SBER']);
  });
});
