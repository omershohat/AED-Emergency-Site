/** @type {import('tailwindcss').Config} */
export default {
  // Tailwind scans these files for class names and generates ONLY the CSS that
  // is actually used. A class built by string concatenation (e.g. `text-${c}`)
  // would not be found by that scan - which is why every dynamic class in this
  // project is written as a complete literal string.
  content: [
    './app/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        // One palette, named by meaning rather than by colour, so the emergency
        // red always comes from the same place.
        emergency: { DEFAULT: '#dc2626', dark: '#991b1b', light: '#fee2e2' },
        lora: { DEFAULT: '#7c3aed', light: '#ede9fe' },   // the mesh channel
        cell: { DEFAULT: '#0891b2', light: '#cffafe' },   // the cellular channel
        offline: { DEFAULT: '#64748b', light: '#f1f5f9' },
      },
      fontFamily: {
        // A Hebrew-first stack of fonts that already exist on the machine.
        // No web font is downloaded, so the site renders identically offline -
        // which matters for a project defended on a college network.
        sans: ['Rubik', 'Assistant', 'Segoe UI', 'Arial', 'sans-serif'],
      },
      keyframes: {
        pulseRing: {
          '0%': { transform: 'scale(0.8)', opacity: '0.8' },
          '100%': { transform: 'scale(2.2)', opacity: '0' },
        },
      },
      animation: {
        pulseRing: 'pulseRing 1.8s cubic-bezier(0.2, 0.6, 0.4, 1) infinite',
      },
    },
  },
  plugins: [],
};
