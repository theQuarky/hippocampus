/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: '#eaf7ef',
          surface: '#f4fbf7',
          panel: '#ffffff',
        },
        border: '#bfdccd',
        accent: {
          DEFAULT: '#207a57',
          hover: '#2b9870',
        },
        text: {
          primary: '#183229',
          muted: '#3d6355',
          dim: '#5f8c7a',
        },
        success: '#1d9a64',
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
