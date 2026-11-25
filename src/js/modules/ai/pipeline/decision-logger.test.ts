/**
 * Тесты для DecisionLogger.
 *
 * Покрытие:
 * - saveDecision — сохраняет решение, файл не читается (mock fs)
 * - updateDecisionResult — обновляет результат
 * - getAiContext — возвращает контекст с статистикой
 * - getWeights — возвращает веса
 *
 * ВНИМАНИЕ: mock fs через vi.hoisted для обхода hoisting vi.mock.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════
// Mocks (hoisted via vi.hoisted)
// ═══════════════════════════════════════════════

const mockFs = vi.hoisted(() => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock('fs', () => mockFs);

const mockPaths = vi.hoisted(() => ({
  resolveAppDataDir: vi.fn(),
}));
vi.mock('../../shared/app-paths.js', () => mockPaths);

// Импорт после mock
import { DecisionLogger } from './decision-logger.js';

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════

function getWrittenDecisions(callIndex = -1) {
  const writeMock = mockFs.writeFileSync as unknown as { mock: { calls: unknown[] } };
  const calls = writeMock.mock.calls;
  if (calls.length === 0) return [];
  const idx = callIndex < 0 ? calls.length + callIndex : callIndex;
  const callArgs = calls[idx] as unknown[];
  if (!callArgs) return [];
  return JSON.parse(callArgs[1] as string);
}

// ═══════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════

describe('DecisionLogger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockFs.readFileSync).mockReturnValue('[]');
    vi.mocked(mockFs.existsSync).mockReturnValue(true);
    vi.mocked(mockPaths.resolveAppDataDir).mockReturnValue('/tmp/test-appdata');
  });

  it('создаётся и сохраняет решение', () => {
    const logger = new DecisionLogger();
    const decision = logger.saveDecision(
      'SBER',
      'Сбербанк',
      'BUY',
      280,
      275,
      'Дивидендная доходность выше ЦБ',
    );

    expect(decision.ticker).toBe('SBER');
    expect(decision.assetName).toBe('Сбербанк');
    expect(decision.action).toBe('BUY');
    expect(decision.entryPrice).toBe(280);
    expect(decision.priceAtDecision).toBe(275);
    expect(decision.result).toBe('PENDING');
    expect(decision.id).toMatch(/^dec_/);
    expect(mockFs.writeFileSync).toHaveBeenCalled();
  });

  it('обновляет результат решения', () => {
    const logger = new DecisionLogger();
    const decision = logger.saveDecision(
      'GAZP',
      'Газпром',
      'HOLD',
      0,
      160,
      'Нейтральный фон',
    );

    logger.updateDecisionResult(decision.id, 'GOOD', 5.5);

    expect(mockFs.writeFileSync).toHaveBeenCalledTimes(2);
    const written = getWrittenDecisions(-1); // последний вызов
    expect(written[0].result).toBe('GOOD');
    expect(written[0].roiPercent).toBe(5.5);
    expect(written[0].resultTimestamp).toBeDefined();
  });

  it('возвращает пустой контекст при отсутствии решений', () => {
    const logger = new DecisionLogger();
    const context = logger.getAiContext('SBER');
    expect(context).toBe('');
  });

  it('возвращает контекст со статистикой после сохранения решений', () => {
    const logger = new DecisionLogger();
    logger.saveDecision(
      'SBER',
      'Сбербанк',
      'BUY',
      280,
      275,
      'Дивидендная доходность выше ЦБ',
    );
    logger.saveDecision(
      'GAZP',
      'Газпром',
      'SELL',
      0,
      160,
      'Падение добычи',
    );

    const context = logger.getAiContext();
    expect(context).toContain('История решений');
    expect(context).toContain('Всего решений: 2');
    // PENDING решения не показываются в секции «Последние решения»
    expect(context).toContain('Веса по действиям');
    expect(context).toContain('BUY: 0.0');
  });

  it('фильтрует контекст по тикеру', () => {
    const logger = new DecisionLogger();
    logger.saveDecision('SBER', 'Сбербанк', 'BUY', 280, 275, 'Дивиденды');
    logger.saveDecision('GAZP', 'Газпром', 'SELL', 0, 160, 'Падение');

    const context = logger.getAiContext('SBER');
    expect(context).toContain('SBER');
    expect(context).not.toContain('GAZP');
  });

  it('возвращает веса решений', () => {
    const logger = new DecisionLogger();
    logger.saveDecision('SBER', 'Сбербанк', 'BUY', 280, 275, 'Дивиденды');

    const weights = logger.getWeights();
    expect(weights.totalDecisions).toBe(1);
    expect(weights.successfulDecisions).toBe(0); // PENDING не считается
    expect(weights.actionWeights.BUY).toBe(0);
    expect(weights.categoryWeights).toBeDefined();
  });

  it('извлекает категорию из rationale', () => {
    const logger = new DecisionLogger();
    logger.saveDecision(
      'SBER',
      'Сбербанк',
      'BUY',
      280,
      275,
      'dividend yield attractive',
    );

    const weights = logger.getWeights();
    // PENDING решения не попадают в categoryWeights
    expect(weights.categoryWeights).toEqual({});
  });

  it('корректно считает веса после обновления результатов', () => {
    const logger = new DecisionLogger();
    const d1 = logger.saveDecision(
      'SBER',
      'Сбербанк',
      'BUY',
      280,
      275,
      'dividend yield',
    );
    const d2 = logger.saveDecision(
      'GAZP',
      'Газпром',
      'SELL',
      0,
      160,
      'technical breakdown',
    );

    logger.updateDecisionResult(d1.id, 'GOOD', 10);
    logger.updateDecisionResult(d2.id, 'BAD', -5);

    const weights = logger.getWeights();
    expect(weights.totalDecisions).toBe(2);
    expect(weights.successfulDecisions).toBe(1);
    expect(weights.actionWeights.BUY).toBe(1);
    expect(weights.actionWeights.SELL).toBe(-1);
    expect(weights.categoryWeights.dividend).toBe(1);
    expect(weights.categoryWeights.technical).toBe(-1);
  });
});
