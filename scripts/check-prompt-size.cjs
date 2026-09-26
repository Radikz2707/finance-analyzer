const fs = require('fs');
const c = fs.readFileSync('src/js/modules/ai-advisor/ai-client.ts', 'utf8');
const ctxStart = c.indexOf('let ctx = "===');
const ctxEnd = c.indexOf('return ctx;');
console.log('Context body:', (ctxEnd - ctxStart), 'chars');

const p = fs.readFileSync('src/js/modules/ai-advisor/prompt-templates.ts', 'utf8');
const promptStart = p.indexOf('let prompt =');
const promptEnd = p.indexOf('return prompt;');
console.log('System prompt:', (promptEnd - promptStart), 'chars');

console.log('Total (context + system):', (ctxEnd - ctxStart) + (promptEnd - promptStart), 'chars');
