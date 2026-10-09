import { defineConfig } from 'vite'; import react from '@vitejs/plugin-react'; import { fileURLToPath } from 'node:url';
export default defineConfig({ plugins: [react()], resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { proxy: { '/api': 'http://localhost:3001', '/ws': { target: 'ws://localhost:3001', ws: true } } } });
