import type { Config } from 'tailwindcss'
import forms from '@tailwindcss/forms'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: '#1e1e2e',
        panel: '#2a2a3e',
        accent: '#7c3aed',
      },
    },
  },
  plugins: [forms],
} satisfies Config
