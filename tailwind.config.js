/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx}'],
  // the site has its own global reset/custom CSS — don't let Tailwind's
  // preflight reset everything site-wide; we only want the utility classes
  corePlugins: { preflight: false },
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter Tight"', '"Helvetica Neue"', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Courier New"', 'monospace'],
        lamah: ['var(--font-archivo)', 'Helvetica', 'Arial', 'sans-serif'],
        lamam: ['var(--font-sometype)', '"Courier New"', 'monospace'],
      },
      colors: {
        ink: '#1a1c1c',
        cream: { DEFAULT: '#f9f4eb', dim: 'rgba(249,244,235,0.65)', faint: 'rgba(249,244,235,0.25)' },
        accent: '#298dff',
      },
      backgroundImage: {
        'lama-dots': 'radial-gradient(rgba(249,244,235,0.07) 1px, transparent 1px)',
      },
      keyframes: {
        'lama-marquee': {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
      },
      animation: {
        'lama-marquee': 'lama-marquee 40s linear infinite',
      },
    },
  },
  plugins: [],
}
