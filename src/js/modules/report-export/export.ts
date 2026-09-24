/**
 * ReportExport — экспорт отчётов в различные форматы.
 *
 * Поддерживает:
 * - CSV для Excel
 * - JSON для API
 * - Markdown для чтения
 */

import fs from 'fs';
import path from 'path';
import type { PipelineResult } from '../pipeline/pipeline-coordinator.js';

// ──────────────────────────────────────────────
// 1. CSV Export
// ──────────────────────────────────────────────

/**
 * Экспортировать результаты pipeline в CSV.
 */
export async function exportToCSV(result: PipelineResult): Promise<string> {
  const outputDir = path.join(process.cwd(), 'exports');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const filename = 'report_' + new Date().toISOString().split('T')[0] + '.csv';
  const filepath = path.join(outputDir, filename);

  // Формируем CSV
  let csv = 'ticker,recommendation,confidence,current_price,target_weight,actual_return\n';

  const stages = result.stages;
  const aiStage = stages.ai;

  if (aiStage?.result.success && aiStage.result.data) {
    const aiData = aiStage.result.data as {
      structuredRecommendations?: Map<string, { aiRecommendedAction?: { value?: string }; confidence?: { value?: number } }>;
    };

    const recommendations = aiData?.structuredRecommendations;
    if (recommendations) {
      for (const [ticker, rec] of recommendations.entries()) {
        const action = rec.aiRecommendedAction?.value ?? 'HOLD';
        const confidence = rec.confidence?.value ?? 0;

        csv += ticker + ',' + action + ',' + confidence + ',0,0,0\n';
      }
    }
  }

  fs.writeFileSync(filepath, csv, 'utf-8');
  console.log('[Export] 📊 CSV сохранён: ' + filepath);

  return filepath;
}

// ──────────────────────────────────────────────
// 2. JSON Export
// ──────────────────────────────────────────────

/**
 * Экспортировать результаты pipeline в JSON.
 */
export async function exportToJSON(result: PipelineResult): Promise<string> {
  const outputDir = path.join(process.cwd(), 'exports');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const filename = 'report_' + new Date().toISOString().split('T')[0] + '.json';
  const filepath = path.join(outputDir, filename);

  const exportData = {
    timestamp: new Date().toISOString(),
    success: result.success,
    totalDurationMs: result.totalDurationMs,
    stages: Object.fromEntries(
      Object.entries(result.stages).map(([key, stage]) => [
        key,
        {
          success: stage?.result.success,
          durationMs: stage?.durationMs,
          data: stage?.result.data ? { type: typeof stage.result.data } : null,
        },
      ]),
    ),
    review: result.reviewResult ? {
      agreementPercent: result.reviewResult.agreementPercent,
      hasDisagreement: result.reviewResult.hasDisagreement,
      finalRecommendation: result.reviewResult.finalRecommendation,
    } : null,
  };

  fs.writeFileSync(filepath, JSON.stringify(exportData, null, 2), 'utf-8');
  console.log('[Export] 📄 JSON сохранён: ' + filepath);

  return filepath;
}

// ──────────────────────────────────────────────
// 3. Markdown Export
// ──────────────────────────────────────────────

/**
 * Экспортировать результаты pipeline в Markdown.
 */
export async function exportToMarkdown(result: PipelineResult): Promise<string> {
  const outputDir = path.join(process.cwd(), 'exports');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const filename = 'report_' + new Date().toISOString().split('T')[0] + '.md';
  const filepath = path.join(outputDir, filename);

  let md = '# Finance Analyzer Report\n\n';
  md += '**Date:** ' + new Date().toISOString().split('T')[0] + '\n\n';
  md += '**Success:** ' + (result.success ? 'Yes' : 'No') + '\n\n';
  md += '**Duration:** ' + (result.totalDurationMs / 1000).toFixed(2) + 's\n\n';

  // Stages
  md += '## Stages\n\n';
  for (const [key, stage] of Object.entries(result.stages)) {
    const status = stage?.result.success ? '✅' : '❌';
    const duration = stage ? (stage.durationMs / 1000).toFixed(2) : 'N/A';
    md += '- **' + key + ':** ' + status + ' (' + duration + 's)\n';
  }

  // Review
  if (result.reviewResult) {
    md += '\n## Review\n\n';
    md += '- **Agreement:** ' + result.reviewResult.agreementPercent + '%\n';
    md += '- **Disagreement:** ' + (result.reviewResult.hasDisagreement ? 'Yes' : 'No') + '\n';
    md += '- **Recommendation:** ' + result.reviewResult.finalRecommendation + '\n';
  }

  fs.writeFileSync(filepath, md, 'utf-8');
  console.log('[Export] 📝 Markdown сохранён: ' + filepath);

  return filepath;
}

// ──────────────────────────────────────────────
// 4. All Formats
// ──────────────────────────────────────────────

/**
 * Экспортировать во все форматы.
 */
export async function exportAllFormats(result: PipelineResult): Promise<string[]> {
  const files: string[] = [];

  try {
    files.push(await exportToCSV(result));
  } catch (err) {
    console.warn('[Export] Ошибка CSV:', err);
  }

  try {
    files.push(await exportToJSON(result));
  } catch (err) {
    console.warn('[Export] Ошибка JSON:', err);
  }

  try {
    files.push(await exportToMarkdown(result));
  } catch (err) {
    console.warn('[Export] Ошибка Markdown:', err);
  }

  return files;
}

// ──────────────────────────────────────────────
// 5. Экспорт
// ──────────────────────────────────────────────
