/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  // Touch devices fire :hover on tap and keep it until you tap something else,
  // so hover effects looked like they animated at random on mobile — a card's
  // arrow would sit nudged after being scrolled past. This restricts every
  // hover: variant to devices that actually have a pointer.
  future: { hoverOnlyWhenSupported: true },
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
        ink: '#0B0B0B',
        cream: { DEFAULT: '#f9f4eb', dim: 'rgba(249,244,235,0.65)', faint: 'rgba(249,244,235,0.25)' },
        // site accent — now var-driven so the dashboard (.dbx) can rescope it;
        // :root sets it to the same lama blue, so text-accent etc. is unchanged
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        // shadcn tokens (values defined on :root / .dbx in globals.css)
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      backgroundImage: {
        'lama-dots': 'radial-gradient(rgba(249,244,235,0.07) 1px, transparent 1px)',
      },
      keyframes: {
        'lama-marquee': {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
      },
      animation: {
        'lama-marquee': 'lama-marquee 40s linear infinite',
        shimmer: 'shimmer 2s linear infinite',
      },
    },
  },
  plugins: [],
}
