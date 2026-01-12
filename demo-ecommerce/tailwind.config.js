/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/views/**/*.{html,erb}',
    './app/javascript/**/*.{js,ts,jsx,tsx}',
  ],
  important: '#root',
  corePlugins: { preflight: false },
  theme: { extend: {} },
  plugins: [],
}
