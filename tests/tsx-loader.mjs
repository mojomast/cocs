// Minimal ESM loader for the SSR UI tests: transpiles .ts/.tsx with the
// esbuild that ships inside the toolchain (no new dependency) so React
// components can be imported and rendered with react-dom/server in-process.
// Kept out of *.test.mjs so the runner never executes it as a test.
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';

export async function load(url, context, nextLoad) {
  if (url.endsWith('.tsx') || url.endsWith('.ts')) {
    const source = await readFile(new URL(url), 'utf8');
    const {code} = await transform(source, {
      loader: url.endsWith('.tsx') ? 'tsx' : 'ts',
      format: 'esm',
      jsx: 'automatic',
      jsxImportSource: 'react',
      sourcefile: url,
      target: 'node22',
    });
    return {format: 'module', source: code, shortCircuit: true};
  }
  return nextLoad(url, context);
}
