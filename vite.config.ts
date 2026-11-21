import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Relative base so the build works from any path (Netlify, sub-folders, offline copies).
export default defineConfig({
  base: './',
  plugins: [react()],
})
