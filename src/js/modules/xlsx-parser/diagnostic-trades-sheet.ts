import XLSX from 'xlsx';
import * as fs from 'fs';

const EXCEL_FILE_PATH =
  'C:/Users/Радик/Documents/Бухгалтерия Радика/Отчет/Данные новые.xlsx';

console.log('='.repeat(80));
console.log('[DIAGNOSTIC] Audit листа «Отчет по сделкам»');
console.log('='.repeat(80));

if (!fs.existsSync(EXCEL_FILE_PATH)) {
  console.error('[ERROR] Excel-файл не найден:', EXCEL_FILE_PATH);
  process.exit(1);
}

const workbook = XLSX.readFile(EXCEL_FILE_PATH);

console.log('\n[WORKBOOK] Все листы:', workbook.SheetNames);

const tradesSheetName = 'Отчет по сделкам';
const sheet = workbook.Sheets[tradesSheetName];

if (!sheet) {
  console.error('[ERROR] Лист «Отчет по сделкам» не найден!');
  console.log('[INFO] Доступные листы:', workbook.SheetNames.join(', '));
  process.exit(1);
}

// Sheet metadata
const range = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null;
console.log('\n[SHEET METADATA]');
console.log('  sheetName:', tradesSheetName);
console.log('  range:', sheet['!ref'] || 'EMPTY');
console.log('  headerRow:', range ? range.s.r : 'N/A');
console.log('  dataRows:', range ? range.e.r - range.s.r : 0);
console.log('  totalRows:', range ? range.e.r + 1 : 0);

// Read all rows as JSON
const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
console.log('\n[ROWS] Всего строк после sheet_to_json:', rows.length);

// Print ALL rows with their raw values
console.log('\n[ALL_ROWS]');
rows.forEach((row, idx) => {
  const keys = Object.keys(row);
  if (keys.length === 0) return;
  
  const colA = String(row[keys[0]] || '').trim();
  const colB = String(row[keys[1]] || '').trim();
  const colC = String(row[keys[2]] || '').trim();
  const colD = String(row[keys[3]] || '').trim();
  const colE = String(row[keys[4]] || '').trim();
  
  console.log(`  Row ${idx}: A="${colA}" | B="${colB}" | C="${colC}" | D="${colD}" | E="${colE}"`);
});

// Also print raw cell values for column A (first column)
console.log('\n[RAW_COLUMN_A] Все значения первой колонки:');
if (range) {
  for (let r = range.s.r; r <= range.e.r; r++) {
    const cell = sheet[XLSX.utils.encode_cell({ r, c: range.s.c })];
    if (cell && cell.v !== undefined) {
      const raw = String(cell.v).trim();
      console.log(`  Row ${r}: "${raw}" (v=${cell.v}, t=${cell.t})`);
    } else {
      console.log(`  Row ${r}: EMPTY`);
    }
  }
}

// Keyword search
const keywords = [
  'АКТИВ',
  'ПРИБЫЛЬ',
  'УБЫТОК',
  'ВНЕС',
  'СРЕДСТВ',
  'ТЕКУЩАЯ',
  'ИТОГО',
  'ВЛОЖЕН',
  'ЛИКВИДН',
  'СВОБОДН',
];

console.log('\n[KEYWORD_SEARCH] Поиск строк по ключевым словам:');
const foundRows: Array<{ rowIndex: number; label: string; value: string; fullRow: Record<string, unknown> }> = [];

rows.forEach((row, idx) => {
  const keys = Object.keys(row);
  if (keys.length === 0) return;
  
  const colA = String(row[keys[0]] || '').trim().toUpperCase();
  const colB = String(row[keys[1]] || '').trim().toUpperCase();
  const colC = String(row[keys[2]] || '').trim().toUpperCase();
  
  const combined = colA + ' ' + colB + ' ' + colC;
  
  for (const kw of keywords) {
    if (combined.includes(kw)) {
      const valueCell = sheet[XLSX.utils.encode_cell({ r: idx + (range ? range.s.r : 0), c: range ? range.s.c + 2 : 2 })];
      const rawValue = valueCell && valueCell.v !== undefined ? String(valueCell.v) : 'N/A';
      const parsedValue = typeof valueCell?.v === 'number' ? valueCell.v : 0;
      
      foundRows.push({
        rowIndex: idx,
        label: String(row[keys[0]] || '').trim(),
        value: rawValue,
        fullRow: row,
      });
      
      console.log(`  ✓ Row ${idx}: "${String(row[keys[0]] || '').trim()}" contains "${kw}"`);
      console.log(`    Column A: "${String(row[keys[0]] || '').trim()}"`);
      console.log(`    Column B: "${String(row[keys[1]] || '').trim()}"`);
      console.log(`    Column C: "${String(row[keys[2]] || '').trim()}"`);
      console.log(`    Raw value: "${rawValue}"`);
      console.log(`    Parsed value: ${parsedValue}`);
      console.log('');
      break; // only print once per row
    }
  }
});

