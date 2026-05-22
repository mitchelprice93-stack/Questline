/** @type {import('tailwindcss').Config} */
module.exports = {
  // lib/ is included so palette class strings declared as TS literals (e.g.
  // urgencyClasses in lib/dates.ts) are picked up by Tailwind's content scan.
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
    './lib/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  // Class-based dark mode: NativeWind's setColorScheme() toggles the
  // 'dark' class on the root and every `dark:` variant kicks in. We use
  // class mode (not media) so the chronicler's manual override in
  // Settings can beat the system preference when chosen.
  darkMode: 'class',
  theme: {
    extend: {
      // Phase 3.1 typography: Cinzel for display headings, EB Garamond for body.
      // Loaded by useFonts in app/_layout.tsx.
      fontFamily: {
        display: ['Cinzel_400Regular'],
        'display-bold': ['Cinzel_700Bold'],
        body: ['EBGaramond_400Regular'],
        'body-medium': ['EBGaramond_500Medium'],
        'body-semibold': ['EBGaramond_600SemiBold'],
      },
    },
  },
  plugins: [],
};
