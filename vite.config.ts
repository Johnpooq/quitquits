import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/** 前端只访问同源的 /api，由 Vite 代理到后端（开发与 preview 都一样） */
const proxy = {
  "/api": process.env.API_PROXY_TARGET || "http://127.0.0.1:8787",
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: "127.0.0.1", proxy },
  preview: { proxy },
  build: { outDir: "dist" },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "server/tests/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**", "dist/**"],
  },
});
