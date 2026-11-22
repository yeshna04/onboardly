/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["'Inter Variable'", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        // Sunset coral – primary
        brand: {
          50: "#fff6f1", 100: "#ffeadf", 200: "#ffd0bb", 300: "#ffad8c", 400: "#fd8459",
          500: "#f97316", 600: "#e8590c", 700: "#c2410c", 800: "#9a3412", 900: "#7c2d12", 950: "#431407",
        },
        // Plum / pink – accent
        accent: {
          50: "#fdf2f8", 100: "#fce7f3", 200: "#fbcfe8", 300: "#f9a8d4", 400: "#f472b6",
          500: "#ec4899", 600: "#db2777", 700: "#be185d", 800: "#9d174d", 900: "#831843", 950: "#500724",
        },
        // Surfaces
        cream: "#fffaf5",
        plum: { 950: "#160b14", 900: "#1d0f1b", 850: "#231321", 800: "#2b1728", 700: "#3a2036" },
      },
      boxShadow: {
        card: "0 1px 2px rgba(67,20,7,.04), 0 2px 8px -2px rgba(67,20,7,.06)",
        lift: "0 18px 40px -18px rgba(190,70,40,.35)",
        glow: "0 0 0 4px rgba(249,115,22,.18)",
        "glow-lg": "0 10px 30px -8px rgba(236,72,153,.45)",
      },
      keyframes: {
        shimmer: { "100%": { transform: "translateX(100%)" } },
        "pulse-dot": { "0%,100%": { opacity: 1 }, "50%": { opacity: 0.35 } },
        blob1: { "0%,100%": { transform: "translate(0,0) scale(1)" }, "33%": { transform: "translate(8vw,6vh) scale(1.12)" }, "66%": { transform: "translate(-4vw,10vh) scale(.94)" } },
        blob2: { "0%,100%": { transform: "translate(0,0) scale(1)" }, "33%": { transform: "translate(-10vw,-4vh) scale(.92)" }, "66%": { transform: "translate(-3vw,8vh) scale(1.1)" } },
        blob3: { "0%,100%": { transform: "translate(0,0) scale(1) rotate(0deg)" }, "50%": { transform: "translate(6vw,-8vh) scale(1.15) rotate(20deg)" } },
        "gradient-x": { "0%,100%": { backgroundPosition: "0% 50%" }, "50%": { backgroundPosition: "100% 50%" } },
        sheen: { "0%": { transform: "translateX(-120%) skewX(-20deg)" }, "100%": { transform: "translateX(220%) skewX(-20deg)" } },
        float: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-8px)" } },
      },
      animation: {
        shimmer: "shimmer 1.6s infinite",
        "pulse-dot": "pulse-dot 1.4s ease-in-out infinite",
        blob1: "blob1 28s ease-in-out infinite",
        blob2: "blob2 34s ease-in-out infinite",
        blob3: "blob3 40s ease-in-out infinite",
        "gradient-x": "gradient-x 8s ease infinite",
        sheen: "sheen .9s ease-out",
        float: "float 6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
