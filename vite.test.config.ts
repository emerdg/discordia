import { defineConfig } from 'vite';

// Build paralelo para a URL /teste (preview do novo visual sem tocar na produção).
export default defineConfig({
  base: '/teste/',
  server: {
    host: true,
    port: 5174,
  },
  build: {
    outDir: 'dist/teste',
    emptyOutDir: true,
    sourcemap: true,
  },
});