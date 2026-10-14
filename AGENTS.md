# AGENTS.md

## 常用命令

- `npm run dev`：同时启动后端（:8787）与前端（:5173，`/api` 代理到后端）
- `npm run build`：类型检查（`src` + `server` + tests）+ Vite 构建
- `npm test`：Vitest，包含 `tests/**/*.test.ts` 与 `server/tests/**/*.test.ts`（内存 PGlite，不需要 Docker）
- `npm run test:e2e`：需先 `npm run build`；Playwright 自动启动后端（:8788，内存 PGlite，`ENV_FILE=none` 走规则模板）和 preview（:4174）
- `npm run db:generate`：改了 `server/src/db/schema.ts` 后生成迁移到 `server/drizzle/`
- `npm run knowledge`：从 `docs/source/*.docx` 重新生成 `knowledge/*.md`（需要 pandoc）

## 约定

- 分流、转介、危机提示由 `src/services/triage.ts` 与 `src/services/ai.ts` 的规则层决定（前后端共用）；模型只负责措辞，输出经 `server/src/ai/guard.ts` 兜底。
- 修改 few-shot（`knowledge/fewshot/*.json`）时，`tests/knowledge.test.ts` 会校验它和规则层的输出一致。
- `knowledge/*.md` 只做格式清理，不改写原文；不要在回复模板或示例里新增知识库之外的案号或法条。
- 模型 Key 只放 `server/.env`，前端不得出现。
- 新增依赖使用发布超过 7 天的版本并锁定精确版本（`@playwright/test` 1.63.0 对应本机已缓存的 chromium 1243）。
