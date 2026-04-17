/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Montserrat', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [require('daisyui')],
  daisyui: {
    themes: [
      {
        sqsdark: {
          'primary': '#f27c22',
          'primary-content': '#050d11',
          'secondary': '#d17609',
          'secondary-content': '#050d11',
          'accent': '#935f10',
          'accent-content': '#ffffff',
          'neutral': '#1a1a2e',
          'neutral-content': '#e0d6cc',
          'base-100': '#0f1419',
          'base-200': '#1a1f26',
          'base-300': '#050d11',
          'base-content': '#e0d6cc',
          'info': '#3abff8',
          'success': '#36d399',
          'warning': '#fbbd23',
          'error': '#ef4444',
        },
      },
    ],
  },
};
