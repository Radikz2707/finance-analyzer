/**
 * Бенчмарк потребления памяти при парсинге листа «Отчет по сделкам».
 *
 * Данные синтетические: лист XLSX генерируется в памяти (без файлов, сети
 * и БД) и «подкладывается» парсеру через приватное поле workbook — так
 * loadWorkbook() сразу возвращается, а весь парсинг выполняется в памяти.
 * Меряется прирост process.memoryUsage().heapUsed до/после парсинга
 * для N = 100 / 1000 / 5000 строк сделок.
 */

import XLSX from 'xlsx';
import { XlsxParserModule } from '../../xlsx-parser/xlsx-parser.js';
import {
  measureMemoryUsage,
  type BenchmarkResult,
} from './benchmark-runner.js';

/** Сгенерировать лист «Отчет по сделкам» с tradeCount строками сделок. */
function makeTradesSheet(tradeCount: number): XLSX.WorkSheet {
  // Первая строка — заголовки A/B: sheet_to_json отдаёт ключи 'A'/'B',
  // которые парсер читает в parseHistoricalTradesAnalysis.
  const rows: unknown[][] = [['A', 'B']];

  for (let i = 0; i < tradeCount; i += 1) {
    rows.push([`СДЕЛКА ${String(i + 1).padStart(6, '0')}`, 100 + (i % 97)]);
  }

  // Служебные строки, которые парсер ищет по ключевым словам конфигурации.
  // Важно: парсер ловит includes('ПОКУПК') — поэтому «покупок» не подходит
  // (нет подстроки), используем «покупки».
  rows.push(['Объем покупки', 1_000_000]);
  rows.push(['Объем продаж', 900_000]);
  rows.push(['Комиссии', 12_500]);
  rows.push(['Текущая прибыль (убыток)', 84_000]);
  rows.push(['Прибыль/Убыток', 83_000]);
  rows.push(['Количество сделок', tradeCount]);

  return XLSX.utils.aoa_to_sheet(rows);
}

function makeWorkbook(tradeCount: number): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    makeTradesSheet(tradeCount),
    'Отчет по сделкам',
  );
  return workbook;
}

/** Подложить workbook в память парсера (loadWorkbook() вернётся сразу). */
function injectWorkbook(
  parser: XlsxParserModule,
  workbook: XLSX.WorkBook,
): void {
  (parser as unknown as { workbook: XLSX.WorkBook }).workbook = workbook;
}

/** Замер heapUsed при парсинге отчёта о сделках для разных N. */
export async function runXlsxMemoryBenchmarks(): Promise<BenchmarkResult[]> {
  const sizes = [100, 1_000, 5_000];
  const results: BenchmarkResult[] = [];

  for (const size of sizes) {
    const parser = new XlsxParserModule();
    injectWorkbook(parser, makeWorkbook(size));
    results.push(
      await measureMemoryUsage(`xlsx trades parse (N=${size})`, () =>
        parser.parseHistoricalTradesAnalysis(),
      ),
    );
  }
  return results;
}
