import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { localBookArchive } from './scripts/localBookArchive';
import { createMobileServiceWorker } from './scripts/mobileServiceWorker';

const require = createRequire(import.meta.url);
const tesseractPackage = require.resolve('tesseract.js/package.json');
const tesseractCorePackage = require.resolve('tesseract.js-core/tesseract-core-lstm.wasm.js', { paths: [dirname(tesseractPackage)] });
const tesseractCorePath = dirname(tesseractCorePackage);
const pdfjsPackage = require.resolve('pdfjs-dist/package.json');
const pdfjsWasmPath = join(dirname(pdfjsPackage), 'wasm');
const koreanDataPath = require.resolve('@tesseract.js-data/kor/4.0.0_best_int/kor.traineddata.gz');
const coreFiles = [
  'tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm',
  'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm',
  'tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm',
];
const pdfjsDecoderFiles = readdirSync(pdfjsWasmPath).filter((filename) => /\.(?:wasm|js)$/.test(filename));

const localOcrAssets: Plugin = {
  name: 'local-ocr-assets',
  configureServer(server) {
    server.middlewares.use('/pdfjs/wasm', (request, response, next) => {
      const filename = basename((request.url ?? '').split('?')[0]);
      if (!pdfjsDecoderFiles.includes(filename)) return next();
      response.setHeader('Content-Type', filename.endsWith('.js') ? 'text/javascript' : 'application/wasm');
      response.end(readFileSync(join(pdfjsWasmPath, filename)));
    });
    server.middlewares.use('/ocr/core', (request, response, next) => {
      const filename = basename((request.url ?? '').split('?')[0]);
      if (!coreFiles.includes(filename)) return next();
      response.setHeader('Content-Type', filename.endsWith('.js') ? 'text/javascript' : 'application/wasm');
      response.end(readFileSync(join(tesseractCorePath, filename)));
    });
    server.middlewares.use('/ocr/lang', (request, response, next) => {
      if (basename((request.url ?? '').split('?')[0]) !== 'kor.traineddata.gz') return next();
      response.setHeader('Content-Type', 'application/gzip');
      response.end(readFileSync(koreanDataPath));
    });
  },
  generateBundle() {
    for (const filename of pdfjsDecoderFiles) {
      this.emitFile({ type: 'asset', fileName: `pdfjs/wasm/${filename}`, source: readFileSync(join(pdfjsWasmPath, filename)) });
    }
    for (const filename of coreFiles) {
      this.emitFile({ type: 'asset', fileName: `ocr/core/${filename}`, source: readFileSync(join(tesseractCorePath, filename)) });
    }
    this.emitFile({ type: 'asset', fileName: 'ocr/lang/kor.traineddata.gz', source: readFileSync(koreanDataPath) });
  },
};

const deployBase = process.env.VITE_BASE || '/';

const offlineAppShell: Plugin = {
  name: 'offline-app-shell',
  apply: 'build',
  generateBundle(_options, bundle) {
    const source = createMobileServiceWorker(Object.keys(bundle), deployBase);
    this.emitFile({ type: 'asset', fileName: 'sw.js', source });
  },
};

// GitHub Pages serves a project under /<repository>/...; VITE_BASE carries that prefix. Default stays the domain root.
export default defineConfig({
  base: deployBase,
  plugins: [react(), localBookArchive(undefined, { lanAccess: true }), localOcrAssets, offlineAppShell],
  server: { host: '0.0.0.0' },
});
