import { describe, it, expect, beforeEach } from 'vitest';
import { NotificationEngine } from './notifications.js';
import type { PipelineResult } from '../pipeline/pipeline-coordinator.js';
import type { ReviewResult } from '../pipeline/review/review-agent.js';

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════

function createMockReviewResult(): ReviewResult {
  return {
    reviewers: new Map([
      [
        'conservative',
        {
          reviewerType: 'conservative',
          name: 'Консервативный ревизор',
          warnings: [
            {
              severity: 'high',
              category: 'concentration',
              message: 'Высокая концентрация SBER',
            },
          ],
          recommendations: 'Снизить риски',
          confidence: 75,
          summary: 'Консервативный анализ: найдено 1 предупреждение',
          durationMs: 100,
          timedOut: false,
        },
      ],
      [
        'aggressive',
        {
          reviewerType: 'aggressive',
          name: 'Агрессивный ревизор',
          warnings: [],
          recommendations: 'Рост возможен',
          confidence: 70,
          summary: 'Агрессивный анализ: явных возможностей нет',
          durationMs: 100,
          timedOut: false,
        },
      ],
      [
        'risk_manager',
        {
          reviewerType: 'risk_manager',
          name: 'Risk Manager',
          warnings: [],
          recommendations: 'Лимиты соблюдены',
          confidence: 90,
          summary: 'Risk Manager: лимиты соблюдены',
          durationMs: 100,
          timedOut: false,
        },
      ],
    ]),
    agreementPercent: 78,
    hasDisagreement: false,
    finalRecommendation: 'Рекомендации стабильны',
    reviewedAt: new Date().toISOString(),
    metrics: {
      totalDurationMs: 300,
      reviewerTimings: {
        conservative: 100,
        aggressive: 100,
        risk_manager: 100,
      },
      successfulReviewers: 3,
      timedOutReviewers: 0,
    },
  };
}

function createMockPipelineResult(reviewResult?: ReviewResult): PipelineResult {
  return {
    success: true,
    totalDurationMs: 5000,
    stages: {
      data: {
        durationMs: 1000,
        result: { success: true, data: {} },
      },
      research: {
        durationMs: 2000,
        result: { success: true, data: {} },
      },
      analysis: {
        durationMs: 1000,
        result: { success: true, data: {} },
      },
      ai: {
        durationMs: 500,
        result: { success: true, data: {} },
      },
      review: {
        durationMs: 500,
        result: { success: true, data: reviewResult },
      },
      notification: {
        durationMs: 0,
        result: { success: true, data: {} },
      },
    },
    reviewResult,
    error: undefined,
  } as unknown as PipelineResult;
}

// ═══════════════════════════════════════════════
// 1. NotificationEngine
// ═══════════════════════════════════════════════

describe('NotificationEngine', () => {
  let engine: NotificationEngine;

  beforeEach(() => {
    engine = new NotificationEngine({
      telegramToken: '',
      adminChatIds: [],
      enableAlerts: true,
      enableDigests: true,
      morningDigestHour: 9,
      eveningDigestHour: 21,
    });
  });

  it('должен создать engine с конфигурацией', () => {
    expect(engine).toBeDefined();
  });

  it('должен проверить алерты и создать уведомления', () => {
    const pipelineResult = createMockPipelineResult(createMockReviewResult());
    const alerts = engine.checkAlerts(pipelineResult);

    // Должен создать алерт для high-предупреждения
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    expect(alerts[0].type).toBe('alert');
    expect(alerts[0].severity).toBe('high');
  });

  it('должен сгенерировать утренний дайджест', () => {
    const pipelineResult = createMockPipelineResult(createMockReviewResult());
    const digest = engine.generateMorningDigest(pipelineResult);

    expect(digest.type).toBe('digest');
    expect(digest.title).toContain('Утренний');
    expect(digest.message).toContain('Портфель');
    expect(digest.sent).toBe(false);
  });

  it('должен сгенерировать вечерний дайджест', () => {
    const pipelineResult = createMockPipelineResult(createMockReviewResult());
    const digest = engine.generateEveningDigest(pipelineResult);

    expect(digest.type).toBe('digest');
    expect(digest.title).toContain('Вечерний');
    expect(digest.message).toContain('Итоги');
    expect(digest.sent).toBe(false);
  });

  it('должен не создавать алерты при отключённых алертах', () => {
    const engineNoAlerts = new NotificationEngine({
      telegramToken: '',
      adminChatIds: [],
      enableAlerts: false,
      enableDigests: true,
      morningDigestHour: 9,
      eveningDigestHour: 21,
    });

    const pipelineResult = createMockPipelineResult(createMockReviewResult());
    const alerts = engineNoAlerts.checkAlerts(pipelineResult);

    expect(alerts.length).toBe(0);
  });

  it('должен не отправлять при пустом токене', async () => {
    const notification = {
      id: 'test-1',
      type: 'alert' as const,
      severity: 'low' as const,
      title: 'Test',
      message: 'Test message',
      timestamp: new Date().toISOString(),
      sent: false,
    };

    // sendToTelegram должен вернуть false при пустом токене
    const result = await engine.sendToTelegram(notification);
    expect(result).toBe(false);
  });

  it('должен вернуть все уведомления', () => {
    const pipelineResult = createMockPipelineResult(createMockReviewResult());
    engine.checkAlerts(pipelineResult);

    const allNotifications = engine.getNotifications();
    expect(allNotifications.length).toBeGreaterThanOrEqual(1);
  });

  it('должен вернуть уведомления по типу', () => {
    const pipelineResult = createMockPipelineResult(createMockReviewResult());
    engine.checkAlerts(pipelineResult);

    const alerts = engine.getNotificationsByType('alert');
    expect(alerts.length).toBeGreaterThanOrEqual(1);
  });

  it('должен очистить старые уведомления', () => {
    const pipelineResult = createMockPipelineResult(createMockReviewResult());
    engine.checkAlerts(pipelineResult);

    const before = engine.getNotifications().length;
    engine.clearOld();

    // После очистки должны остаться только недавние
    expect(engine.getNotifications().length).toBeLessThanOrEqual(before);
  });
});
