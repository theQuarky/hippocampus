/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: 'rgb(var(--bg-primary-rgb) / <alpha-value>)',
          surface: 'rgb(var(--bg-surface-rgb) / <alpha-value>)',
          panel: 'rgb(var(--bg-panel-rgb) / <alpha-value>)',
        },
        border: 'rgb(var(--border-rgb) / <alpha-value>)',
        accent: {
          DEFAULT: 'rgb(var(--accent-rgb) / <alpha-value>)',
          hover: 'rgb(var(--accent-hover-rgb) / <alpha-value>)',
        },
        text: {
          primary: 'rgb(var(--text-primary-rgb) / <alpha-value>)',
          muted: 'rgb(var(--text-muted-rgb) / <alpha-value>)',
          dim: 'rgb(var(--text-dim-rgb) / <alpha-value>)',
        },
        success: 'rgb(var(--success-rgb) / <alpha-value>)',
        warning: 'rgb(var(--warning-rgb) / <alpha-value>)',
        danger: 'rgb(var(--danger-rgb) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
};
