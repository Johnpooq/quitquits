import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { createDatabase } from "./db/client";
import { loadEnv, readConfig } from "./env";
import { createFileStore } from "./files";
import { openAiCompatible } from "./ai/llm";
import { loadKnowledge } from "./ai/prompt";
import { createAiService } from "./ai/service";

loadEnv();
const config = readConfig();
const database = await createDatabase(config);
const app = createApp({
  database,
  files: createFileStore(database.db, config.storageDir),
  ai: createAiService({
    knowledge: loadKnowledge(config.knowledgeDir),
    chat: config.llm ? openAiCompatible(config.llm) : undefined,
  }),
});

const server = serve(
  { fetch: app.fetch, hostname: config.host, port: config.port },
  (info) =>
    console.log(
      `API 已启动 http://${info.address}:${info.port}/api · 数据库：${database.driver} · AI：${config.llm ? `模型 ${config.llm.model}` : "规则模板（未配置 LLM_API_KEY）"}`,
    ),
);

const shutdown = () =>
  server.close(() => void database.close().then(() => process.exit(0)));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
