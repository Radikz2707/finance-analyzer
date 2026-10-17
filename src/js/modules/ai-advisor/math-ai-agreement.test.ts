/**
 * Регрессионные тесты для MathAiAgreement.
 *
 * Проверяют:
 * 1. PLZL: PortfolioMath=REDUCE, AI=BUY → conflict=true, executionAllowed=false
 * 2. SBRB: PortfolioMath=EXIT, AI=BUY → conflict=true, executionAllowed=false
 * 3. Совместимые действия → conflict=false, executionAllowed=true
 * 4. ИИ возвращает неизвестное действие → рекомендация отклоняется
 * 5. Отсутствие результата одного из модулей → conflict=true
 */

import { agreeMathAndAi, isExecutionAllowed } from './math-ai-agreement.js';
import type { AiAction, PortfolioMathStatus, MathAgreement } from '../research/types.js';

describe('MathAiAgreement — согласование PortfolioMath и ИИ', () => {
  describe('PLZL сценарий: PortfolioMath=REDUCE, AI=BUY', () => {
    it('должен установить conflict=true', () => {
      const agreement = agreeMathAndAi(
        'PLZL',
        'REDUCE' as PortfolioMathStatus,
        'BUY' as AiAction,
        'DISAGREE' as MathAgreement,
      );

      expect(agreement.conflict).toBe(true);
      expect(agreement.mathAction).toBe('REDUCE');
      expect(agreement.aiAction).toBe('BUY');
    });

    it('должен установить requiresReview=true', () => {
      const agreement = agreeMathAndAi(
        'PLZL',
        'REDUCE' as PortfolioMathStatus,
        'BUY' as AiAction,
        'DISAGREE' as MathAgreement,
      );

      expect(agreement.requiresReview).toBe(true);
    });

    it('должен запретить исполнение (executionAllowed=false)', () => {
      const agreement = agreeMathAndAi(
        'PLZL',
        'REDUCE' as PortfolioMathStatus,
        'BUY' as AiAction,
        'DISAGREE' as MathAgreement,
      );

      expect(agreement.executionAllowed).toBe(false);
      expect(agreement.finalAction).toBeNull();
    });

    it('должен иметь статус CONFLICT', () => {
      const agreement = agreeMathAndAi(
        'PLZL',
        'REDUCE' as PortfolioMathStatus,
        'BUY' as AiAction,
        'DISAGREE' as MathAgreement,
      );

      expect(agreement.status).toBe('CONFLICT');
    });

    it('должен определить severity=high', () => {
      const agreement = agreeMathAndAi(
        'PLZL',
        'REDUCE' as PortfolioMathStatus,
        'BUY' as AiAction,
        'DISAGREE' as MathAgreement,
      );

      expect(agreement.conflictDetails?.severity).toBe('high');
    });
  });

  describe('SBRB сценарий: PortfolioMath=EXIT, AI=BUY', () => {
    it('должен установить conflict=true', () => {
      const agreement = agreeMathAndAi(
        'SBRB',
        'EXIT' as PortfolioMathStatus,
        'BUY' as AiAction,
        'DISAGREE' as MathAgreement,
      );

      expect(agreement.conflict).toBe(true);
    });

    it('должен запретить автоматическую торговую заявку', () => {
      const agreement = agreeMathAndAi(
        'SBRB',
        'EXIT' as PortfolioMathStatus,
        'BUY' as AiAction,
        'DISAGREE' as MathAgreement,
      );

      expect(agreement.executionAllowed).toBe(false);
      expect(agreement.finalAction).toBeNull();
    });

    it('должен установить requiresReview=true', () => {
      const agreement = agreeMathAndAi(
        'SBRB',
        'EXIT' as PortfolioMathStatus,
        'BUY' as AiAction,
        'DISAGREE' as MathAgreement,
      );

      expect(agreement.requiresReview).toBe(true);
    });
  });

  describe('Совместимые действия', () => {
    it('BUY + BUY → conflict=false, executionAllowed=true', () => {
      const agreement = agreeMathAndAi(
        'SBER',
        'BUY' as PortfolioMathStatus,
        'BUY' as AiAction,
        'AGREE' as MathAgreement,
      );

      expect(agreement.conflict).toBe(false);
      expect(agreement.executionAllowed).toBe(true);
      expect(agreement.finalAction).toBe('BUY');
      expect(agreement.status).toBe('AGREED');
    });

    it('EXIT + REDUCE → conflict=true (разный объём сделки)', () => {
      const agreement = agreeMathAndAi(
        'GAZP',
        'EXIT' as PortfolioMathStatus,
        'REDUCE' as AiAction,
        'AGREE' as MathAgreement,
      );

      // ИСПРАВЛЕНИЕ P0-3: EXIT (полный выход) и REDUCE (частичное сокращение)
      // представляют разный объём сделки → конфликт
      expect(agreement.conflict).toBe(true);
      expect(agreement.executionAllowed).toBe(false);
      expect(agreement.conflictDetails?.severity).toBe('high');
    });

    it('EXIT + SELL → conflict=true (разный объём сделки)', () => {
      const agreement = agreeMathAndAi(
        'GAZP',
        'EXIT' as PortfolioMathStatus,
        'SELL' as AiAction,
        'AGREE' as MathAgreement,
      );

      expect(agreement.conflict).toBe(true);
      expect(agreement.executionAllowed).toBe(false);
      expect(agreement.conflictDetails?.severity).toBe('high');
    });

    it('REDUCE + SELL → conflict=false (оба частичное уменьшение)', () => {
      const agreement = agreeMathAndAi(
        'VTBR',
        'REDUCE' as PortfolioMathStatus,
        'SELL' as AiAction,
        'AGREE' as MathAgreement,
      );

      expect(agreement.conflict).toBe(false);
      expect(agreement.executionAllowed).toBe(true);
    });

    it('HOLD + HOLD → conflict=false', () => {
      const agreement = agreeMathAndAi(
        'MOEX',
        'STABLE' as PortfolioMathStatus,
        'HOLD' as AiAction,
        'AGREE' as MathAgreement,
      );

      expect(agreement.conflict).toBe(false);
      expect(agreement.executionAllowed).toBe(true);
    });
  });

  describe('ИИ возвращает неизвестное действие', () => {
    it('неизвестное действие → conflict=true, executionAllowed=false', () => {
      const agreement = agreeMathAndAi(
        'TEST',
        'BUY' as PortfolioMathStatus,
        'AVOID' as AiAction,
        null,
      );

      // AVOID не совместим с BUY
      expect(agreement.conflict).toBe(true);
      expect(agreement.executionAllowed).toBe(false);
    });
  });

  describe('Отсутствие результата одного из модулей', () => {
    it('Только PortfolioMath → conflict=false, executionAllowed=true', () => {
      const agreement = agreeMathAndAi(
        'SBER',
        'BUY' as PortfolioMathStatus,
        null,
        null,
      );

      expect(agreement.conflict).toBe(false);
      expect(agreement.executionAllowed).toBe(true);
      expect(agreement.finalAction).toBe('BUY');
      expect(agreement.status).toBe('MATH_ONLY');
    });

    it('Только ИИ → conflict=true, executionAllowed=false', () => {
      const agreement = agreeMathAndAi(
        'SBER',
        null,
        'BUY' as AiAction,
        null,
      );

      expect(agreement.conflict).toBe(true);
      expect(agreement.executionAllowed).toBe(false);
      expect(agreement.requiresReview).toBe(true);
      expect(agreement.status).toBe('AI_ONLY');
    });

    it('Нет данных от обоих → conflict=false, executionAllowed=false', () => {
      const agreement = agreeMathAndAi(
        'SBER',
        null,
        null,
        null,
      );

      expect(agreement.conflict).toBe(false);
      expect(agreement.executionAllowed).toBe(false);
      expect(agreement.requiresReview).toBe(true);
      expect(agreement.status).toBe('NO_DATA');
    });
  });

  describe('isExecutionAllowed — защитные ограничения', () => {
    it('holdOnly + SELL → executionAllowed=false', () => {
      const agreement = agreeMathAndAi(
        'SBER',
        'SELL' as PortfolioMathStatus,
        'SELL' as AiAction,
        'AGREE' as MathAgreement,
      );

      expect(
        isExecutionAllowed(agreement, true /* holdOnly */, true, false),
      ).toBe(false);
    });

    it('holdOnly + BUY → executionAllowed=true', () => {
      const agreement = agreeMathAndAi(
        'SBER',
        'BUY' as PortfolioMathStatus,
        'BUY' as AiAction,
        'AGREE' as MathAgreement,
      );

      expect(
        isExecutionAllowed(agreement, true /* holdOnly */, true, false),
      ).toBe(true);
    });

    it('marketDataValid=false → executionAllowed=false', () => {
      const agreement = agreeMathAndAi(
        'SBER',
        'BUY' as PortfolioMathStatus,
        'BUY' as AiAction,
        'AGREE' as MathAgreement,
      );

      expect(
        isExecutionAllowed(agreement, false, false /* marketDataValid */, false),
      ).toBe(false);
    });

    it('executionBlocked=true → executionAllowed=false', () => {
      const agreement = agreeMathAndAi(
        'SBER',
        'BUY' as PortfolioMathStatus,
        'BUY' as AiAction,
        'AGREE' as MathAgreement,
      );

      expect(
        isExecutionAllowed(agreement, false, true, true /* executionBlocked */),
      ).toBe(false);
    });

    it('conflict=true → executionAllowed=false', () => {
      const agreement = agreeMathAndAi(
        'PLZL',
        'REDUCE' as PortfolioMathStatus,
        'BUY' as AiAction,
        'DISAGREE' as MathAgreement,
      );

      expect(isExecutionAllowed(agreement)).toBe(false);
    });
  });
});
