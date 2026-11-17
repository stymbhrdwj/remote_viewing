import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

const isProduction = process.argv.includes('--production');
const isWatch = process.argv.includes('--watch');

async function build() {
  if (!fs.existsSync('dist')) {
    fs.mkdirSync('dist', { recursive: true });
  }

  // Copy webview static assets to dist
  fs.copyFileSync('src/webview/viewer.css', 'dist/viewer.css');
  fs.copyFileSync('src/webview/viewer.js', 'dist/viewer.js');
  console.log('[esbuild] Copied viewer.css and viewer.js to dist/');

  const buildOptions = {
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'dist/extension.js',
    external: ['vscode', 'mupdf', '@jsquash/webp', '@jsquash/webp/*'],
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    sourcemap: !isProduction,
    minify: isProduction,
    logLevel: 'info',
  };

  if (isWatch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log('[esbuild] Watching for changes...');
  } else {
    await esbuild.build(buildOptions);
    console.log('[esbuild] Extension built successfully.');
  }
}

build().catch((err) => {
  console.error('[esbuild] Build error:', err);
  process.exit(1);
});
