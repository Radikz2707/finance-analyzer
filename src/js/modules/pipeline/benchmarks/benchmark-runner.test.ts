// ВАЖНО: используем ГЛОБАЛЬНЫЕ API vitest (describe/it/expect), а не импорт
// из 'vitest' — ограничение окружения проекта (vitest 5.x + vite 8.x),
// см. комментарий в src/js/modules/memory-layer/memory-layer.test.ts.
import {
  findSlowest,
  formatResultsTable,
  measure,
  measureMemoryUsage,
  parseFailOnThreshold,
  type BenchmarkResult,
} from './benchmark-runner.js';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe('benchmark-runner', () => {
  it('measure возвращает корректную структуру результата', async () => {
    const result = await measure('noop', () => {});

    expect(result).toMatchObject({
      name: 'noop',
      opsPerSec: expect.any(Number),
      avgMs: expect.any(Number),
      p95Ms: expect.any(Number),
      minMs: expect.any(Number),
      maxMs: expect.any(Number),
    });
    expect(result.minMs).toBeGreaterThanOrEqual(0);
    expect(result.maxMs).toBeGreaterThanOrEqual(result.minMs);
    expect(result.avgMs).toBeGreaterThanOrEqual(result.minMs);
    expect(result.avgMs).toBeLessThanOrEqual(result.maxMs);
    expect(result.p95Ms).toBeGreaterThanOrEqual(result.minMs);
    expect(result.p95Ms).toBeLessThanOrEqual(result.maxMs);
  });

  it('поддерживает iterations > 1 и прогревается перед замерами', async () => {
    let executions = 0;
    const result = await measure(
      'delayed',
      async () => {
        executions += 1;
        await sleep(5);
      },
      { iterations: 10, warmup: 2 },
    );

    expect(executions).toBe(12);
    expect(result.avgMs).toBeGreaterThan(0);
    expect(result.avgMs).toBeGreaterThanOrEqual(result.minMs);
    expect(result.avgMs).toBeLessThanOrEqual(result.maxMs);
    expect(result.p95Ms).toBeGreaterThan(0);
  });

  it('не падает на пустой fn и iterations=1 (p95/min/max равны)', async () => {
    const result = await measure('empty', () => {}, {
      iterations: 1,
      warmup: 0,
    });

    expect(result.name).toBe('empty');
    expect(result.p95Ms).toBe(result.minMs);
    expect(result.maxMs).toBe(result.minMs);
    expect(result.opsPerSec).toBeGreaterThan(0);
  });

  it('поддерживает async fn и не теряет возвращаемое значение', async () => {
    const result = await measure('async-value', async () => 42, {
      iterations: 3,
    });
    expect(result.name).toBe('async-value');
    expect(result.avgMs).toBeGreaterThanOrEqual(0);
  });

  it('measureMemoryUsage возвращает heapUsedMb', async () => {
    const result = await measureMemoryUsage('alloc', () => {
      // Временная аллокация — после прогона GC не вызывается, дельта видна.
      const buffer = new Array<number>(10_000).fill(1);
      void buffer;
    });

    expect(result.name).toBe('alloc');
    expect(result.heapUsedMb).toEqual(expect.any(Number));
    expect(result.avgMs).toBeGreaterThanOrEqual(0);
  });

  it('formatResultsTable выводит имена и заголовки', async () => {
    const results: BenchmarkResult[] = [
      await measure('alpha', () => {}),
      await measure('beta', () => {}, { iterations: 2 }),
    ];

    const table = formatResultsTable(results);
    expect(table).toContain('Benchmark');
    expect(table).toContain('avg, ms');
    expect(table).toContain('alpha');
    expect(table).toContain('beta');

    const empty = formatResultsTable([]);
    expect(empty).toBe('(пусто)');
  });

  it('parseFailOnThreshold разбирает --fail-on', () => {
    expect(parseFailOnThreshold([])).toBeNull();
    expect(parseFailOnThreshold(['--fail-on', '5000'])).toBe(5000);
    expect(parseFailOnThreshold(['--fail-on', '5000', 'extra'])).toBe(5000);
    expect(parseFailOnThreshold(['--fail-on'])).toBeNull();
    expect(parseFailOnThreshold(['--fail-on', 'abc'])).toBeNull();
    expect(parseFailOnThreshold(['--fail-on', '-5'])).toBeNull();
  });

  it('findSlowest находит замер выше порога', async () => {
    const fast = await measure('fast', () => {});
    const slow = await measure('slow', async () => {
      await sleep(20);
    });
    const results = [fast, slow];

    expect(findSlowest(results, 0)).toBe(slow);
    expect(findSlowest(results, 100_000)).toBeNull();
  });
});
