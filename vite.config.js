import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  plugins: [
    vue(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // jsPDF lazily imports these only for doc.html(), which the app never
      // calls (PDF export uses addImage/svg2pdf). Stubbing reclaims ~58KB
      // gzip; see scripts/vite-stubs/.
      'html2canvas': path.resolve(__dirname, 'scripts/vite-stubs/html2canvas-stub.js'),
      'dompurify': path.resolve(__dirname, 'scripts/vite-stubs/dompurify-stub.js'),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
})
