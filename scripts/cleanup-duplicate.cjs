const fs = require('fs');
const filePath = 'src/js/modules/ai-advisor/ai-client.ts';
const lines = fs.readFileSync(filePath, 'utf8').split('\n');

// Удалить дубликат старого метода (строки 252-641, 0-indexed: 251-640)
const newLines = lines.slice(0, 251).concat(lines.slice(641));
fs.writeFileSync(filePath, newLines.join('\n'));
console.log('Removed duplicate old method body.');
console.log('Lines before:', lines.length);
console.log('Lines after:', newLines.length);
