import fs from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// public/_headers хранится в git с placeholder'ом __WORKER_ORIGIN__ (persona-specific
// субдомен Worker'а не коммитим — docs/security.md); при build подставляем origin из VITE_API_BASE.
function injectWorkerOriginHeaders(apiBase: string | undefined): Plugin {
    return {
        name: "inject-worker-origin-headers",
        apply: "build",
        closeBundle() {
            const file = path.resolve(__dirname, "dist/_headers");
            if (!fs.existsSync(file)) return;
            if (!apiBase) throw new Error("VITE_API_BASE не задан — нужен для CSP connect-src в dist/_headers (см. .env.example)");
            const origin = new URL(apiBase).origin;
            fs.writeFileSync(file, fs.readFileSync(file, "utf8").replaceAll("__WORKER_ORIGIN__", origin));
        },
    };
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), "");
    return {
        plugins: [react(), injectWorkerOriginHeaders(env.VITE_API_BASE)],
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
