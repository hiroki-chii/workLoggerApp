import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Electron で file:// プロトコルを使用するため、ベースパスを相対パスに設定
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
