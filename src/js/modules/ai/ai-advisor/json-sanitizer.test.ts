/// <reference types="vitest/globals" />
/**
 * Тесты json-sanitizer: raw JSON никогда не должен попадать в отчёт.
 * Особое внимание — битым блокам от LLM (обрыв по лимиту токенов):
 * одинарный бэтик, отсутствие закрывающего fence, <br> вместо \n.
 */

import { stripJsonBlockFromAiText } from './json-sanitizer.js';

describe('stripJsonBlockFromAiText: обрывы JSON-блока от LLM', () => {
  it('одинарный бэтик + <br> + обрыв без закрытия (реальный кейс отчёта)', () => {
    const raw =
      '7. Краткое резюме (3-5 действий)<br><br>' +
      '1. Закрыть позицию PLZL полностью.<br><br>' +
      '`json<br>{<br>  "ticker": "PLZL",<br>   0,<br>   "EXIT",<br>' +
      '  "confidence": 0.95,<br>  "rationale": "Критический убыток -58.3%"';
    const cleaned = stripJsonBlockFromAiText(raw);
    expect(cleaned).toContain('Краткое резюме');
    expect(cleaned).not.toContain('`json');
    expect(cleaned).not.toContain('"ticker"');
    expect(cleaned).not.toContain('"confidence"');
  });

  it('```json без закрывающего fence (обрыв модели) — режется до конца', () => {
    const raw =
      'Анализ завершён.\n\n```json\n{\n  "ticker": "SBER",\n  "recommendedAction": "BUY",';
    const cleaned = stripJsonBlockFromAiText(raw);
    expect(cleaned).toContain('Анализ завершён.');
    expect(cleaned).not.toContain('```');
    expect(cleaned).not.toContain('recommendedAction');
  });

  it('сырой {"ticker": ...} без закрывающей скобки — режется до конца', () => {
    const raw =
      'Итог: держим позицию.\n\n{"ticker": "PLZL", "recommendedAction": "EXIT"';
    const cleaned = stripJsonBlockFromAiText(raw);
    expect(cleaned).toContain('Итог: держим позицию.');
    expect(cleaned).not.toContain('"ticker"');
  });

  it('корректный ```json блок по-прежнему удаляется целиком', () => {
    const raw =
      'Резюме: покупаем.\n\n```json\n{"ticker": "SBER", "recommendedAction": "BUY"}\n```\n';
    const cleaned = stripJsonBlockFromAiText(raw);
    expect(cleaned).toBe('Резюме: покупаем.');
  });

  it('текст без JSON не изменяется', () => {
    const raw = 'Обычный текст анализа с цифрами 14% и 44.31%.';
    expect(stripJsonBlockFromAiText(raw)).toBe(raw);
  });
});
