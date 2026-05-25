import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), "");
    return {
        plugins: [react()],
        resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
        server: {
            port: 5174,
            host: true,
            proxy: env.VITE_DEV_PROXY_TARGET
                ? {
                    "/v1": {
                        target: env.VITE_DEV_PROXY_TARGET,
                        changeOrigin: true,
                        secure: true,
                    },
                }
                : undefined,
        },
        build: {
            target: "es2022",
            sourcemap: true,
            rollupOptions: {
                output: {
                    manualChunks: {
                        react: ["react", "react-dom"],
                        tanstack: ["@tanstack/react-router", "@tanstack/react-query", "@tanstack/react-table"],
                        echarts: ["echarts", "echarts-for-react"],
                    },
                },
            },
        },
    };
});
