import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
    plugins: [react()],
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
});
