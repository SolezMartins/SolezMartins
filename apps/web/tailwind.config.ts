import type { Config } from 'tailwindcss';
const c = (v: string) => `hsl(var(--${v}) / <alpha-value>)`;
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {
    colors: { background: c('background'), foreground: c('foreground'), card: c('card'), muted: { DEFAULT: c('muted'), foreground: c('muted-foreground') }, border: c('border'), input: c('input'),
      primary: { DEFAULT: c('primary'), foreground: c('primary-foreground') }, destructive: c('destructive'), ring: c('ring'), bull: c('bull'), bear: c('bear') },
    borderRadius: { md: 'var(--radius)' },
    fontFamily: { sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'], mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'] },
  } },
} satisfies Config;
