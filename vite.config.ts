import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/buildbox/',
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // e2e/ is Playwright's tree (#38); its *.spec.ts files are not Vitest files.
    exclude: ['e2e/**', ...configDefaults.exclude],
  },
})
