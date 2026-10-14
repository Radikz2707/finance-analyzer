/**
 * Activity Renderer — тесты форматирования событий активности в строки чата.
 *
 * Покрытие:
 * - started/step/completed/failed с иконками и метками ролей;
 * - completed с durationMs → суффикс «за N мс»;
 * - неизвестная роль → роль как есть;
 * - roleLabel для известных/неизвестных ролей.
 *
 * ВАЖНО: импорт { describe, it, expect } из 'vitest' НЕ используется —
 * он создаёт второй экземпляр @vitest/runner и ломает контекст тестов.
 * Все тесты используют глобалы (globals: true).
 */

import { formatActivityEvent, roleLabel } from './activity-renderer.js';
import type { AgentActivityEvent } from './types.js';

/** Полное событие для форматирования */
function makeEvent(
  overrides: Partial<AgentActivityEvent> = {},
): AgentActivityEvent {
  return {
    id: 'act-1',
    taskId: 'task-1',
    role: 'research',
    phase: 'started',
    message: 'стартовал',
    timestamp: '2026-10-13T12:00:00.000Z',
    ...overrides,
  };
}

describe('activity-renderer', () => {
  it('1. started: «🔍 ResearchAgent: стартовал»', () => {
    const line = formatActivityEvent(makeEvent());
    expect(line).toBe('🔍 ResearchAgent: стартовал');
  });

  it('2. step: «⚙️ ResearchAgent: собираю факты по SBER»', () => {
    const line = formatActivityEvent(
      makeEvent({ phase: 'step', message: 'собираю факты по SBER' }),
    );
    expect(line).toBe('⚙️ ResearchAgent: собираю факты по SBER');
  });

  it('3. completed с durationMs: «✅ AnalysisAgent: готово за 120 мс»', () => {
    const line = formatActivityEvent(
      makeEvent({
        role: 'analysis',
        phase: 'completed',
        message: 'готово',
        durationMs: 120,
      }),
    );
    expect(line).toBe('✅ AnalysisAgent: готово за 120 мс');
  });

  it('4. completed без durationMs не добавляет суффикс', () => {
    const line = formatActivityEvent(
      makeEvent({ role: 'ai', phase: 'completed', message: 'готово' }),
    );
    expect(line).toBe('✅ AI Agent: готово');
  });

  it('5. failed: «❌ ResearchAgent: ошибка: таймаут сети»', () => {
    const line = formatActivityEvent(
      makeEvent({ phase: 'failed', message: 'ошибка: таймаут сети' }),
    );
    expect(line).toBe('❌ ResearchAgent: ошибка: таймаут сети');
  });

  it('6. неизвестная роль выводится как есть', () => {
    const line = formatActivityEvent(
      makeEvent({ role: 'custom-role', message: 'работаю' }),
    );
    expect(line).toBe('🔍 custom-role: работаю');
  });

  it('7. roleLabel: известные роли → метки, неизвестные → как есть', () => {
    expect(roleLabel('research')).toBe('ResearchAgent');
    expect(roleLabel('analysis')).toBe('AnalysisAgent');
    expect(roleLabel('ai')).toBe('AI Agent');
    expect(roleLabel('code')).toBe('CodingWorkflow');
    expect(roleLabel('file')).toBe('FileAgent');
    expect(roleLabel('unknown-role')).toBe('unknown-role');
  });
});
