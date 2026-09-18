// Fails when the built site (dist/) exceeds the size budget.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LIMIT = 10 * 1024 * 1024;

function walk(dir) {
  let total = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    total += st.isDirectory() ? walk(p) : st.size;
  }
  return total;
}

const total = walk('dist');
const mb = (total / 1024 / 1024).toFixed(2);
if (total > LIMIT) {
  console.error(`dist is ${mb} MB, over the 10 MB budget`);
  process.exit(1);
}
console.log(`dist is ${mb} MB (budget 10 MB)`);
