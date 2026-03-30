/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: '#0f1117',
          surface: '#13151a',
          panel: '#1a1d24',
        },
        border: '#2a2d36',
        accent: {
          DEFAULT: '#6366f1',
          hover: '#818cf8',
        },
        text: {
          primary: '#e2e8f0',
          muted: '#94a3b8',
          dim: '#64748b',
        },
        success: '#22c55e',
        warning: '#f59e0b',
        danger: '#ef4444',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
};
