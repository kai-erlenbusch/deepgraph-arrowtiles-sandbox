import { defineConfig } from 'vite';

export default defineConfig({
  root: './',
  assetsInclude: ['**/*.arrowtiles', '**/*.parquet', '**/*.duckdb'],
  server: {
    port: 5173,
    host: true,
    strictPort: true,
    fs: {
      strict: true,
      allow: ['.']
    },
    watch: {
      ignored: ['.logs/**', 'research/**', '**/*.parquet', '**/s3_cache/**', '**/data/**', '**/dist/**', '**/*.arrowtiles', '.gemini/**', '.system_generated/**', '**/.gemini/**', '**/.system_generated/**']
    }
  },
  optimizeDeps: {
    exclude: ['three', 'three/webgpu', 'three/tsl', 'apache-arrow', 'pmtiles', 'lil-gui']
  }
});
