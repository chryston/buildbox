import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: {
    outDir: 'prototype-static',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'prototype-project-library.html'),
    },
  },
})
