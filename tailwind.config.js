/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
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
