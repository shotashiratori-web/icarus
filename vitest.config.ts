import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// vite.config.tsとは独立させる。@cloudflare/vite-plugin（wrangler dev環境を前提とする）を
// component testに巻き込まないため、あえて別ファイルにする
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
  },
});
