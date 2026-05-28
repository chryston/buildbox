import type { Config } from 'tailwindcss'
import forms from '@tailwindcss/forms'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: '#ffffff',
        panel: '#f8f9fa',
        accent: '#2563eb',
        'accent-hover': '#1d4ed8',
        divider: '#e5e7eb',
        'text-primary': '#111827',
        'text-muted': '#6b7280',
      },
    },
  },
  plugins: [forms],
} satisfies Config
