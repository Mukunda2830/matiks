/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'panel': '#f8fafc',
        'surface': '#ffffff',
        'surface2': '#f1f5f9',
        'border': '#e2e8f0',
        'accent': '#2563eb',
        'accent2': '#16a34a',
        'warn': '#d97706',
        'danger': '#dc2626',
        'muted': '#64748b',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      boxShadow: {
        'card': '0 1px 3px 0 rgb(0 0 0 / 0.05), 0 1px 2px -1px rgb(0 0 0 / 0.05)',
        'card-hover': '0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.04)',
      },
      animation: {
        'pulse-fast': 'pulse 0.6s cubic-bezier(0.4,0,0.6,1) infinite',
        'glow': 'glow 0.8s ease-in-out',
        'slide-in': 'slideIn 0.3s ease-out',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 0px rgba(37,99,235,0)' },
          '50%': { boxShadow: '0 0 15px rgba(37,99,235,0.3)' },
          '100%': { boxShadow: '0 0 0px rgba(37,99,235,0)' },
        },
        slideIn: {
          '0%': { transform: 'translateY(-8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