if (foundRows.length === 0) {
  console.log('  ⚠ Ни одна строка НЕ содержит ключевые слова:', keywords.join(', '));
}

// Specific checks for parser expectations
console.log('\n[PARSER_EXPECTATIONS]');

// Check parseMacroGoals expectations
console.log('\n  --- parseMacroGoals() ---');
console.log('  Ищет строку, содержащую "ЛИКВИДН" + "СРЕДСТВ" для freeCash');
console.log('  Ищет строку, содержащую "ИТОГО АКТИВ" для totalBalance');

const macroTotalBalance = foundRows.find(r => r.label.toUpperCase().includes('ИТОГО') && r.label.toUpperCase().includes('АКТИВ'));
const macroFreeCash = foundRows.find(r => r.label.toUpperCase().includes('ЛИКВИДН') && r.label.toUpperCase().includes('СРЕДСТВ'));

console.log('\n  [MACRO] totalBalance search:');
if (macroTotalBalance) {
  console.log(`    НАЙДЕНО: "${macroTotalBalance.label}" = ${macroTotalBalance.value}`);
} else {
  console.log('    НЕ НАЙДЕНО ни одной строки с "ИТОГО" + "АКТИВ"');
  console.log('    Доступные строки с "ИТОГО":');
  foundRows.filter(r => r.label.toUpperCase().includes('ИТОГО')).forEach(r => {
    console.log(`      - "${r.label}" = ${r.value}`);
  });
}

console.log('\n  [MACRO] freeCash search:');
if (macroFreeCash) {
  console.log(`    НАЙДЕНО: "${macroFreeCash.label}" = ${macroFreeCash.value}`);
} else {
  console.log('    НЕ НАЙДЕНО ни одной строки с "ЛИКВИДН" + "СРЕДСТВ"');
}

// Check parseHistoricalTradesAnalysis expectations
console.log('\n  --- parseHistoricalTradesAnalysis() ---');
console.log('  Ищет строку, содержащую "ТЕКУЩАЯ" + ("ПРИБЫЛЬ" или "УБЫТОК") для profitC10');
console.log('  Ищет строку, содержащую "ПРИБЫЛЬ/УБЫТОК" для profitC11');

const profitC10 = foundRows.find(r => r.label.toUpperCase().includes('ТЕКУЩАЯ') && (r.label.toUpperCase().includes('ПРИБЫЛЬ') || r.label.toUpperCase().includes('УБЫТОК')));
const profitC11 = foundRows.find(r => r.label.toUpperCase().includes('ПРИБЫЛЬ') && r.label.toUpperCase().includes('УБЫТОК') && !r.label.toUpperCase().includes('ТЕКУЩАЯ'));

console.log('\n  [HISTORICAL] profitC10 search:');
if (profitC10) {
  console.log(`    НАЙДЕНО: "${profitC10.label}" = ${profitC10.value}`);
} else {
  console.log('    НЕ НАЙДЕНО ни одной строки с "ТЕКУЩАЯ" + ("ПРИБЫЛЬ" или "УБЫТОК")');
  console.log('    Доступные строки с "ПРИБЫЛЬ":');
  foundRows.filter(r => r.label.toUpperCase().includes('ПРИБЫЛЬ')).forEach(r => {
    console.log(`      - "${r.label}" = ${r.value}`);
  });
  console.log('    Доступные строки с "УБЫТОК":');
  foundRows.filter(r => r.label.toUpperCase().includes('УБЫТОК')).forEach(r => {
    console.log(`      - "${r.label}" = ${r.value}`);
  });
}

console.log('\n  [HISTORICAL] profitC11 search:');
if (profitC11) {
  console.log(`    НАЙДЕНО: "${profitC11.label}" = ${profitC11.value}`);
} else {
  console.log('    НЕ НАЙДЕНО ни одной строки с "ПРИБЫЛЬ/УБЫТОК" (без "ТЕКУЩАЯ")');
  console.log('    Доступные строки с "УБЫТОК":');
  foundRows.filter(r => r.label.toUpperCase().includes('УБЫТОК')).forEach(r => {
    console.log(`      - "${r.label}" = ${r.value}`);
  });
}

