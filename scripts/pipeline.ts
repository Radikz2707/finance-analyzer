/**
 * Pipeline Entry Point — мультиагентный конвейер анализа портфеля.
 *
 * Запуск:
 *   npm run pipeline          — однократный запуск конвейера
 *   npm run pipeline:schedule — запуск с cron-расписанием
 *
 * Архитектура:
 *   [Data Agent] ───────────────────────────────────┐
 *       │                                            │
 *       ├─→ [Research Agent] ──→ [AI Agent] ──→ [Notification Agent]
 *       │          │                      │
 *       └─→ [Analysis Agent] ────┘         │
 *                                          │
 *   (Research + Analysis — параллельно)
 */

/// <reference types="node" />

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import open from 'open';

// Force reload .env with full parsing
const envPath = path.resolve('.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  const lines = envContent.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex > 0) {
      const key = trimmed.substring(0, eqIndex).trim();
      const value = trimmed.substring(eqIndex + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

// silent — env загружен

import { PipelineCoordinator } from '../src/js/modules/ai/pipeline/pipeline-coordinator.js';
import { PipelineScheduler } from '../src/js/modules/ai/pipeline/infrastructure/pipeline-scheduler.js';
import { savePortfolioKpi } from '../src/js/modules/ai/pipeline/ai-memory/kpi-sink.js';
import { aiMemoryImpl } from '../src/js/modules/ai/pipeline/ai-memory/index.js';

/** Обёртка для KPI sink: aiMemoryImpl + PipelineResult */
const kpiSink = async (result: import('../src/js/modules/ai/pipeline/pipeline-coordinator.js').PipelineResult): Promise<void> => {
  try {
    await savePortfolioKpi(aiMemoryImpl, result);
  } catch {
    // silently ignore — KPI не критичен для pipeline
  }
};

// ──────────────────────────────────────────────
// 1. Однократный запуск конвейера
// ──────────────────────────────────────────────

async function runPipeline(): Promise<void> {
  console.log('[PIPELINE] Запуск мультиагентного конвейера');

  const coordinator = new PipelineCoordinator(
    {
      data: {
        name: 'DataAgent',
        verbose: true,
        retries: 1,
      },
      research: {
        name: 'ResearchAgent',
        verbose: true,
        retries: 1,
      },
      analysis: {
        name: 'AnalysisAgent',
        verbose: true,
        retries: 1,
      },
      ai: {
        name: 'AiAgent',
        verbose: true,
        retries: 1,
      },
      notification: {
        name: 'NotificationAgent',
        verbose: true,
        retries: 1,
      },
    },
    { memorySink: kpiSink },
  );

  const result = await coordinator.run();

  console.log('='.repeat(60));
  console.log('[PIPELINE] Результаты:');
  console.log(`  Успех: ${result.success ? '✅ Да' : '❌ Нет'}`);
  console.log(
    `  Время: ${(result.totalDurationMs / 1000).toFixed(1)}s`,
  );

  if (result.error) {
    console.log(`  Ошибка: ${result.error.message}`);
  }

  console.log('\n  Этапы:');
  for (const [stage, stageResult] of Object.entries(result.stages)) {
    if (stageResult) {
      const status = stageResult.result.success ? '✅' : '❌';
      console.log(`    ${status} ${stage}`);
    } else {
      console.log(`    ⬜ ${stage}: пропущен`);
    }
  }

  console.log('='.repeat(60));

  // Сохраняем результаты в JSON для dashboard
  // savePipelineResult(result); // удалено: файл pipeline-output.ts удалён

  if (!result.success) {
    process.exit(1);
  }
}

// ──────────────────────────────────────────────
// 2. Запуск с cron-расписанием
// ──────────────────────────────────────────────

function runScheduler(): void {
  console.log('='.repeat(60));
  console.log('[SCHEDULER] Запуск планировщика конвейера');
  console.log('='.repeat(60));

  const scheduler = new PipelineScheduler(
    () =>
      new PipelineCoordinator({
        data: { name: 'DataAgent', verbose: false, retries: 1 },
        research: { name: 'ResearchAgent', verbose: false, retries: 1 },
        analysis: { name: 'AnalysisAgent', verbose: false, retries: 1 },
        ai: { name: 'AiAgent', verbose: false, retries: 1 },
        notification: { name: 'NotificationAgent', verbose: false, retries: 1 },
      }),
    { pollIntervalMs: 60_000 }, // проверка каждые 60 секунд
  );

  // Добавляем стандартные расписания:
  // Каждое утро в 9:00 (будни)
  scheduler.addSchedule({
    name: 'Утренний анализ',
    cron: '0 9 * * 1-5',
    enabled: true,
  });

  // Каждые 4 часа
  scheduler.addSchedule({
    name: 'Периодический анализ',
    cron: '0 */4 * * *',
    enabled: true,
  });

  // Каждое воскресенье в 10:00 (развёрнутый отчёт)
  scheduler.addSchedule({
    name: 'Еженедельный отчёт',
    cron: '0 10 * * 0',
    enabled: true,
  });

  console.log('\n[Scheduler] Расписания:');
  for (const schedule of scheduler.getSchedules()) {
    console.log(`  - ${schedule.name}: ${schedule.cron}`);
  }

  console.log('\n[Scheduler] Запуск polling...');
  scheduler.start();

  // Graceful shutdown при SIGTERM/SIGINT
  const shutdown = async () => {
    console.log('\n[Scheduler] Shutdown...');
    await scheduler.stop();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// ──────────────────────────────────────────────
// 3. Main
// ──────────────────────────────────────────────

const mode = process.argv[2] ?? 'run';

switch (mode) {
  case 'run':
  case 'pipeline':
    runPipeline().catch((err) => {
      console.error('[PIPELINE] Fatal error:', err);
      process.exit(1);
    });
    break;

  case 'schedule':
  case 'scheduler':
    runScheduler();
    break;

  default:
    console.log(`Usage: node pipeline.ts [run|schedule]`);
    console.log('');
    console.log('  run       — однократный запуск конвейера');
    console.log('  schedule  — запуск с cron-расписанием');
    process.exit(1);
}
