import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import type { Db } from "./db/client";
import { device } from "./db/schema";

/**
 * 匿名设备令牌：没有账号、登录或密码。
 * 服务端只保存令牌的 SHA-256；令牌本身只在创建时返回一次，由浏览器保存。
 */
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export async function createDevice(db: Db) {
  const token = randomBytes(32).toString("base64url");
  const id = randomUUID();
  await db.insert(device).values({ id, tokenHash: hash(token) });
  return { id, token };
}

export type AuthEnv = { Variables: { deviceId: string } };

export function requireDevice(db: Db): MiddlewareHandler<AuthEnv> {
  const cache = new Map<string, string>();
  return async (c, next) => {
    const token = c.req.header("Authorization")?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return c.json({ error: "缺少设备标识。" }, 401);
    const key = hash(token);
    let id = cache.get(key);
    if (!id) {
      const [row] = await db
        .select({ id: device.id })
        .from(device)
        .where(eq(device.tokenHash, key));
      if (!row) return c.json({ error: "设备标识无效，请刷新页面。" }, 401);
      id = row.id;
      cache.set(key, id);
    }
    c.set("deviceId", id);
    await next();
  };
}
