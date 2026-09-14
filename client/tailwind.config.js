/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        emerald: {
          DEFAULT: "#059669",
        },
        slate: {
          DEFAULT: "#0f172a",
        },
      },
    },
  },
  plugins: [],
};