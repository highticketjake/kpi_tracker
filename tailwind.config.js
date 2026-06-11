/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Figtree", "system-ui", "sans-serif"],
        display: ["Figtree", "system-ui", "sans-serif"],
      },
      colors: {
        // Performance Windows brand palette (Brand Guidelines v1.0)
        pw: {
          black: "#231F20",
          red: "#EB2229",
          darkred: "#831618",
          orange: "#EA6E30",
          yellow: "#F6C444",
          blue: "#1478C8",
          skyblue: "#A9D9F4",
          green: "#108D07",
          lightgreen: "#B8D576",
          tan: "#E1C8B4",
          lighttan: "#F7F0EC",
          // dark-theme surfaces derived from PW black
          surface: "#2C2728",
          surface2: "#363031",
          line: "#403A3B",
          muted: "#9B9495",
        },
      },
      keyframes: {
        "pw-pop": {
          "0%": { transform: "scale(0.85)", opacity: "0" },
          "60%": { transform: "scale(1.06)", opacity: "1" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        "pw-rise": {
          "0%": { transform: "translateY(10px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "pw-fill": {
          "0%": { height: "0%" },
        },
        "pw-pulse": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
      },
      animation: {
        "pw-pop": "pw-pop 0.35s ease-out both",
        "pw-rise": "pw-rise 0.4s ease-out both",
        "pw-fill": "pw-fill 1.2s ease-out both",
        "pw-pulse": "pw-pulse 2.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
