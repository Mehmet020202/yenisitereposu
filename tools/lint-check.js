const fs = require('fs');

const files = [
  'public/js/config.js',
  'public/js/db.js',
  'public/js/price-engine.js',
  'public/js/price-formatter.js',
  'public/js/price-validator.js',
  'public/js/theme-manager.js',
  'public/js/theme-registry.js',
  'public/js/tv.js',
  'public/js/admin.js',
  'public/js/themes/theme-2.js'
];

let found = 0;
files.forEach(f => {
  const code = fs.readFileSync(f, 'utf8');
  const lines = code.split('\n');
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) return;
    
    if (/\b(let|const)\s+[a-zA-Z_$]/.test(line)) {
      console.log(`${f}:${i+1} Uses let/const: ${trimmed}`);
      found++;
    }
    if (/[a-zA-Z0-9_$)\]]\s*=>\s*[{a-zA-Z0-9_]/.test(line)) {
      console.log(`${f}:${i+1} Uses arrow func: ${trimmed}`);
      found++;
    }
    if (/\b(async\s+function|await\s+)/.test(line)) {
      console.log(`${f}:${i+1} Uses async/await: ${trimmed}`);
      found++;
    }
    if (line.includes('`')) {
      console.log(`${f}:${i+1} Uses template literal: ${trimmed}`);
      found++;
    }
  });
});
console.log(`Scan completed. Total non-ES5 issues found: ${found}`);
