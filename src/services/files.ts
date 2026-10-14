import { apiFetch } from "./api";

export interface StoredFile {
  id: string;
  blob: Blob;
  name: string;
  type: string;
}
export function validateFile(file: File) {
  if (file.size > 20 * 1024 * 1024)
    throw new Error("文件超过 20 MB，请选择较小的文件。");
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (!["pdf", "png", "jpg", "jpeg", "txt"].includes(ext || ""))
    throw new Error("不支持此文件类型，请选择 PDF、PNG、JPG 或 TXT。");
  const types = [
    "application/pdf",
    "image/png",
    "image/jpeg",
    "text/plain",
    "",
  ];
  if (!types.includes(file.type)) throw new Error("文件类型与支持格式不符。");
}

const upload = async (blob: Blob, name: string, id: string) => {
  await apiFetch(`/files/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: blob,
    headers: {
      "Content-Type": blob.type || "application/octet-stream",
      "X-File-Name": encodeURIComponent(name),
    },
  });
  return id;
};

/**
 * 文件本体存在服务端本地磁盘，元数据在数据库里。
 * 语义与原来的 IndexedDB 版本一致：put / get / remove / clear。
 */
export const fileService = {
  async put(file: File, id = crypto.randomUUID()) {
    validateFile(file);
    return upload(file, file.name, id);
  },
  async get(id: string): Promise<StoredFile | undefined> {
    const res = await apiFetch(`/files/${encodeURIComponent(id)}`, {}, true, {
      allow: [404],
    });
    if (res.status === 404) return undefined;
    const blob = await res.blob();
    return {
      id,
      blob,
      name: decodeURIComponent(res.headers.get("X-File-Name") || id),
      type: blob.type,
    };
  },
  async remove(id: string) {
    await apiFetch(`/files/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  async clear() {
    await apiFetch("/files", { method: "DELETE" });
  },
};

/* ---------- 旧版本：文件存在浏览器 IndexedDB 里，首次启动时迁移到服务端 ---------- */

const LEGACY_DB = "workday-companion-files";

const openLegacy = (): Promise<IDBDatabase | null> =>
  new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    const r = indexedDB.open(LEGACY_DB, 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("files", { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => resolve(null);
  });

/** 把旧 IndexedDB 里的文件按原 id 上传到服务端，成功后删除本地文件库 */
export async function importLegacyFiles(): Promise<number> {
  const db = await openLegacy();
  if (!db) return 0;
  const records = await new Promise<StoredFile[]>((res, rej) => {
    const r = db.transaction("files").objectStore("files").getAll();
    r.onsuccess = () => res(r.result as StoredFile[]);
    r.onerror = () => rej(new Error("旧文件读取失败，请重试。"));
  }).finally(() => db.close());
  for (const file of records) await upload(file.blob, file.name, file.id);
  indexedDB.deleteDatabase(LEGACY_DB);
  return records.length;
}

export const downloadBlob = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
