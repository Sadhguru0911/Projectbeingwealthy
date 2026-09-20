const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');

// Extract every <style>{`...`}</style> template literal's contents
const styleBlocks = [];
const re = /<style>\{`([\s\S]*?)`\}<\/style>/g;
let m;
while ((m = re.exec(src)) !== null) styleBlocks.push(m[1]);

console.log(`Found ${styleBlocks.length} <style> block(s)`);

let totalErrors = 0;
styleBlocks.forEach((css, blockIdx) => {
  const lines = css.split('\n');
  let depth = 0;
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const opens = (trimmed.match(/{/g) || []).length;
    const closes = (trimmed.match(/}/g) || []).length;
    // Flag a declaration-looking line (has a colon, ends in semicolon, no brace) sitting at depth 0 - i.e. outside any rule
    const looksLikeDeclaration = /^[a-zA-Z-]+\s*:.*;?\s*$/.test(trimmed) && !trimmed.includes('{') && !trimmed.includes('}');
    if (depth === 0 && looksLikeDeclaration) {
      console.log(`  BLOCK ${blockIdx} LINE ${i + 1}: ORPHANED DECLARATION (no selector) -> "${trimmed}"`);
      totalErrors++;
    }
    if (depth === 0 && closes > 0 && opens === 0) {
      console.log(`  BLOCK ${blockIdx} LINE ${i + 1}: STRAY CLOSING BRACE at depth 0 -> "${trimmed}"`);
      totalErrors++;
    }
    depth += opens - closes;
    if (depth < 0) {
      console.log(`  BLOCK ${blockIdx} LINE ${i + 1}: BRACE DEPTH WENT NEGATIVE -> "${trimmed}"`);
      totalErrors++;
      depth = 0; // resync so we can keep scanning for more issues
    }
  });
  if (depth !== 0) {
    console.log(`  BLOCK ${blockIdx}: UNBALANCED — ended at depth ${depth}, should be 0`);
    totalErrors++;
  }
});

console.log(totalErrors === 0 ? 'CSS STRUCTURE OK — no orphaned declarations, no stray braces, all balanced.' : `${totalErrors} CSS STRUCTURE ISSUE(S) FOUND`);
process.exit(totalErrors === 0 ? 0 : 1);
