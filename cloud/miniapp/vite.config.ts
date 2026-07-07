import fs from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// SEC-10 (волна 2 аудита): public/_headers хранится с placeholder'ом __WORKER_ORIGIN__
// (persona-субдомен не коммитим — docs/security.md); при build подставляем origin из
// VITE_API_BASE. Тот же паттерн, что в cloud/admin/vite.config.ts.
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
        server: { port: 5175, host: true },
        build: {
            target: "es2022",
            sourcemap: true,
            rollupOptions: {
                output: {
                    manualChunks: {
                        react: ["react", "react-dom"],
                        tanstack: ["@tanstack/react-query"],
                    },
                },
            },
        },
    };
});
