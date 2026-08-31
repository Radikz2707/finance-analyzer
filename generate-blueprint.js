import fs from 'fs';
import path from 'path';

const dir = path.join('.audit', 'project-blueprint');
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

const ignore = new Set([
  'node_modules',
  'dist',
  '.git',
  '.audit',
  'archives',
  '.cache',
  '.tmp',
  '.gigacode',
]);

function buildTree(currentDir, prefix = '') {
  let output = '';
  const files = fs.readdirSync(currentDir);
  const filtered = files.filter((f) => !ignore.has(f));

  filtered.forEach((file, index) => {
    const isLast = index === filtered.length - 1;
    const filePath = path.join(currentDir, file);
    const stat = fs.statSync(filePath);
    const marker = isLast ? '└── ' : '├── ';

    output += prefix + marker + file + '\n';

    if (stat.isDirectory()) {
      output += buildTree(filePath, prefix + (isLast ? '    ' : '│   '));
    }
  });
  return output;
}

const treeText = buildTree('.');
const mdContent = `# 🗺️ Архитектурный чертеж проекта\n\n\`\`\`text\n. (root)\n${treeText}\`\`\`\n`;

fs.writeFileSync(path.join(dir, 'structure.md'), mdContent, 'utf8');
console.log(
  '✅ Схема структуры успешно сгенерирована в .audit/project-blueprint/structure.md',
);
