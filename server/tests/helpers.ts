import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/app";
import { createDatabase } from "../src/db/client";
import { createFileStore } from "../src/files";
import type { ChatFn } from "../src/ai/llm";
import { loadKnowledge } from "../src/ai/prompt";
import { createAiService } from "../src/ai/service";
import type { AppData } from "../../src/types";

export const knowledgeDir = fileURLToPath(
  new URL("../../knowledge", import.meta.url),
);

/** 内存 PGlite + 临时文件目录，跑完即删 */
export async function createTestApp(chat?: ChatFn) {
  const database = await createDatabase({ pgliteDir: "memory://" });
  const storage = mkdtempSync(join(tmpdir(), "quitquit-files-"));
  const logs: string[] = [];
  const app = createApp({
    database,
    files: createFileStore(database.db, storage),
    ai: createAiService({
      knowledge: loadKnowledge(knowledgeDir),
      chat,
      log: (m) => logs.push(m),
    }),
  });
  const register = async () => {
    const res = await app.request("/api/device", { method: "POST" });
    const { token } = (await res.json()) as { token: string };
    return token;
  };
  const call = (token: string, path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    if (typeof init.body === "string" && !headers.has("Content-Type"))
      headers.set("Content-Type", "application/json");
    return app.request(`/api${path}`, { ...init, headers });
  };
  return {
    app,
    logs,
    register,
    call,
    close: async () => {
      await database.close();
      rmSync(storage, { recursive: true, force: true });
    },
  };
}

const T1 = "2026-10-10T08:00:00.000Z";
const T2 = "2026-10-12T09:30:15.123Z";

/** 覆盖每张表、可选字段与 eventId 为空的留痕建议 */
export const fixture = (): AppData => ({
  profile: {
    id: "p1",
    employmentStatus: "在职",
    company: "青禾设计工作室（虚构）",
    city: "杭州",
  },
  onboarded: true,
  isDemo: true,
  notificationEnabled: true,
  mockConfig: { delayMs: 0, failNext: false },
  entries: [
    {
      id: "d2",
      date: "2026-10-12",
      mood: "tired",
      content: "今天被移出项目群了",
      draftText: "还没发出去的半句",
      tags: ["项目变化"],
      conversationId: "conv-2026-10-12",
      eventIds: ["e1"],
      suggestionIds: ["s1", "s2"],
      aiSummary: "模拟 AI：今天的你感到疲惫。",
      createdAt: T1,
      updatedAt: T2,
    },
    {
      id: "d1",
      date: "2026-10-10",
      content: "",
      tags: [],
      conversationId: "conv-2026-10-10",
      eventIds: [],
      suggestionIds: [],
      createdAt: T1,
      updatedAt: T1,
    },
  ],
  events: [
    {
      id: "e1",
      title: "项目群成员变化",
      occurredAt: "2026-10-12",
      people: ["主管"],
      description: "今天被移出项目群了",
      status: "confirmed",
      attention: "watch",
      sourceType: "chat",
      sourceId: "d2",
      materialIds: ["m1"],
      updates: [{ id: "u1", content: "又被移出一个群", createdAt: T2 }],
      confirmedAt: T2,
      createdAt: T1,
      updatedAt: T2,
    },
  ],
  materials: [
    {
      id: "m1",
      name: "群聊截图",
      type: "project",
      status: "uploaded",
      isCurrent: true,
      eventIds: ["e1"],
      fileId: "f1",
      fileName: "截图.png",
      mimeType: "image/png",
      fileSize: 4,
      extractionStatus: "draft",
      extractionDraft: "模拟提取结果",
      coverageStart: "2026-10-01",
      coverageEnd: "2026-10-31",
      createdAt: T1,
      updatedAt: T2,
    },
  ],
  suggestions: [
    {
      id: "s1",
      entryId: "d2",
      type: "hr",
      title: "主管沟通记录",
      reason: "建议保留原始记录",
      status: "pending",
      priority: true,
      createdAt: T1,
    },
    {
      id: "s2",
      eventId: "e1",
      entryId: "d2",
      type: "project",
      title: "群聊变化记录",
      reason: "截图留存",
      status: "completed",
      resolvedMaterialId: "m1",
      createdAt: T2,
    },
  ],
  emergencies: [
    {
      id: "x1",
      category: "sign",
      answers: { today: "是" },
      factsDraft: "事项：被要求签文件",
      priority: "urgent",
      priorityReasons: ["要求今天签"],
      date: "2026-10-12",
      createdAt: T2,
    },
  ],
  messages: [
    {
      id: "msg-b",
      conversationId: "conv-2026-10-12",
      dailyEntryId: "d2",
      role: "user",
      content: "今天被移出项目群了",
      status: "sent",
      createdAt: T2,
    },
    {
      id: "msg-a",
      conversationId: "conv-2026-10-12",
      dailyEntryId: "d2",
      role: "assistant",
      content: "听起来是个值得留意的变化。",
      candidateEventIds: ["e1"],
      suggestionIds: ["s1"],
      emergency: false,
      clarify: {
        title: "会议安排变化",
        occurredAt: "2026-10-12",
        people: [],
        description: "前几天取消了会议",
        attention: "watch",
        sourceType: "chat",
        sourceId: "d2",
      },
      status: "sent",
      createdAt: T2,
    },
  ],
});
