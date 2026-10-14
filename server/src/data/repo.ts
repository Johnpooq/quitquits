import { eq } from "drizzle-orm";
import type { AppData } from "../../../src/types";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { fromRows, toRows } from "./mapper";

/** 按设备分组的表（settings 单独处理，保存写入序号） */
const TABLES = [
  t.profile,
  t.dailyEntry,
  t.chatMessage,
  t.event,
  t.material,
  t.materialSuggestion,
  t.emergencySession,
] as const;

/** 同一设备的写入串行执行，避免两次保存交错 */
const locks = new Map<string, Promise<unknown>>();
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  locks.set(key, next);
  try {
    return await next;
  } finally {
    if (locks.get(key) === next) locks.delete(key);
  }
}

/** PG 单条语句最多 65535 个参数，大数组分批插入 */
const CHUNK = 500;
async function insertAll(
  tx: Db,
  table: (typeof TABLES)[number],
  rows: object[],
) {
  for (let i = 0; i < rows.length; i += CHUNK)
    await tx.insert(table).values(rows.slice(i, i + CHUNK) as never);
}

export interface Snapshot {
  state: AppData | null;
  version: number;
  revision: number;
}

export async function loadData(db: Db, deviceId: string): Promise<Snapshot> {
  const [settings] = await db
    .select()
    .from(t.settings)
    .where(eq(t.settings.deviceId, deviceId));
  if (!settings) return { state: null, version: 3, revision: 0 };
  const where = <T extends (typeof TABLES)[number]>(table: T) =>
    db
      .select()
      .from(table as never)
      .where(eq(table.deviceId, deviceId));
  const [
    profile,
    entries,
    messages,
    events,
    materials,
    suggestions,
    emergencies,
  ] = await Promise.all(TABLES.map(where));
  return {
    state: fromRows({
      settings,
      profile: (profile as (typeof t.profile.$inferSelect)[])[0],
      entries: entries as never,
      messages: messages as never,
      events: events as never,
      materials: materials as never,
      suggestions: suggestions as never,
      emergencies: emergencies as never,
    }),
    version: settings.dataVersion,
    revision: settings.revision,
  };
}

/**
 * 整份替换：一个事务内删掉该设备的旧行，再写入新行。
 * 写入序号不比已保存的新就忽略（页面关闭前补发的旧请求不会覆盖新数据）。
 */
export async function saveData(
  db: Db,
  deviceId: string,
  input: { state: AppData; version: number; revision: number },
): Promise<{ applied: boolean; revision: number }> {
  const rows = toRows(deviceId, input.state, input);
  return withLock(deviceId, () =>
    db.transaction(async (tx) => {
      const [current] = await tx
        .select({ revision: t.settings.revision })
        .from(t.settings)
        .where(eq(t.settings.deviceId, deviceId));
      if (current && current.revision >= input.revision)
        return { applied: false, revision: current.revision };
      for (const table of TABLES)
        await tx.delete(table).where(eq(table.deviceId, deviceId));
      await tx
        .insert(t.settings)
        .values(rows.settings)
        .onConflictDoUpdate({
          target: t.settings.deviceId,
          set: rows.settings,
        });
      if (rows.profile) await tx.insert(t.profile).values(rows.profile);
      await insertAll(tx as unknown as Db, t.dailyEntry, rows.entries);
      await insertAll(tx as unknown as Db, t.chatMessage, rows.messages);
      await insertAll(tx as unknown as Db, t.event, rows.events);
      await insertAll(tx as unknown as Db, t.material, rows.materials);
      await insertAll(
        tx as unknown as Db,
        t.materialSuggestion,
        rows.suggestions,
      );
      await insertAll(
        tx as unknown as Db,
        t.emergencySession,
        rows.emergencies,
      );
      return { applied: true, revision: input.revision };
    }),
  );
}

/** 清空该设备的全部记录（保留设备本身，令牌继续可用） */
export async function clearData(db: Db, deviceId: string) {
  await withLock(deviceId, () =>
    db.transaction(async (tx) => {
      for (const table of [...TABLES, t.settings])
        await tx.delete(table).where(eq(table.deviceId, deviceId));
    }),
  );
}
