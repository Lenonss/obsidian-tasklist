import esbuild from 'esbuild';
import process from 'process';
import builtins from 'builtin-modules';
import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const prod = process.argv[2] === 'production';

const context = await esbuild.context({
  entryPoints: ['main.ts'],
  bundle: true,
  external: [
    'obsidian',
    'electron',
    '@codemirror/autocomplete',
    '@codemirror/collab',
    '@codemirror/commands',
    '@codemirror/language',
    '@codemirror/lint',
    '@codemirror/search',
    '@codemirror/state',
    '@codemirror/view',
    '@lezer/common',
    '@lezer/highlight',
    '@lezer/lr',
    ...builtins,
  ],
  format: 'cjs',
  target: 'es2018',
  logLevel: 'info',
  sourcemap: prod ? false : 'inline',
  treeShaking: true,
  outfile: 'main.js',
  minify: prod,
});

if (prod) {
  await context.rebuild();

  // Copy sql.js WASM file to output directory
  const wasmSrc = 'node_modules/sql.js/dist/sql-wasm.wasm';
  const wasmDest = 'sql-wasm.wasm';
  if (existsSync(wasmSrc)) {
    copyFileSync(wasmSrc, wasmDest);
    console.log('Copied sql-wasm.wasm to output directory');
  } else {
    console.warn('WARNING: sql-wasm.wasm not found at', wasmSrc);
  }

  process.exit(0);
} else {
  await context.watch();
}