// Check parseInvestedFunds expectations
console.log('\n  --- parseInvestedFunds() ---');
console.log('  Ищет строку, содержащую "ВНЕС" + "СРЕДСТВ"');

const investedFunds = foundRows.find(r => r.label.toUpperCase().includes('ВНЕС') && r.label.toUpperCase().includes('СРЕДСТВ'));
console.log('\n  [FUNDS] investedFunds search:');
if (investedFunds) {
  console.log(`    НАЙДЕНО: "${investedFunds.label}" = ${investedFunds.value}`);
} else {
  console.log('    НЕ НАЙДЕНО ни одной строки с "ВНЕС" + "СРЕДСТВ"');
  console.log('    Доступные строки с "ВНЕС":');
  foundRows.filter(r => r.label.toUpperCase().includes('ВНЕС')).forEach(r => {
    console.log(`      - "${r.label}" = ${r.value}`);
  });
  console.log('    Доступные строки с "СРЕДСТВ":');
  foundRows.filter(r => r.label.toUpperCase().includes('СРЕДСТВ')).forEach(r => {
    console.log(`      - "${r.label}" = ${r.value}`);
  });
}

// DIAGNOSTIC block
console.log('\n' + '='.repeat(80));
console.log('[DASHBOARD_SOURCE_AUDIT]');
console.log('='.repeat(80));

console.log('\nC9 (totalBalance):');
if (macroTotalBalance) {
  console.log('  sourceSheet=', tradesSheetName);
  console.log('  sourceRow=', macroTotalBalance.rowIndex + 1);
  console.log('  sourceColumn=C');
  console.log('  rawValue=', macroTotalBalance.value);
  console.log('  parsedValue=', typeof macroTotalBalance.value === 'number' ? macroTotalBalance.value : 0);
  console.log('  fallbackUsed=false');
} else {
  console.log('  sourceSheet=', tradesSheetName);
  console.log('  sourceRow=', 'NOT_FOUND');
  console.log('  sourceColumn=', 'N/A');
  console.log('  rawValue=', 'NOT_FOUND');
  console.log('  parsedValue=', 0);
  console.log('  fallbackUsed=true (QUIK sheet summation)');
}

console.log('\nC10 (profitC10):');
if (profitC10) {
  console.log('  sourceSheet=', tradesSheetName);
  console.log('  sourceRow=', profitC10.rowIndex + 1);
  console.log('  sourceColumn=C');
  console.log('  rawValue=', profitC10.value);
  console.log('  parsedValue=', typeof profitC10.value === 'number' ? profitC10.value : 0);
} else {
  console.log('  sourceSheet=', tradesSheetName);
  console.log('  sourceRow=', 'NOT_FOUND');
  console.log('  sourceColumn=', 'N/A');
  console.log('  rawValue=', 'NOT_FOUND');
  console.log('  parsedValue=', 0);
}

console.log('\nC11 (profitC11):');
if (profitC11) {
  console.log('  sourceSheet=', tradesSheetName);
  console.log('  sourceRow=', profitC11.rowIndex + 1);
  console.log('  sourceColumn=C');
  console.log('  rawValue=', profitC11.value);
  console.log('  parsedValue=', typeof profitC11.value === 'number' ? profitC11.value : 0);
} else {
  console.log('  sourceSheet=', tradesSheetName);
  console.log('  sourceRow=', 'NOT_FOUND');
  console.log('  sourceColumn=', 'N/A');
  console.log('  rawValue=', 'NOT_FOUND');
  console.log('  parsedValue=', 0);
}

console.log('\nC12 (investedFunds):');
if (investedFunds) {
  console.log('  sourceSheet=', tradesSheetName);
  console.log('  sourceRow=', investedFunds.rowIndex + 1);
  console.log('  sourceColumn=C');
  console.log('  rawValue=', investedFunds.value);
  console.log('  parsedValue=', typeof investedFunds.value === 'number' ? investedFunds.value : 0);
} else {
  console.log('  sourceSheet=', tradesSheetName);
  console.log('  sourceRow=', 'NOT_FOUND');
  console.log('  sourceColumn=', 'N/A');
  console.log('  rawValue=', 'NOT_FOUND');
  console.log('  parsedValue=', 0);
}

console.log('\n' + '='.repeat(80));
console.log('[DIAGNOSTIC] END');
console.log('='.repeat(80));
