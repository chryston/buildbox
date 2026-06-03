import type { Config } from 'tailwindcss'
import forms from '@tailwindcss/forms'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: '#1c1c1e',
        panel: '#2c2c2e',
        'surface-raised': '#3a3a3c',
        accent: '#0a84ff',
        'accent-hover': '#1a93ff',
        divider: '#38383a',
        'text-primary': '#f5f5f7',
        'text-muted': '#86868b',
      },
    },
  },
  plugins: [forms],
} satisfies Config
