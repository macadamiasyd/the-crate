import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: '#0a0a0a',
        surface: '#141414',
        surface2: '#1e1e1e',
        cream: '#ede5d8',
        'cream-dim': '#a09585',
        accent: '#c45e3a',
        teal: '#6ba89a',
        border: '#2a2a2a',
      },
    },
  },
  plugins: [],
}

export default config
