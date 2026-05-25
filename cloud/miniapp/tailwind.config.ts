import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

/**
 * Цвета берём из CSS-переменных Telegram-темы (--tg-theme-*), которые Telegram
 * сам инжектит в :root под клиента (светлая/тёмная). Дефолты — на случай
 * запуска вне Telegram. `accent` — наш brand (зелёный, как админка).
 */
const tg = (name: string, fallback: string) => `var(--tg-theme-${name}, ${fallback})`;

const config: Config = {
    content: ["./index.html", "./src/**/*.{ts,tsx}"],
    theme: {
        extend: {
            colors: {
                bg: tg("bg-color", "#ffffff"),
                "secondary-bg": tg("secondary-bg-color", "#f1f1f4"),
                text: tg("text-color", "#0f0f0f"),
                hint: tg("hint-color", "#8a8a8e"),
                link: tg("link-color", "#2481cc"),
                button: tg("button-color", "#2481cc"),
                "button-text": tg("button-text-color", "#ffffff"),
                accent: { DEFAULT: "hsl(158 64% 45%)", fg: "#ffffff" },
                danger: "hsl(0 72% 55%)",
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
