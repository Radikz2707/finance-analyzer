/**
 * Точка входа performance-бенчмарков (`npm run bench`).
 *
 * Запускает все bench-файлы последовательно и печатает таблицы результатов.
 * Информационный режим: код выхода 0 всегда; опционально `--fail-on <ms>`
 * завершает процесс с кодом 1, если avgMs любого замера превышает порог.
 *
 * Пример: node --import tsx src/js/modules/pipeline/benchmarks/run.ts --fail-on 5000
 */

import {
  findSlowest,
  formatResultsTable,
  parseFailOnThreshold,
  type BenchmarkResult,
} from './benchmark-runner.js';
import { runPipelineTimingBenchmarks } from './pipeline-timing.bench.js';
import { runPortfolioMathBenchmarks } from './portfolio-math.bench.js';
import { runXlsxMemoryBenchmarks } from './xlsx-memory.bench.js';

interface Section {
  title: string;
  results: BenchmarkResult[];
}

async function main(): Promise<void> {
  const sections: Section[] = [
    {
      title: 'Pipeline: полный цикл 8 стадий (моки без I/O)',
      results: await runPipelineTimingBenchmarks(),
    },
    {
      title: 'PortfolioMath: анализ синтетического портфеля',
      results: await runPortfolioMathBenchmarks(),
    },
    {
      title: 'XlsxParser: парсинг «Отчета по сделкам» (память)',
      results: await runXlsxMemoryBenchmarks(),
    },
  ];

  const all: BenchmarkResult[] = [];
  console.log('=== Performance benchmarks ===');
  for (const section of sections) {
    console.log(`\n## ${section.title}`);
    console.log(formatResultsTable(section.results));
    all.push(...section.results);
  }

  const thresholdMs = parseFailOnThreshold(process.argv.slice(2));
  if (thresholdMs === null) {
    console.log(
      '\nИнформационный прогон: порог не задан (для CI используйте --fail-on <ms>).',
    );
    return;
  }

  const slowest = findSlowest(all, thresholdMs);
  if (slowest === null) {
    console.log(`\nOK: все avg <= ${thresholdMs}ms`);
    return;
  }
  console.error(
    `\nFAIL: ${slowest.name} avg=${slowest.avgMs.toFixed(2)}ms > порог ${thresholdMs}ms`,
  );
  process.exitCode = 1;
}

main()
  .then(() => {
    // Планировщики (например, MemoryCleaner из ai-memory) держат event loop
    // активным — завершаем процесс явно, чтобы `npm run bench` не висел.
    process.exit(process.exitCode ?? 0);
  })
  .catch((err: unknown) => {
    console.error('Бенчмарки завершились с ошибкой:', err);
    process.exit(1);
  });
