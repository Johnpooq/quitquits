import { defineConfig } from "@playwright/test";

/**
 * e2e 用独立端口：后端 8788（内存 PGlite、规则模板、不读 server/.env），
 * 前端 preview 4174 并把 /api 代理到 8788，不会碰到本机开发用的数据库。
 */
const API_PORT = 8788;
const WEB_PORT = 4174;

export default defineConfig({
  testDir: "./tests/e2e",
  // 演示流程中多处有模拟 AI 的延迟，单条用例给足时间
  timeout: 180_000,
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    viewport: { width: 390, height: 844 },
  },
  webServer: [
    {
      command: "node node_modules/tsx/dist/cli.mjs server/src/index.ts",
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      env: {
        ENV_FILE: "none",
        LLM_API_KEY: "",
        DATABASE_URL: "",
        PORT: String(API_PORT),
        PGLITE_DIR: "memory://e2e",
        STORAGE_DIR: ".e2e/storage",
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      env: { API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
