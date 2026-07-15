/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0B0F17',
        panel: 'rgba(21, 28, 41, 0.82)',
        line: 'rgba(148, 163, 184, 0.18)',
      },
      boxShadow: {
        soft: '0 20px 70px rgba(0, 0, 0, 0.22)',
      },
    },
  },
  plugins: [],
}
