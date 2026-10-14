import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { LlmConfig } from "./ai/llm";

const serverDir = fileURLToPath(new URL("..", import.meta.url));
const repoDir = resolve(serverDir, "..");

/**
 * 读取 server/.env（如果有）。环境变量里已有的值优先。
 * ENV_FILE=none 时不读文件（e2e 用它确保走规则模板、不花模型额度）。
 */
export function loadEnv() {
  if (process.env.ENV_FILE === "none") return;
  const file = resolve(serverDir, process.env.ENV_FILE ?? ".env");
  if (existsSync(file)) process.loadEnvFile(file);
}

const fromRepo = (p: string) =>
  p.startsWith("memory://") ? p : resolve(repoDir, p);

export function readConfig(env = process.env) {
  const apiKey = env.LLM_API_KEY?.trim();
  let llm: LlmConfig | undefined;
  if (apiKey) {
    const model = env.LLM_MODEL?.trim();
    if (!model) throw new Error("设置了 LLM_API_KEY 但没有设置 LLM_MODEL");
    llm = {
      apiKey,
      model,
      baseUrl: env.LLM_BASE_URL?.trim() || "https://api.openai.com/v1",
      timeoutMs: Number(env.LLM_TIMEOUT_MS) || 20000,
    };
  }
  return {
    host: env.HOST || "127.0.0.1",
    port: Number(env.PORT) || 8787,
    databaseUrl: env.DATABASE_URL?.trim() || undefined,
    pgliteDir: fromRepo(env.PGLITE_DIR || "server/data/pglite"),
    storageDir: fromRepo(env.STORAGE_DIR || "server/storage"),
    knowledgeDir: resolve(repoDir, "knowledge"),
    llm,
  };
}
