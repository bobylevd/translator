import * as esbuild from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = __dirname;
const dist = resolve(root, 'dist');

const watch = process.argv.includes('--watch');

const entries = [
  { in: 'src/background/service-worker.ts', out: 'background/service-worker' },
  { in: 'src/background/engine.worker.ts', out: 'background/engine.worker' },
  { in: 'src/content/main.ts', out: 'content/main' },
  { in: 'src/popup/main.ts', out: 'popup/main' },
];

const buildOptions = {
  entryPoints: entries.map(e => ({ in: resolve(root, e.in), out: e.out })),
  outdir: dist,
  bundle: true,
  format: 'iife',
  target: ['firefox128'],
  platform: 'browser',
  sourcemap: 'inline',
  logLevel: 'info',
};

async function copyStatic() {
  const items = [
    { src: 'manifest.json', dst: 'manifest.json' },
    { src: 'icons', dst: 'icons', optional: false },
    { src: 'popup/index.html', dst: 'popup/index.html', optional: false },
    { src: 'popup/styles.css', dst: 'popup/styles.css', optional: false },
    { src: 'vendor', dst: 'vendor', optional: true },
  ];
  for (const item of items) {
    const from = resolve(root, item.src);
    const to = resolve(dist, item.dst);
    if (!existsSync(from)) {
      if (item.optional) continue;
      throw new Error(`Required source missing: ${from}`);
    }
    await cp(from, to, { recursive: true });
  }
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await copyStatic();

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log('esbuild: watching for changes…');
} else {
  await esbuild.build(buildOptions);
  console.log('esbuild: build complete →', dist);
}
