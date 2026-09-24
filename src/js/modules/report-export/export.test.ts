import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { exportToCSV, exportToJSON, exportToMarkdown, exportAllFormats } from './export.js';
import type { PipelineResult } from '../pipeline/pipeline-coordinator.js';

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════

function createMockPipelineResult(): PipelineResult {
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
        result: { success: true, data: undefined },
      },
      notification: {
        durationMs: 0,
        result: { success: true, data: {} },
      },
    },
    reviewResult: undefined,
    error: undefined,
  } as unknown as PipelineResult;
}

// ═══════════════════════════════════════════════
// 1. exportToCSV
// ═══════════════════════════════════════════════

describe('exportToCSV', () => {
  it('должен создать CSV-файл', async () => {
    const result = createMockPipelineResult();
    const filepath = await exportToCSV(result);

    expect(filepath).toContain('exports');
    expect(filepath).toContain('.csv');
    expect(fs.existsSync(filepath)).toBe(true);

    // Очистка
    fs.unlinkSync(filepath);
  });

  it('должен создать директорию exports', async () => {
    const result = createMockPipelineResult();
    await exportToCSV(result);

    const exportsDir = path.join(process.cwd(), 'exports');
    expect(fs.existsSync(exportsDir)).toBe(true);

    // Очистка
    if (fs.existsSync(exportsDir)) {
      fs.rmSync(exportsDir, { recursive: true });
    }
  });
});

// ═══════════════════════════════════════════════
// 2. exportToJSON
// ═══════════════════════════════════════════════

describe('exportToJSON', () => {
  it('должен создать JSON-файл', async () => {
    const result = createMockPipelineResult();
    const filepath = await exportToJSON(result);

    expect(filepath).toContain('exports');
    expect(filepath).toContain('.json');
    expect(fs.existsSync(filepath)).toBe(true);

    // Проверка содержимого
    const content = fs.readFileSync(filepath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.success).toBe(true);
    expect(parsed.totalDurationMs).toBe(5000);

    // Очистка
    fs.unlinkSync(filepath);
  });
});

// ═══════════════════════════════════════════════
// 3. exportToMarkdown
// ═══════════════════════════════════════════════

describe('exportToMarkdown', () => {
  it('должен создать Markdown-файл', async () => {
    const result = createMockPipelineResult();
    const filepath = await exportToMarkdown(result);

    expect(filepath).toContain('exports');
    expect(filepath).toContain('.md');
    expect(fs.existsSync(filepath)).toBe(true);

    // Проверка содержимого
    const content = fs.readFileSync(filepath, 'utf-8');
    expect(content).toContain('Finance Analyzer Report');
    expect(content).toContain('Success:');
    expect(content).toContain('Stages');

    // Очистка
    fs.unlinkSync(filepath);
  });
});

// ═══════════════════════════════════════════════
// 4. exportAllFormats
// ═══════════════════════════════════════════════

describe('exportAllFormats', () => {
  it('должен создать файлы во всех форматах', async () => {
    const result = createMockPipelineResult();
    const files = await exportAllFormats(result);

    expect(files.length).toBe(3);
    expect(files[0]).toMatch(/\.csv$/);
    expect(files[1]).toMatch(/\.json$/);
    expect(files[2]).toMatch(/\.md$/);

    // Проверка существования файлов
    for (const file of files) {
      expect(fs.existsSync(file)).toBe(true);
    }

    // Очистка
    for (const file of files) {
      fs.unlinkSync(file);
    }

    // Очистка директории
    const exportsDir = path.join(process.cwd(), 'exports');
    if (fs.existsSync(exportsDir)) {
      fs.rmSync(exportsDir, { recursive: true });
    }
  });
});
