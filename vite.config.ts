import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// blake3-bao's ESM entry points load their CommonJS implementation through
// `createRequire`, which does not exist in a browser. The CommonJS files
// themselves are plain (no Node built-ins), so the app imports those directly
// and Vite's dependency pre-bundling converts them.
const blake3Bao = (file: string) => path.resolve(__dirname, 'node_modules/blake3-bao', file);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      'blake3-bao/bao.js': blake3Bao('bao.js'),
      'blake3-bao/blake3.js': blake3Bao('blake3.js'),
    },
  },
  optimizeDeps: {
    include: ['blake3-bao/bao.js', 'blake3-bao/blake3.js'],
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
