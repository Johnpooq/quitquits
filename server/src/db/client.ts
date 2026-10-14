import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export interface Database {
  db: Db;
  driver: "postgres" | "pglite";
  close: () => Promise<void>;
}

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);

/**
 * 同一份 Drizzle pg schema，两种运行方式：
 * - 设置了 DATABASE_URL → 连接 Postgres（本地用 docker-compose 起）；
 * - 没设置 → 用 PGlite（WASM 版 Postgres，同样的 SQL 与迁移），
 *   数据写在 pgliteDir；传 "memory://" 则只在内存里（测试用）。
 * 启动时自动执行 server/drizzle 下的迁移。
 */
export async function createDatabase(options: {
  databaseUrl?: string;
  pgliteDir?: string;
}): Promise<Database> {
  if (options.databaseUrl) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const pool = new Pool({ connectionString: options.databaseUrl });
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder });
    return {
      db: db as unknown as Db,
      driver: "postgres",
      close: () => pool.end(),
    };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dir = options.pgliteDir ?? "memory://";
  if (!dir.startsWith("memory://")) mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return {
    db: db as unknown as Db,
    driver: "pglite",
    close: () => client.close(),
  };
}
