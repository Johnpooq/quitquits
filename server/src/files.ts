import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import type { Db } from "./db/client";
import { storedFile } from "./db/schema";

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
const EXTENSIONS = ["pdf", "png", "jpg", "jpeg", "txt"];
const TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "text/plain",
  "application/octet-stream",
];
/** 文件 id 由前端生成（UUID），只允许安全字符，防止路径穿越 */
export const FILE_ID = /^[A-Za-z0-9_-]{1,80}$/;

export class FileRejected extends Error {}

export function validateUpload(name: string, type: string, size: number) {
  if (size > MAX_FILE_BYTES)
    throw new FileRejected("文件超过 20 MB，请选择较小的文件。");
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (!EXTENSIONS.includes(ext))
    throw new FileRejected("不支持此文件类型，请选择 PDF、PNG、JPG 或 TXT。");
  if (!TYPES.includes(type.split(";")[0].trim()))
    throw new FileRejected("文件类型与支持格式不符。");
}

/**
 * 本地磁盘文件存储：本体在 <root>/<deviceId>/<fileId>，元数据在 stored_file 表。
 * 接口保持 put / get / remove / clear 语义；以后换对象存储只需替换这个模块。
 */
export function createFileStore(db: Db, root: string) {
  const dir = (deviceId: string) => join(root, deviceId);
  const path = (deviceId: string, id: string) => join(dir(deviceId), id);
  const where = (deviceId: string, id: string) =>
    and(eq(storedFile.deviceId, deviceId), eq(storedFile.id, id));

  return {
    async put(
      deviceId: string,
      id: string,
      file: { name: string; type: string; body: Uint8Array },
    ) {
      validateUpload(file.name, file.type, file.body.byteLength);
      await mkdir(dir(deviceId), { recursive: true });
      await writeFile(path(deviceId, id), file.body);
      const row = {
        deviceId,
        id,
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.body.byteLength,
      };
      await db
        .insert(storedFile)
        .values(row)
        .onConflictDoUpdate({
          target: [storedFile.deviceId, storedFile.id],
          set: row,
        });
    },
    async get(deviceId: string, id: string) {
      const [meta] = await db
        .select()
        .from(storedFile)
        .where(where(deviceId, id));
      if (!meta) return undefined;
      try {
        return { meta, body: await readFile(path(deviceId, id)) };
      } catch {
        return undefined;
      }
    },
    async remove(deviceId: string, id: string) {
      await db.delete(storedFile).where(where(deviceId, id));
      await rm(path(deviceId, id), { force: true });
    },
    async clear(deviceId: string) {
      await db.delete(storedFile).where(eq(storedFile.deviceId, deviceId));
      await rm(dir(deviceId), { recursive: true, force: true });
    },
  };
}
export type FileStore = ReturnType<typeof createFileStore>;
