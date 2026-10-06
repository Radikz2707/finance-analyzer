/// <reference types="vitest/globals" />
/**
 * Тесты чистых функций рендера CLI-чата Директора.
 *
 * Рендер-модуль не имеет runtime-зависимостей, поэтому тесты не требуют
 * ни Node-окружения, ни браузера. ANSI-коды обрезаются через stripAnsi.
 */

import {
  actionLabel,
  buildBannerText,
  color,
  formatAgentResultLine,
  formatAuditEventLine,
  formatConsiliumRounds,
  formatFileTerminalAction,
  formatPlanLine,
  formatSynthesisLine,
  roleLabel,
  stripAnsi,
} from './director-chat-render.js';
import type {
  DirectorAuditEvent,
  MultiRoundConsiliumOutput,
} from '../src/js/modules/pipeline/director/director-types.js';

// ─── Helpers ───────────────────────────────────────────────────────

function makeEvent(overrides: Partial<DirectorAuditEvent>): DirectorAuditEvent {
  return {
    id: 'e1',
    timestamp: '2026-10-06T12:00:00.000Z',
    type: 'director.plan_created',
    actor: 'director',
    message: '',
    metadata: {},
    ...overrides,
  };
}

function makeConsilium(): MultiRoundConsiliumOutput {
  return {
    rounds: [
      {
        roundNumber: 1,
        roundType: 'initial',
        agentOpinions: [
          {
            role: 'ai',
            position:
              'Дефицит позиции SBER — докупить в пределах свободных средств.',
            action: 'BUY',
            confidence: 0.72,
            arguments: ['Отклонение от целевой доли 4.0 п.п.'],
          },
          {
            role: 'strategist',
            position: 'Стратегический риск: концентрация по PLZL 32%.',
            action: 'REDUCE',
            confidence: 0.6,
            arguments: ['Концентрация >25% повышает уязвимость портфеля.'],
          },
        ],
        pointsOfAgreement: [],
        pointsOfDisagreement: ['BUY против REDUCE'],
        positionChanges: [],
      },
      {
        roundNumber: 2,
        roundType: 'final',
        agentOpinions: [
          {
            role: 'ai',
            position: 'Дефицит позиции SBER — докупить.',
            action: 'BUY',
            confidence: 0.75,
            arguments: ['Свободные средства достаточны.'],
          },
          {
            role: 'strategist',
            position: 'Принято: сокращение не блокирует покупку.',
            action: 'BUY',
            confidence: 0.65,
            arguments: ['Согласовано с AI.'],
          },
        ],
        pointsOfAgreement: ['Докупить SBER'],
        pointsOfDisagreement: [],
        positionChanges: [
          {
            role: 'strategist',
            previousAction: 'REDUCE',
            newAction: 'BUY',
            reason: 'AI привёл аргументы о дефиците и свободных средствах',
          },
        ],
      },
    ],
    keyArguments: ['Дефицит SBER'],
    counterArguments: ['Концентрация PLZL'],
    pointsOfAgreement: ['Докупить SBER'],
    pointsOfDisagreement: [],
    finalRecommendation: {
      action: 'BUY',
      confidence: 0.75,
      reasoning: 'Дефицит позиции очевиден, свободные средства достаточны.',
    },
    directorReasoning:
      'Director учитывает мнения агентов без безусловного veto.',
    directorConfidence: 0.75,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('director-chat-render', () => {
  describe('formatPlanLine', () => {
    it('форматирует план: агенты из metadata + Консилиум: да', () => {
      const line = stripAnsi(
        formatPlanLine(
          makeEvent({
            message:
              'Подключены агенты: analysis, strategist, scenario. Consilium: true',
            metadata: { agents: ['analysis', 'strategist', 'scenario'] },
          }),
        ),
      );

      expect(line).toBe(
        '📋 План: подключены агенты [analysis, strategist, scenario], Консилиум: да',
      );
    });

    it('извлекает агентов из message, если metadata.agents нет', () => {
      const line = stripAnsi(
        formatPlanLine(
          makeEvent({
            message: 'Подключены агенты: analysis, ai. Consilium: false',
          }),
        ),
      );

      expect(line).toContain('[analysis, ai]');
      expect(line).toContain('Консилиум: нет');
    });
  });

  describe('formatAgentResultLine', () => {
    it('форматирует успешный результат агента с длительностью', () => {
      const line = stripAnsi(
        formatAgentResultLine(
          makeEvent({
            type: 'director.agent_result_received',
            message: 'Результат от strategist: ok',
            metadata: { durationMs: 12 },
          }),
        ),
      );

      expect(line).toBe('⚙️ strategist → ok (12ms)');
    });

    it('форматирует ошибку агента', () => {
      const line = stripAnsi(
        formatAgentResultLine(
          makeEvent({
            type: 'director.agent_result_received',
            message: 'Результат от research: error',
            metadata: { durationMs: 1500 },
          }),
        ),
      );

      expect(line).toBe('⛔ research → error (1500ms)');
    });
  });

  describe('formatConsiliumRounds', () => {
    it('показывает номер и тип раунда, позиции ролей и итог', () => {
      const text = stripAnsi(formatConsiliumRounds(makeConsilium()));

      expect(text).toContain('Консилиум · 2 раунд');
      expect(text).toContain('── Раунд 1 · initial ──');
      expect(text).toContain('── Раунд 2 · final ──');
      expect(text).toContain('AI: докупить — Дефицит позиции SBER');
      expect(text).toContain('Strategist: сократить — Стратегический риск');
      expect(text).toContain('Итог: докупить (уверенность 75%)');
      expect(text).toContain(
        'Обоснование Director: Director учитывает мнения агентов без безусловного veto.',
      );
    });

    it('показывает смену позиции (→) с причиной', () => {
      const text = stripAnsi(formatConsiliumRounds(makeConsilium()));

      expect(text).toContain('Смена позиций:');
      expect(text).toContain('↪ Strategist: сократить → докупить');
      expect(text).toContain(
        '— AI привёл аргументы о дефиците и свободных средствах',
      );
    });

    it('не показывает секцию смен позиций, если изменений нет', () => {
      const consilium = makeConsilium();
      consilium.rounds[1].positionChanges = [];
      const text = stripAnsi(formatConsiliumRounds(consilium));

      expect(text).not.toContain('Смена позиций:');
    });
  });

  describe('formatSynthesisLine / formatFileTerminalAction', () => {
    it('форматирует синтез Director', () => {
      const line = stripAnsi(
        formatSynthesisLine(
          makeEvent({
            type: 'director.synthesis_created',
            message: 'Итоговый вывод по портфелю',
          }),
        ),
      );

      expect(line).toBe('🧠 Синтез Director: Итоговый вывод по портфелю');
    });

    it('форматирует успешную файловую операцию', () => {
      const line = formatFileTerminalAction({
        role: 'file',
        success: true,
        summary: 'Файл записан: src/test.txt',
      });

      expect(line).toBe('✅ Файл записан: src/test.txt');
    });

    it('форматирует отклонённую SecurityAgent операцию', () => {
      const line = formatFileTerminalAction({
        role: 'terminal',
        success: true,
        summary: 'Операция отклонена: запрещено правилами безопасности',
        detail: { verdict: 'deny' },
      });

      expect(line).toBe(
        '⛔ Операция отклонена: запрещено правилами безопасности',
      );
    });

    it('форматирует require-confirmation как ⚠️', () => {
      const line = formatFileTerminalAction({
        role: 'file',
        success: true,
        summary: 'Требуется подтверждение: удаление файла',
        detail: { verdict: 'require-confirmation' },
      });

      expect(line).toBe('⚠️ Требуется подтверждение: удаление файла');
    });

    it('без summary использует честный fallback', () => {
      const line = formatFileTerminalAction({ role: 'file', success: true });

      expect(line).toBe('✅ Файловая операция выполнена');
    });
  });

  describe('formatAuditEventLine (диспетчер)', () => {
    it('маппит каждый тип события на строку', () => {
      expect(
        stripAnsi(
          formatAuditEventLine(
            makeEvent({
              type: 'director.consilium_started',
              metadata: { opinions: 3 },
            }),
          ),
        ),
      ).toContain('Консилиум начат (мнений: 3)');

      expect(
        stripAnsi(
          formatAuditEventLine(
            makeEvent({
              type: 'director.recommendation_formed',
              message: 'BUY (75%)',
            }),
          ),
        ),
      ).toBe('🎯 Рекомендация: BUY (75%)');
    });

    it('для неизвестного типа выводит type: message', () => {
      const line = stripAnsi(
        formatAuditEventLine(
          makeEvent({
            type: 'director.chat_message_sent',
            message: 'Ответ Director отправлен',
          }),
        ),
      );

      expect(line).toBe('💬 Ответ Director отправлен');
    });
  });

  describe('баннер и метки', () => {
    it('buildBannerText содержит все команды', () => {
      const banner = stripAnsi(buildBannerText());

      expect(banner).toContain('/help');
      expect(banner).toContain('/status');
      expect(banner).toContain('/log N');
      expect(banner).toContain('/panel');
      expect(banner).toContain('/quit');
      expect(banner).toContain('Финансовый Директор');
    });

    it('метки действий и ролей человекочитаемы', () => {
      expect(actionLabel('BUY')).toBe('докупить');
      expect(actionLabel(null)).toBe('без действия');
      expect(actionLabel('UNKNOWN')).toBe('UNKNOWN');
      expect(roleLabel('strategist')).toBe('Strategist');
      expect(roleLabel('unknown-role')).toBe('unknown-role');
    });
  });

  describe('ANSI-цвета', () => {
    it('color оборачивает текст, stripAnsi удаляет коды', () => {
      const painted = color.bold('x');
      expect(painted).not.toBe('x');
      expect(stripAnsi(painted)).toBe('x');
      expect(stripAnsi(color.dim('a') + color.green('b'))).toBe('ab');
    });
  });
});
