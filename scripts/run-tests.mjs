// Bundles a TS test with esbuild and runs it in Node.
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';

const entry = process.argv[2];
if (!entry) { console.error('usage: node scripts/run-tests.mjs test/sim.test.ts'); process.exit(1); }
mkdirSync('.tmp', { recursive: true });
const out = `.tmp/${entry.split('/').pop()?.replace(/\.ts$/, '')}.mjs`;
await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'warning' });
await import(pathToFileURL(resolve(out)).href);
