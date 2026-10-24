/// <reference types="vitest/globals" />
/**
 * Unit-тесты чистых утилит desktop/renderer/utils.ts.
 *
 * Все тестируемые функции не зависят от DOM и работают в чистом Node.
 */

import { describe, it, expect } from 'vitest';
import {
  escapeHtmlReport,
  renderAnalysisReport,
  activityCssClass,
  formatLocalTime,
} from './utils.js';
import type { LastAnalysisInfo } from '../api-types.js';
import type { DirectorAuditEvent } from '../src/js/modules/pipeline/director/director-types.js';

// ──────────────────────────────────────────────
// escapeHtmlReport
// ──────────────────────────────────────────────

describe('escapeHtmlReport', () => {
  it('экранирует амперсанд', () => {
    expect(escapeHtmlReport('A & B')).toBe('A &amp; B');
  });

  it('экранирует угловые скобки < и >', () => {
    expect(escapeHtmlReport('<div>')).toBe('&lt;div&gt;');
  });

  it('экранирует двойные и одинарные кавычки', () => {
    expect(escapeHtmlReport('"test"')).toBe('&quot;test&quot;');
    expect(escapeHtmlReport("it's")).toBe('it&#39;s');
  });

  it('экранирует все спецсимволы одновременно', () => {
    const input = '& < > " \' ';
    const expected = '&amp; &lt; &gt; &quot; &#39; ';
    expect(escapeHtmlReport(input)).toBe(expected);
  });

  it('нейтрализует XSS- payloads', () => {
    expect(escapeHtmlReport('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
    expect(escapeHtmlReport('<img src=x onerror=alert(1)>')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;',
    );
    expect(escapeHtmlReport('"><svg/onload=alert(1)>')).toBe(
      '&quot;&gt;&lt;svg/onload=alert(1)&gt;',
    );
    expect(escapeHtmlReport('<iframe src="evil.com">')).toBe(
      '&lt;iframe src=&quot;evil.com&quot;&gt;',
    );
  });

  it('обычный текст проходит без изменений', () => {
    expect(escapeHtmlReport('Hello, world!')).toBe('Hello, world!');
    expect(escapeHtmlReport('Привет, мир!')).toBe('Привет, мир!');
  });

  it('пустая строка возвращает пустую строку', () => {
    expect(escapeHtmlReport('')).toBe('');
  });

  it('Unicode-текст проходит без изменений', () => {
    expect(escapeHtmlReport('Русский текст')).toBe('Русский текст');
    expect(escapeHtmlReport('📈📉 Финансы')).toBe('📈📉 Финансы');
    expect(escapeHtmlReport('日本語テスト')).toBe('日本語テスト');
  });

  it('числовые значения корректно преобразуются', () => {
    expect(escapeHtmlReport(String(123))).toBe('123');
    expect(escapeHtmlReport(String(-45.67))).toBe('-45.67');
  });

  it('несколько вхождений одного символа', () => {
    expect(escapeHtmlReport('a & b & c')).toBe('a &amp; b &amp; c');
    expect(escapeHtmlReport('<a><b><c>')).toBe('&lt;a&gt;&lt;b&gt;&lt;c&gt;');
  });
});

// ──────────────────────────────────────────────
// renderAnalysisReport
// ──────────────────────────────────────────────

describe('renderAnalysisReport', () => {
  function makeSampleInfo(
    overrides: Partial<LastAnalysisInfo> = {},
  ): LastAnalysisInfo {
    return {
      text: 'Тестовая сводка',
      finishedAt: '2026-10-21T07:00:00Z',
      elapsedMs: 12340,
      sourceLabel: 'portfolio.xlsx',
      totalValue: 1_500_000,
      assets: [
        {
          ticker: 'SBER',
          name: 'Сбербанк',
          currentPercent: 35.4,
          targetPercent: 30,
          deficitRub: 81_000,
          status: 'ok',
          unrealizedProfitRub: 50_000,
          isConcentrated: true,
        },
        {
          ticker: 'GAZP',
          name: 'Газпром',
          currentPercent: 12,
          targetPercent: 20,
          deficitRub: 210_000,
          status: 'deficit',
          unrealizedProfitRub: -15_000,
        },
      ],
      alerts: [
        {
          ticker: 'SBER',
          name: 'Сбербанк',
          currentPrice: 285,
          alertLevel: 'warning',
        },
      ],
      ...overrides,
    };
  }

  it('рендерит карточки-показатели', () => {
    const html = renderAnalysisReport(makeSampleInfo());
    expect(html).toContain('Стоимость портфеля');
    expect(html).toMatch(/1\s?500\s?000\s?₽/);
    expect(html).toContain('Нереализованный P&L');
    expect(html).toContain('Активов');
    expect(html).toContain('2');
    expect(html).toContain('Макс. отклонение');
  });

  it('положительный P&L получает класс pos', () => {
    const html = renderAnalysisReport(makeSampleInfo());
    expect(html).toContain('card-value pos');
  });

  it('отрицательный P&L получает класс neg', () => {
    const html = renderAnalysisReport(makeSampleInfo({
      assets: [
        {
          ticker: 'SBER',
          name: 'Сбербанк',
          currentPercent: 30,
          targetPercent: 30,
          deficitRub: 0,
          status: 'ok',
          unrealizedProfitRub: -50_000,
        },
      ],
    }));
    expect(html).toContain('card-value neg');
  });

  it('нулевой P&L без классов pos/neg', () => {
    const html = renderAnalysisReport(makeSampleInfo({
      assets: [
        {
          ticker: 'SBER',
          name: 'Сбербанк',
          currentPercent: 30,
          targetPercent: 30,
          deficitRub: 0,
          status: 'ok',
          unrealizedProfitRub: 0,
        },
      ],
    }));
    // totalPnl = 0, значит класс не должен добавляться
    expect(html).toContain('card-value');
    // Проверяем что нет "card-value pos" или "card-value neg" для P&L
    const pnlMatch = html.match(/card-value\s+(pos|neg)[^>]*>\s*0\s*₽/);
    expect(pnlMatch).toBeNull();
  });

  it('рендерит таблицу активов', () => {
    const html = renderAnalysisReport(makeSampleInfo());
    expect(html).toContain('Структура портфеля');
    expect(html).toContain('<b>SBER</b>');
    expect(html).toContain('<b>GAZP</b>');
    expect(html).toContain('35.4%');
    expect(html).toContain('30.0%');
    expect(html).toContain('12.0%');
    expect(html).toContain('20.0%');
  });

  it('отклонение рассчитывается корректно', () => {
    const html = renderAnalysisReport(makeSampleInfo());
    expect(html).toContain('5.4 п.п.');
    expect(html).toContain('-8.0 п.п.');
  });

  it('флаг концентрации добавляет класс warn', () => {
    const html = renderAnalysisReport(makeSampleInfo());
    expect(html).toContain('class="warn"');
    expect(html).toContain('концентрация');
  });

  it('нейтрализует XSS в тикере/имени/статусе', () => {
    const html = renderAnalysisReport(makeSampleInfo({
      assets: [
        {
          ticker: '<script>alert(1)</script>',
          name: 'Злобная <b>акция</b>',
          currentPercent: 10,
          targetPercent: 10,
          deficitRub: 0,
          status: '"ok"',
          unrealizedProfitRub: 0,
        },
      ],
    }));
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;акция&lt;/b&gt;');
    expect(html).toContain('&quot;ok&quot;');
    expect(html).not.toContain('<script>');
  });

  it('рендерит ценовые алерты', () => {
    const html = renderAnalysisReport(makeSampleInfo());
    expect(html).toContain('Ценовые алерты');
    expect(html).toContain('<b>SBER</b>');
    expect(html).toContain('warning');
    expect(html).toContain('цена 285');
  });

  it('алерты без currentPrice не показывают цену', () => {
    const html = renderAnalysisReport(makeSampleInfo({
      alerts: [{ ticker: 'VTBR', alertLevel: 'alert' }],
    }));
    expect(html).toContain('<b>VTBR</b>');
    expect(html).not.toContain('цена');
  });

  it('пустые активы и алерты — только карточки', () => {
    const html = renderAnalysisReport(makeSampleInfo({
      assets: [],
      alerts: [],
    }));
    expect(html).toContain('Стоимость портфеля');
    expect(html).toContain('Активов');
    expect(html).toContain('0');
    expect(html).not.toContain('Структура портфеля');
    expect(html).not.toContain('Ценовые алерты');
  });

  it('undefined поля обрабатываются корректно', () => {
    const html = renderAnalysisReport(makeSampleInfo({
      totalValue: undefined as unknown as number,
      assets: undefined as unknown as readonly any[],
      alerts: undefined as unknown as readonly any[],
    }));
    expect(html).toContain('0 ₽');
    expect(html).toContain('Активов');
    expect(html).toContain('0');
  });

  it('отрицательная стоимость портфеля', () => {
    const html = renderAnalysisReport(makeSampleInfo({ totalValue: -50_000 }));
    expect(html).toMatch(/-50\s?000\s?₽/);
  });
});

// ──────────────────────────────────────────────
// activityCssClass
// ──────────────────────────────────────────────

describe('activityCssClass', () => {
  function makeEvent(type: string): DirectorAuditEvent {
    return {
      type,
      timestamp: new Date().toISOString(),
      message: 'test message',
    } as DirectorAuditEvent;
  }

  it('plan_created → type-plan', () => {
    expect(activityCssClass(makeEvent('director.plan_created'))).toBe('type-plan');
  });

  it('consilium_started → type-consilium', () => {
    expect(activityCssClass(makeEvent('director.consilium_started'))).toBe('type-consilium');
  });

  it('consilium_round_completed → type-consilium', () => {
    expect(activityCssClass(makeEvent('director.consilium_round_completed'))).toBe('type-consilium');
  });

  it('consilium_completed → type-consilium', () => {
    expect(activityCssClass(makeEvent('director.consilium_completed'))).toBe('type-consilium');
  });

  it('agent_result_received → type-agent', () => {
    expect(activityCssClass(makeEvent('director.agent_result_received'))).toBe('type-agent');
  });

  it('task_delegated → type-agent', () => {
    expect(activityCssClass(makeEvent('director.task_delegated'))).toBe('type-agent');
  });

  it('recommendation_formed → type-error', () => {
    expect(activityCssClass(makeEvent('director.recommendation_formed'))).toBe('type-error');
  });

  it('неизвестный тип возвращает пустую строку', () => {
    expect(activityCssClass(makeEvent('unknown.event'))).toBe('');
    expect(activityCssClass(makeEvent('director.unknown'))).toBe('');
    expect(activityCssClass(makeEvent('random.type'))).toBe('');
  });
});

// ──────────────────────────────────────────────
// formatLocalTime
// ──────────────────────────────────────────────

describe('formatLocalTime', () => {
  it('форматирует валидную ISO-метку', () => {
    const result = formatLocalTime('2026-10-21T14:30:45Z');
    expect(result).toBeDefined();
    expect(result.length).toBe(8); // HH:MM:SS
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('возвращает "—" для невалидной даты', () => {
    expect(formatLocalTime('invalid')).toBe('—');
    expect(formatLocalTime('')).toBe('—');
    expect(formatLocalTime('not-a-date')).toBe('—');
  });

  it('возвращает "—" для пустой строки', () => {
    expect(formatLocalTime('')).toBe('—');
  });
});
