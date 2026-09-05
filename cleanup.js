const fs = require('fs');
const path = require('path');

const files = fs.readdirSync('.')
  .filter(f => f.startsWith('test-') && f.endsWith('.ts'));

files.forEach(f => {
  fs.unlinkSync(f);
  console.log('Deleted: ' + f);
});

console.log('Done!');
