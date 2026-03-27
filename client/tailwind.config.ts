import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      keyframes: {
        "bounce-in": {
          "0%":   { opacity: "0", transform: "translate(-50%, -12px) scale(0.9)" },
          "60%":  { opacity: "1", transform: "translate(-50%, 2px) scale(1.03)" },
          "100%": { opacity: "1", transform: "translate(-50%, 0) scale(1)" },
        },
      },
      animation: {
        "bounce-in": "bounce-in 0.35s ease-out forwards",
      },
    },
  },
  plugins: [],
};

export default config;
