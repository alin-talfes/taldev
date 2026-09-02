import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function javascriptFiles(directory) {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? javascriptFiles(path) : (path.endsWith('.js') ? [path] : []);
  });
}

for (const file of javascriptFiles('js')) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}
console.log('Sintaxa JavaScript este validă.');
