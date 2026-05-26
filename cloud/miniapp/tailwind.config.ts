import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

/** Палитра 1:1 с админкой через HSL-переменные (см. src/index.css). */
const config: Config = {
    darkMode: ["class"],
    content: ["./index.html", "./src/**/*.{ts,tsx}"],
    theme: {
        extend: {
            colors: {
                bg: "hsl(var(--background))",
                "secondary-bg": "hsl(var(--secondary))",
                card: "hsl(var(--card))",
                text: "hsl(var(--foreground))",
                hint: "hsl(var(--muted-foreground))",
                border: "hsl(var(--border))",
                accent: { DEFAULT: "hsl(var(--primary))", fg: "hsl(var(--primary-foreground))" },
                danger: "hsl(var(--destructive))",
            },
            borderRadius: { xl: "0.875rem", "2xl": "1.25rem" },
            fontFamily: {
                sans: ["-apple-system", "BlinkMacSystemFont", "SF Pro Display", "Inter", "Segoe UI", "Roboto", "sans-serif"],
            },
            keyframes: {
                "slide-up": { from: { transform: "translateY(100%)" }, to: { transform: "translateY(0)" } },
                "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
                "pop": { "0%": { transform: "scale(1)" }, "50%": { transform: "scale(0.94)" }, "100%": { transform: "scale(1)" } },
            },
            animation: {
                "slide-up": "slide-up 220ms cubic-bezier(0.16,1,0.3,1)",
                "fade-in": "fade-in 160ms ease-out",
                "pop": "pop 140ms ease-out",
            },
        },
    },
    plugins: [animate],
};

export default config;
