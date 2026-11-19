import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  optimizeDeps: {
    // Prevents Vite's dev pre-bundler from breaking Rapier's embedded WASM loader
    exclude: ['@dimforge/rapier3d-compat'],
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});