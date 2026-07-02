import { defineConfig } from 'vite';

export default defineConfig({
  root: './',
  server: {
    port: 5173,
    host: true,
    strictPort: true,
    fs: {
      strict: true,
      allow: ['.']
    },
    watch: {
      ignored: ['.gemini/**', '.system_generated/**', '**/.gemini/**', '**/.system_generated/**']
    }
  },
});
