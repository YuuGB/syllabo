import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ⚠️ Remplace '/syllabo/' par '/NOM-DE-TON-REPO/' (comme pour l'appli budget)
export default defineConfig({
  plugins: [react()],
  base: '/syllabo/',
})
