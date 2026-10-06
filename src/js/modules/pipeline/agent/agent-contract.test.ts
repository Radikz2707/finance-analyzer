/**
 * Agent Contract Tests — единый стандарт контрактов action-агентов.
 *
 * Проверяются: type guard `isActionInput`, хелперы `createActionResult` /
 * `failActionResult` и единая форма результата `AgentActionResult`.
 */

import {
  createActionResult,
  failActionResult,
  isActionInput,
} from './agent-contract.js';
import type { AgentActionResult } from './agent-contract.js';

describe('isActionInput', () => {
  it('принимает объект со строковым полем action', () => {
    expect(isActionInput({ action: 'read' })).toBe(true);
    expect(isActionInput({ action: 'search', query: 'GAZP' })).toBe(true);
  });

  it('отклоняет не-объекты и объекты без строкового action', () => {
    expect(isActionInput(null)).toBe(false);
    expect(isActionInput(undefined)).toBe(false);
    expect(isActionInput('read')).toBe(false);
    expect(isActionInput(42)).toBe(false);
    expect(isActionInput([])).toBe(false);
    expect(isActionInput({})).toBe(false);
    expect(isActionInput({ action: 5 })).toBe(false);
    expect(isActionInput({ action: null })).toBe(false);
  });
});

describe('createActionResult', () => {
  it('создаёт успешный результат с дефолтным message', () => {
    const result = createActionResult('write');
    expect(result).toEqual({
      action: 'write',
      success: true,
      message: 'OK',
    });
    expect(result.data).toBeUndefined();
  });

  it('сохраняет данные и кастомный message', () => {
    const result = createActionResult<'read', { content: string }>(
      'read',
      { content: 'hello' },
      'Файл прочитан',
    );
    expect(result.success).toBe(true);
    expect(result.action).toBe('read');
    expect(result.message).toBe('Файл прочитан');
    expect(result.data?.content).toBe('hello');
  });
});

describe('failActionResult', () => {
  it('извлекает message из Error', () => {
    const result = failActionResult('delete', new Error('Файл не найден'));
    expect(result).toEqual({
      action: 'delete',
      success: false,
      message: 'Файл не найден',
    });
  });

  it('сериализует произвольное значение ошибки', () => {
    const result = failActionResult('run', 'boom');
    expect(result.success).toBe(false);
    expect(result.message).toBe('boom');
  });

  it('поддерживает переопределённый message', () => {
    const result = failActionResult('run', new Error('x'), 'Своё сообщение');
    expect(result.success).toBe(false);
    expect(result.message).toBe('Своё сообщение');
  });
});

describe('AgentActionResult — единая форма', () => {
  it('структура соответствует стандарту { action, success, message, data? }', () => {
    const result: AgentActionResult = createActionResult('op', { n: 1 });
    expect(result.action).toBe('op');
    expect(result.success).toBe(true);
    expect(typeof result.message).toBe('string');
    expect(result.data).toEqual({ n: 1 });
  });
});
