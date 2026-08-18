import { defineConfig } from 'vite';

// Build paralelo para a URL /testes (preview do novo visual sem tocar na produção).
export default defineConfig({
  base: '/testes/',
  server: {
    host: true,
    port: 5174,
  },
  build: {
    outDir: 'dist/testes',
    emptyOutDir: false,
    sourcemap: true,
  },
});