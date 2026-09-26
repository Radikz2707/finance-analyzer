const fs = require('fs');
const filePath = 'src/js/modules/ai-advisor/ai-client.ts';
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

// Находим метод buildPortfolioContext
let startIdx = -1, endIdx = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('private buildPortfolioContext(')) startIdx = i;
  if (i > startIdx && lines[i].includes('private buildUserPrompt(')) { endIdx = i; break; }
}

console.log('Method from line', startIdx + 1, 'to', endIdx);

// Заменяем " на ' в строковых литералах
const fixedLines = lines.slice(startIdx, endIdx).map(line => {
  // Пропускаем строки с типами
  if (line.match(/:\s*(number|string|boolean|undefined|null)/)) return line;
  // Заменяем " на '
  return line.replace(/"([^"\\]|\\.)*"/g, (m) => m.replace(/"/g, "'"));
});

const newContent = lines.slice(0, startIdx).join('\n') + '\n' + fixedLines.join('\n') + '\n' + lines.slice(endIdx).join('\n');
fs.writeFileSync(filePath, newContent);
console.log('Fixed quotes.');
