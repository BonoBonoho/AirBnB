import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // amazon-cognito-identity-js가 Node 전역 `global`을 참조하므로 브라우저용으로 치환
  define: { global: 'globalThis' },
})
