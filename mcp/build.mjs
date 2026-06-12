import * as esbuild from 'esbuild';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isProduction = process.argv.includes('production');

await esbuild.build({
  entryPoints: ['server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  outfile: 'server.js',
  external: ['sql.js'],
  sourcemap: isProduction ? false : 'inline',
  minify: isProduction,
  logLevel: 'info',
});

console.log('MCP Server built successfully.');
