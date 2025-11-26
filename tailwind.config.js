/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./admin.html",
    "./*.tsx",
    "./components/**/*.tsx",
    "./contexts/**/*.tsx",
    "./hooks/**/*.ts",
  ],
  darkMode: 'class',
  theme: {
    extend: {},
  },
  plugins: [],
}
