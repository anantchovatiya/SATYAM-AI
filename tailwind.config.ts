import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#7c3aed",
          foreground: "#ffffff",
        },
      },
      boxShadow: {
        panel: "0 8px 30px rgba(2, 6, 23, 0.08)",
      },
    },
  },
  plugins: [],
};

export default config;
