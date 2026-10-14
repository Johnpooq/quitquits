import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, fixture } from "./helpers";
import { readConfig } from "../src/env";

let t: Awaited<ReturnType<typeof createTestApp>>;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

const put = (token: string, state: unknown, revision: number) =>
  t.call(token, "/data", {
    method: "PUT",
    body: JSON.stringify({ revision, version: 3, state }),
  });

describe("健康检查与匿名设备", () => {
  it("未配置模型时报告规则模式与 PGlite", async () => {
    const res = await t.app.request("/api/health");
    expect(await res.json()).toEqual({ ok: true, db: "pglite", ai: "rules" });
  });

  it("没有或伪造设备令牌一律 401", async () => {
    expect((await t.app.request("/api/data")).status).toBe(401);
    expect((await t.call("not-a-real-token", "/data")).status).toBe(401);
  });

  it("新设备还没有数据时 state 为 null", async () => {
    const token = await t.register();
    const res = await t.call(token, "/data");
    expect(await res.json()).toEqual({ state: null, version: 3, revision: 0 });
  });
});

describe("AppData 读写", () => {
  it("整份写入后原样读回：字段、可选值、数组顺序都保留", async () => {
    const token = await t.register();
    const data = fixture();
    const res = await put(token, data, 100);
    expect(await res.json()).toEqual({ applied: true, revision: 100 });
    const back = (await (await t.call(token, "/data")).json()) as {
      state: unknown;
      revision: number;
    };
    expect(back.revision).toBe(100);
    expect(back.state).toEqual(data);
  });

  it("草稿文字、eventId 为空的留痕建议都入库", async () => {
    const token = await t.register();
    await put(token, fixture(), 1);
    const { state } = (await (await t.call(token, "/data")).json()) as {
      state: ReturnType<typeof fixture>;
    };
    expect(state.entries[0].draftText).toBe("还没发出去的半句");
    expect(state.suggestions[0].eventId).toBeUndefined();
    expect(state.suggestions[0].entryId).toBe("d2");
  });

  it("比已保存旧的写入被忽略，不会覆盖新数据", async () => {
    const token = await t.register();
    await put(token, fixture(), 200);
    const stale = { ...fixture(), entries: [], messages: [] };
    const res = await put(token, stale, 150);
    expect(await res.json()).toEqual({ applied: false, revision: 200 });
    const { state } = (await (await t.call(token, "/data")).json()) as {
      state: ReturnType<typeof fixture>;
    };
    expect(state.entries).toHaveLength(2);
  });

  it("后一次写入整份替换：删掉的行不会残留", async () => {
    const token = await t.register();
    await put(token, fixture(), 1);
    const next = { ...fixture(), events: [], profile: null };
    await put(token, next, 2);
    const { state } = (await (await t.call(token, "/data")).json()) as {
      state: ReturnType<typeof fixture>;
    };
    expect(state.events).toEqual([]);
    expect(state.profile).toBeNull();
  });

  it("不同设备的数据互不可见", async () => {
    const a = await t.register();
    const b = await t.register();
    await put(a, fixture(), 1);
    const res = await t.call(b, "/data");
    expect(((await res.json()) as { state: unknown }).state).toBeNull();
  });

  it("不合法的数据返回 400，且不写入", async () => {
    const token = await t.register();
    const bad = {
      ...fixture(),
      entries: [{ ...fixture().entries[0], date: "昨天" }],
    };
    const res = await put(token, bad, 1);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("日期");
    expect(
      ((await (await t.call(token, "/data")).json()) as { state: unknown })
        .state,
    ).toBeNull();
    expect((await put(token, fixture(), -1)).status).toBe(400);
  });

  it("清空数据：记录与文件都删除，设备令牌仍可用", async () => {
    const token = await t.register();
    await put(token, fixture(), 1);
    await t.call(token, "/files/f1", {
      method: "PUT",
      body: new Uint8Array([1, 2, 3, 4]),
      headers: { "Content-Type": "image/png", "X-File-Name": "a.png" },
    });
    expect((await t.call(token, "/data", { method: "DELETE" })).status).toBe(
      204,
    );
    const res = await t.call(token, "/data");
    expect(((await res.json()) as { state: unknown }).state).toBeNull();
    expect((await t.call(token, "/files/f1")).status).toBe(404);
  });
});

describe("文件：put / get / remove / clear", () => {
  const upload = (
    token: string,
    id: string,
    name: string,
    type: string,
    body: BodyInit,
  ) =>
    t.call(token, `/files/${id}`, {
      method: "PUT",
      body,
      headers: {
        "Content-Type": type,
        "X-File-Name": encodeURIComponent(name),
      },
    });

  it("上传后能原样下载，文件名与类型保留", async () => {
    const token = await t.register();
    const text = "虚构演示材料，非真实工资凭证。";
    expect(
      (await upload(token, "f-1", "7-9月工资.txt", "text/plain", text)).status,
    ).toBe(201);
    const res = await t.call(token, "/files/f-1");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/plain");
    expect(decodeURIComponent(res.headers.get("X-File-Name")!)).toBe(
      "7-9月工资.txt",
    );
    expect(await res.text()).toBe(text);
  });

  it("删除单个文件与清空全部文件", async () => {
    const token = await t.register();
    await upload(token, "a", "a.txt", "text/plain", "a");
    await upload(token, "b", "b.txt", "text/plain", "b");
    await t.call(token, "/files/a", { method: "DELETE" });
    expect((await t.call(token, "/files/a")).status).toBe(404);
    expect((await t.call(token, "/files/b")).status).toBe(200);
    await t.call(token, "/files", { method: "DELETE" });
    expect((await t.call(token, "/files/b")).status).toBe(404);
  });

  it("别的设备拿不到我的文件", async () => {
    const a = await t.register();
    const b = await t.register();
    await upload(a, "secret", "a.txt", "text/plain", "a");
    expect((await t.call(b, "/files/secret")).status).toBe(404);
  });

  it("拒绝不支持的类型与不安全的文件 id", async () => {
    const token = await t.register();
    expect(
      (await upload(token, "x", "run.exe", "application/octet-stream", "x"))
        .status,
    ).toBe(400);
    expect((await upload(token, "x", "a.pdf", "text/html", "x")).status).toBe(
      400,
    );
    expect(
      (await upload(token, "..%2F..%2Fetc", "a.txt", "text/plain", "x")).status,
    ).toBe(400);
  });
});

describe("API Key 只在服务端", () => {
  it("读取 LLM 配置，但健康检查不泄露", async () => {
    const config = readConfig({ LLM_API_KEY: "sk-test", LLM_MODEL: "m" });
    expect(config.llm?.apiKey).toBe("sk-test");
    const body = await (await t.app.request("/api/health")).text();
    expect(body).not.toContain("sk-");
    expect(() => readConfig({ LLM_API_KEY: "sk-test" })).toThrow(/LLM_MODEL/);
  });

  it("前端源码里没有任何模型 Key 或模型接口地址", () => {
    const src = fileURLToPath(new URL("../../src", import.meta.url));
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? walk(p) : [p];
      });
    for (const file of walk(src)) {
      const code = readFileSync(file, "utf8");
      expect(code, file).not.toMatch(
        /LLM_API_KEY|VITE_[A-Z_]*KEY|chat\/completions|\bsk-[A-Za-z0-9]{16,}/,
      );
    }
  });
});
