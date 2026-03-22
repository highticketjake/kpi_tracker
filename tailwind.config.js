/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Bebas Neue"', "Impact", "Haettenschweiler", "sans-serif"],
        tv: ['"IBM Plex Sans"', "system-ui", "sans-serif"],
      },
      keyframes: {
        "tv-breathe": {
          "0%, 100%": { opacity: "0.55", transform: "scale(1)" },
          "50%": { opacity: "0.95", transform: "scale(1.03)" },
        },
        "tv-drift": {
          "0%, 100%": { transform: "translate(0%, 0%) rotate(0deg)" },
          "33%": { transform: "translate(0.4%, -0.3%) rotate(0.2deg)" },
          "66%": { transform: "translate(-0.35%, 0.35%) rotate(-0.15deg)" },
        },
        "tv-grid": {
          "0%, 100%": { backgroundPosition: "0px 0px, 0px 0px" },
          "50%": { backgroundPosition: "8px 12px, -6px 4px" },
        },
        "tv-float": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-5px)" },
        },
        "tv-shimmer": {
          "0%, 100%": { opacity: "0.4" },
          "50%": { opacity: "0.75" },
        },
      },
      animation: {
        "tv-breathe": "tv-breathe 10s ease-in-out infinite",
        "tv-drift": "tv-drift 22s ease-in-out infinite",
        "tv-grid": "tv-grid 14s ease-in-out infinite",
        "tv-float": "tv-float 7s ease-in-out infinite",
        "tv-shimmer": "tv-shimmer 5s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
