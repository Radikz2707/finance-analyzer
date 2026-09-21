import XLSX from 'xlsx';
import * as fs from 'fs';

const EXCEL_FILE_PATH =
  'C:/Users/Радик/Documents/Бухгалтерия Радика/Отчет/Данные новые.xlsx';

console.log('='.repeat(80));
console.log('[DIAGNOSTIC] Точная структура колонок листа «Отчет по сделкам»');
console.log('='.repeat(80));

if (!fs.existsSync(EXCEL_FILE_PATH)) {
  console.error('[ERROR] Excel-файл не найден:', EXCEL_FILE_PATH);
  process.exit(1);
}

const workbook = XLSX.readFile(EXCEL_FILE_PATH);
const sheet = workbook.Sheets['Отчет по сделкам'];
const range = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null;

console.log('\n[SHEET] range =', sheet['!ref']);
console.log('[SHEET] sheet starts at column index:', range ? range.s.c : 'N/A');
console.log('[SHEET] sheet starts at row index:', range ? range.s.r : 'N/A');

// Read specific rows and show EXACT cell values at c:0, c:1, c:2, c:3
const targetRows = [7, 8, 9, 10]; // "Итого активов", "Текущая(ий) прибыль (убыток)", "Прибыль/Убыток", "Внесено своих средств"

console.log('\n[EXACT_CELLS] Прямое чтение ячеек:');
targetRows.forEach((rowIdx) => {
  const sheetRow = rowIdx + range!.s.r;
  console.log(`\n  Row index in sheet: ${sheetRow}`);
  
  for (let c = 0; c <= 3; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: sheetRow, c: c })];
    if (cell && cell.v !== undefined) {
      console.log(`    c:${c} = "${String(cell.v)}" (type=${cell.t})`);
    } else {
      console.log(`    c:${c} = EMPTY`);
    }
  }
});

// Also check row 0 (header)
console.log('\n[HEADER_ROW] Row 0:');
for (let c = 0; c <= 3; c++) {
  const cell = sheet[XLSX.utils.encode_cell({ r: 0, c: c })];
  if (cell && cell.v !== undefined) {
    console.log(`    c:${c} = "${String(cell.v)}" (type=${cell.t})`);
  } else {
    console.log(`    c:${c} = EMPTY`);
  }
}

// Check what sheet_to_json produces
console.log('\n[sheet_to_json] First 12 rows:');
const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
rows.slice(0, 12).forEach((row, idx) => {
  const keys = Object.keys(row);
  console.log(`  JSON row ${idx}: keys=[${keys.join(', ')}]`);
  keys.forEach(k => {
    console.log(`    ${k} = "${String(row[k] || '').substring(0, 40)}"`);
  });
});

// Direct cell-by-cell check for the KPI rows
console.log('\n[KPI_DIRECT_READ] Прямое чтение KPI строк:');
const kpiChecks = [
  { name: 'Итого активов', row: 7 },
  { name: 'Текущая(ий) прибыль (убыток)', row: 8 },
  { name: 'Прибыль/Убыток', row: 9 },
  { name: 'Внесено своих средств', row: 10 },
];

kpiChecks.forEach(({ name, row }) => {
  const sheetRow = row + range!.s.r;
  console.log(`\n  "${name}" (sheet row ${sheetRow}):`);
  
  // Check c:0 (name column)
  const nameCell0 = sheet[XLSX.utils.encode_cell({ r: sheetRow, c: 0 })];
  const nameVal0 = nameCell0 && nameCell0.v !== undefined ? String(nameCell0.v).trim() : 'EMPTY';
  console.log(`    c:0 (name) = "${nameVal0}"`);
  
  // Check c:1 (value column)
  const valCell1 = sheet[XLSX.utils.encode_cell({ r: sheetRow, c: 1 })];
  const val1 = valCell1 && valCell1.v !== undefined ? valCell1.v : 'EMPTY';
  console.log(`    c:1 (value) = "${val1}" (type=${valCell1?.t || 'N/A'})`);
  
  // Check c:2 (what parser was reading before)
  const valCell2 = sheet[XLSX.utils.encode_cell({ r: sheetRow, c: 2 })];
  const val2 = valCell2 && valCell2.v !== undefined ? valCell2.v : 'EMPTY';
  console.log(`    c:2 (old parser value col) = "${val2}" (type=${valCell2?.t || 'N/A'})`);
});

console.log('\n' + '='.repeat(80));
console.log('[DIAGNOSTIC] END');
console.log('='.repeat(80));
