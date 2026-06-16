/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}'],
  // the site has its own global reset/custom CSS — don't let Tailwind's
  // preflight reset everything site-wide; we only want the utility classes
  corePlugins: { preflight: false },
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter Tight"', '"Helvetica Neue"', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Courier New"', 'monospace'],
      },
    },
  },
  plugins: [],
}
