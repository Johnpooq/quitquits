import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import type { AssistantContext } from "../../src/services/ai";
import type { AppData, DailyStatusInput } from "../../src/types";
import { createDevice, requireDevice, type AuthEnv } from "./auth";
import type { Database } from "./db/client";
import { InvalidDataError } from "./data/mapper";
import { clearData, loadData, saveData } from "./data/repo";
import { FILE_ID, FileRejected, MAX_FILE_BYTES, type FileStore } from "./files";
import type { AiService } from "./ai/service";

const bad = (message: string) => new HTTPException(400, { message });

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function parseContext(raw: unknown): AssistantContext {
  if (!isObject(raw)) throw bad("ctx 必须是对象");
  const { date, entryId, userText, confirmedEvents, draftTitles, materials } =
    raw;
  if (typeof date !== "string" || typeof entryId !== "string")
    throw bad("ctx.date / ctx.entryId 必须是字符串");
  return {
    date,
    entryId,
    userText: typeof userText === "string" ? userText.slice(-20000) : "",
    confirmedEvents: Array.isArray(confirmedEvents) ? confirmedEvents : [],
    draftTitles: Array.isArray(draftTitles)
      ? draftTitles.filter((x) => typeof x === "string")
      : [],
    materials: Array.isArray(materials) ? materials : [],
  } as AssistantContext;
}

export function createApp(deps: {
  database: Database;
  files: FileStore;
  ai: AiService;
}) {
  const { database, files, ai } = deps;
  const { db } = database;
  const app = new Hono<AuthEnv>().basePath("/api");

  app.onError((err, c) => {
    if (err instanceof HTTPException)
      return c.json({ error: err.message }, err.status);
    if (err instanceof InvalidDataError || err instanceof FileRejected)
      return c.json({ error: err.message }, 400);
    console.error(err);
    return c.json({ error: "服务暂时出错了，请重试。" }, 500);
  });

  app.get("/health", (c) =>
    c.json({ ok: true, db: database.driver, ai: ai.mode }),
  );

  /** 匿名设备：不需要账号，返回的令牌由浏览器保存 */
  app.post("/device", async (c) => {
    const { token } = await createDevice(db);
    return c.json({ token }, 201);
  });

  const authed = new Hono<AuthEnv>();
  authed.use("*", requireDevice(db));

  /* ---------- 数据：AppData 即传输结构 ---------- */
  authed.get("/data", async (c) => c.json(await loadData(db, c.var.deviceId)));

  authed.put("/data", bodyLimit({ maxSize: 10 * 1024 * 1024 }), async (c) => {
    const body = await c.req.json().catch(() => {
      throw bad("请求体不是合法 JSON");
    });
    if (!isObject(body) || !isObject(body.state)) throw bad("缺少 state");
    const revision = Number(body.revision);
    const version = Number(body.version ?? 3);
    if (!Number.isSafeInteger(revision) || revision <= 0)
      throw bad("revision 必须是正整数");
    const result = await saveData(db, c.var.deviceId, {
      state: body.state as unknown as AppData,
      revision,
      version,
    });
    return c.json(result);
  });

  authed.delete("/data", async (c) => {
    await files.clear(c.var.deviceId);
    await clearData(db, c.var.deviceId);
    return c.body(null, 204);
  });

  /* ---------- 文件：本体在本地磁盘，元数据在数据库 ---------- */
  const fileId = (id: string) => {
    if (!FILE_ID.test(id)) throw bad("文件 id 不合法");
    return id;
  };

  authed.put(
    "/files/:id",
    bodyLimit({
      maxSize: MAX_FILE_BYTES,
      onError: (c) =>
        c.json({ error: "文件超过 20 MB，请选择较小的文件。" }, 413),
    }),
    async (c) => {
      const id = fileId(c.req.param("id"));
      const name = decodeURIComponent(c.req.header("X-File-Name") ?? "");
      if (!name) throw bad("缺少文件名");
      const body = new Uint8Array(await c.req.arrayBuffer());
      await files.put(c.var.deviceId, id, {
        name,
        type: c.req.header("Content-Type") ?? "",
        body,
      });
      return c.json({ id }, 201);
    },
  );

  authed.get("/files/:id", async (c) => {
    const found = await files.get(c.var.deviceId, fileId(c.req.param("id")));
    if (!found) return c.json({ error: "文件不存在或已被删除。" }, 404);
    return c.body(new Uint8Array(found.body), 200, {
      "Content-Type": found.meta.mimeType,
      "Content-Length": String(found.meta.size),
      "X-File-Name": encodeURIComponent(found.meta.name),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    });
  });

  authed.delete("/files/:id", async (c) => {
    await files.remove(c.var.deviceId, fileId(c.req.param("id")));
    return c.body(null, 204);
  });

  authed.delete("/files", async (c) => {
    await files.clear(c.var.deviceId);
    return c.body(null, 204);
  });

  /* ---------- AI：签名与前端 aiService 对应 ---------- */
  authed.post(
    "/ai/reply",
    bodyLimit({ maxSize: 2 * 1024 * 1024 }),
    async (c) => {
      const body = await c.req.json().catch(() => null);
      if (!isObject(body) || typeof body.text !== "string" || !body.text.trim())
        throw bad("缺少 text");
      if (body.text.length > 5000)
        throw bad("一次说的内容太长了，分几次发吧。");
      return c.json(await ai.reply(body.text, parseContext(body.ctx)));
    },
  );

  authed.post("/ai/summarize", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!isObject(body)) throw bad("请求体不合法");
    const status = (
      isObject(body.status) ? body.status : {}
    ) as Partial<DailyStatusInput>;
    const userText = typeof body.userText === "string" ? body.userText : "";
    return c.json({ summary: await ai.summarize(status, userText) });
  });

  authed.post("/ai/extract", bodyLimit({ maxSize: 1024 * 1024 }), async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!isObject(body) || typeof body.name !== "string")
      throw bad("缺少文件名");
    const text = typeof body.text === "string" ? body.text : undefined;
    return c.json({ text: await ai.extract({ name: body.name, text }) });
  });

  app.route("/", authed);
  return app;
}
