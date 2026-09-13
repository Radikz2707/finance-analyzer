/**
 * Runtime check: показывает target map и таблицу ключевых активов
 * Запуск: node --import tsx/runtime-target-check.ts
 */
import XLSX from 'xlsx';
import fs from 'fs';

const EXCEL_PATH = 'C:/Users/\u0420\u0430\u0434\u0438\u043a/Documents/\u0411\u0443\u0445\u0433\u0430\u043b\u0442\u0435\u0440\u0438\u044f \u0420\u0430\u0434\u0438\u043a\u0430/\u041e\u0442\u0447\u0435\u0442/\u0414\u0430\u043d\u043d\u044b\u0435 \u043d\u043e\u0432\u044b\u0435.xlsx';

function parseOptionalTargetPercent(val) {
  if (val === undefined || val === null) return undefined;
  if (typeof val === 'number') return isNaN(val) ? undefined : val;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '') return undefined;
    const normalized = trimmed.replace(',', '.');
    const parsed = parseFloat(normalized);
    if (isNaN(parsed)) return undefined;
    return parsed;
  }
  return undefined;
}

function main() {
  if (!fs.existsSync(EXCEL_PATH)) {
    console.error('\u274c Excel-\u0444\u0430\u0439\u043b \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d:', EXCEL_PATH);
    process.exit(1);
  }

  const workbook = XLSX.readFile(EXCEL_PATH);

  // 1. \u0427\u0438\u0442\u0430\u0435\u043c \u043a\u0430\u0440\u0442\u0443 \u0446\u0435\u043b\u0435\u0432\u044b\u0445 \u0434\u043e\u043b\u0435\u0439 \u0438\u0437 \u043e\u0441\u043d\u043e\u0432\u043d\u043e\u0433\u043e \u043b\u0438\u0441\u0442\u0430 QUIK
  const quikSheet = workbook.Sheets['QUIK'];
  if (!quikSheet) {
    console.error('\u274c \u041b\u0438\u0441\u0442 "QUIK" \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d');
    process.exit(1);
  }

  const rows = XLSX.utils.sheet_to_json(quikSheet);
  const targetMap = {};

  for (const row of rows) {
    const name = String(row['\u0418\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442'] || '').trim();
    if (!name || name.length > 30 || name.startsWith('-')) continue;
    if (name.toUpperCase().includes('\u0418\u0422\u041e\u0413\u041e') || name.toUpperCase().includes('\u0411\u0410\u041b\u0410\u041d\u0421')) continue;
    if (name === '\u0420\u0443\u0431\u043b\u044c' || name === '\u0420\u0443\u0431\u043b\u044c1') continue;

    // Правильное имя колонки тикера: "Код инструмента" (с пробелом)
    const ticker = String(row['\u041a\u043e\u0434 \u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u0430'] || row['\u041a\u043e\u0434'] || '').trim().toUpperCase();
    if (!ticker) continue;

    const targetRaw = row['\u0426\u0435\u043b\u0435\u0432\u0430\u044f \u0434\u043e\u043b\u044f, %'] ?? row['Target Percent'] ?? row['S'];
    let targetPct = parseOptionalTargetPercent(targetRaw);

    // Excel хранит дроби (0.15), конвертируем в проценты (15)
    // 0 остаётся 0 (EXIT), undefined остаётся undefined
    if (targetPct !== undefined && targetPct > 0 && targetPct <= 1) {
      targetPct = Math.round(targetPct * 100 * 100) / 100;
    }

    targetMap[ticker] = targetPct;
  }

  console.log('\n=== \u041a\u0410\u0420\u0422\u0410 \u0426\u0415\u041b\u0415\u0412\u042b\u0425 \u0414\u041e\u041b\u0415\u0419 (\u0438\u0437 \u043b\u0438\u0441\u0442\u0430 QUIK, \u043a\u043e\u043b\u043e\u043d\u043a\u0430 "\u0426\u0435\u043b\u0435\u0432\u0430\u044f \u0434\u043e\u043b\u044f, %") ===\n');

  // \u041a\u043b\u044e\u0447\u0435\u0432\u044b\u0435 \u0442\u0438\u043a\u0435\u0440\u044b \u0434\u043b\u044f \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0438
  const keyTickers = ['IRAO', 'PLZL', 'X5', 'SBER', 'STME', 'SBBC', 'SBSC', 'SIPO', 'SPRN', 'RU000A10C8F3', 'RU000A10EC22', 'RU000A10FXF8'];

  for (const ticker of keyTickers) {
    const target = targetMap[ticker];
    const status = target === undefined ? 'NO_TARGET' : (target === 0 ? 'EXIT' : target + '%');
    console.log(`  ${ticker.padEnd(20)} -> target: ${(target !== undefined ? target + '%' : 'undefined').padEnd(12)} | ${status}`);
  }

  // \u0421\u0443\u043c\u043c\u0430 targets
  const definedTargets = Object.values(targetMap).filter(v => v !== undefined && v !== 0);
  const sumTargets = definedTargets.reduce((s, v) => s + v, 0);
  console.log(`\n  \u0421\u0443\u043c\u043c\u0430 targets: ${sumTargets}% (\u043e\u0436\u0438\u0434\u0430\u0435\u0442\u0441\u044f: 95%)`);
  console.log(`  \u0412\u0441\u0435\u0433\u043e \u0430\u043a\u0442\u0438\u0432\u043e\u0432 \u0441 target: ${Object.keys(targetMap).length}`);
  console.log(`  \u0410\u043a\u0442\u0438\u0432\u043e\u0432 \u0431\u0435\u0437 target: ${Object.keys(targetMap).length - definedTargets.length}\n`);

  // \u041f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 \u0441\u0435\u043c\u0430\u043d\u0442\u0438\u043a\u0438
  console.log('=== \u041f\u0420\u041e\u0412\u0415\u0420\u041a\u0410 \u0421\u0415\u041c\u0410\u041d\u0422\u0418\u041a\u0418 ===\n');

  const checks = [
    { ticker: 'IRAO', expected: 15, desc: '\u0426\u0435\u043b\u0435\u0432\u0430\u044f \u0434\u043e\u043b\u044f 15%' },
    { ticker: 'PLZL', expected: 8, desc: '\u0426\u0435\u043b\u0435\u0432\u0430\u044f \u0434\u043e\u043b\u044f 8%' },
    { ticker: 'X5', expected: 12, desc: '\u0426\u0435\u043b\u0435\u0432\u0430\u044f \u0434\u043e\u043b\u044f 12%' },
    { ticker: 'SBER', expected: 15, desc: '\u0426\u0435\u043b\u0435\u0432\u0430\u044f \u0434\u043e\u043b\u044f 15%' },
    { ticker: 'STME', expected: 0, desc: 'EXIT (target = 0)' },
    { ticker: 'SBBC', expected: 0, desc: 'EXIT (target = 0)' },
  ];

  let allPassed = true;
  for (const check of checks) {
    const actual = targetMap[check.ticker];
    const passed = actual === check.expected;
    const status = passed ? '\u2705' : '\u274c';
    if (!passed) allPassed = false;
    console.log(`  ${status} ${check.ticker.padEnd(10)} expected=${check.expected}, actual=${actual !== undefined ? actual : 'undefined'} — ${check.desc}`);
  }

  // \u041f\u0440\u0438\u043c\u0435\u0440: ticker \u0431\u0435\u0437 target
  const noTargetTicker = Object.keys(targetMap).find(t => targetMap[t] === undefined);
  if (noTargetTicker) {
    console.log(`  \u2705 ${noTargetTicker.padEnd(10)} target=undefined — NO_TARGET (\u043f\u0440\u0438\u043c\u0435\u0440 \u0430\u043a\u0442\u0438\u0432\u0430 \u0431\u0435\u0437 \u0446\u0435\u043b\u0438)`);
  }

  console.log(`\n${allPassed ? '\u2705 \u0412\u0441\u0435 \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0438 \u043f\u0440\u043e\u0448\u043b\u0438!' : '\u274c \u041d\u0435\u043a\u043e\u0442\u043e\u0440\u044b\u0435 \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0438 \u043d\u0435 \u043f\u0440\u043e\u0448\u043b\u0438'}`);
}

main();
