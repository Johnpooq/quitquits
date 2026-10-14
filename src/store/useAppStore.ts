import { create } from "zustand";
import {
  persist,
  type PersistStorage,
  type StorageValue,
} from "zustand/middleware";
import type {
  AppData,
  WorkProfile,
  DailyStatusInput,
  WorkEvent,
  EventInput,
  MaterialInput,
  EmergencySession,
  ChatMessage,
  ChatMessageInput,
  MaterialSuggestion,
  MessageStatus,
} from "../types";
import { uid, now } from "../constants";
import { emptyData, createDemo } from "../services/demo";
import { migrateData } from "../services/migrate";
import { fileService, importLegacyFiles } from "../services/files";
import { ApiError, apiFetch, apiJSON } from "../services/api";
import {
  createSuggestions,
  reconcileSuggestions,
  requirementsForEvent,
  type MaterialRequirement,
} from "../services/materials";

/** 旧版本 localStorage 的键名：现在只用于首次启动时导入旧数据 */
export const STORAGE_KEY = "workday-companion-v1";
/**
 * 数据模型版本：
 * - 2 起为「每日记录 = 状态 + 日记 + 对话 + 结构化整理」
 * - 3 起心情为唯一主入口、新增未发送草稿、留痕建议可脱离事件存在
 */
const STORAGE_VERSION = 3;

export interface AppStore extends AppData {
  finishOnboarding: (profile: WorkProfile) => void;
  saveProfile: (profile: WorkProfile) => void;

  /** 取得某天的每日记录 id，不存在则创建一条空记录 */
  ensureEntry: (date: string) => string;
  /** 保存当天状态（心情必填），与对话分开 */
  setStatus: (input: DailyStatusInput) => string;
  /** 保存输入框里还没发送的文字，刷新后可以恢复 */
  setDraftText: (entryId: string, draftText: string) => void;
  /** 写入 AI 今日总结（与用户原文分开保存） */
  setSummary: (entryId: string, summary: string) => void;

  /** 追加一条对话消息；用户消息会同时累积进当天日记原文 */
  appendMessage: (input: ChatMessageInput) => string;
  setMessageStatus: (id: string, status: MessageStatus) => void;
  removeMessage: (id: string) => void;

  addDraft: (input: EventInput) => string;
  confirmEvent: (id: string) => void;
  updateEvent: (id: string, patch: Partial<WorkEvent>) => void;
  dismissEvent: (id: string) => void;
  deleteEvent: (id: string) => void;
  addUpdate: (id: string, content: string) => void;
  createManualEvent: (input: EventInput) => string;

  saveMaterial: (input: MaterialInput, suggestionId?: string) => string;
  suggest: (requirements: MaterialRequirement[], entryId?: string) => string[];
  setSuggestionStatus: (
    id: string,
    status: MaterialSuggestion["status"],
  ) => void;

  saveEmergency: (session: EmergencySession) => void;
  updateEmergency: (id: string, patch: Partial<EmergencySession>) => void;
  confirmEmergency: (id: string) => string;

  setNotification: (enabled: boolean) => void;
  setMockConfig: (patch: Partial<AppData["mockConfig"]>) => void;
  consumeMockConfig: () => AppData["mockConfig"];
  loadDemo: (replace?: boolean) => Promise<void>;
  clearData: () => Promise<void>;
}

/* ---------------- 数据读写：后端数据库（经由 /api/data） ---------------- */

const DATA_KEYS: (keyof AppData)[] = [
  "profile",
  "onboarded",
  "isDemo",
  "entries",
  "events",
  "materials",
  "suggestions",
  "emergencies",
  "messages",
  "notificationEnabled",
  "mockConfig",
];
const pickData = (state: Partial<AppData>) =>
  Object.fromEntries(
    DATA_KEYS.filter((k) => k in state).map((k) => [k, state[k]]),
  ) as unknown as AppData;

/**
 * 写入的「发件箱」：每次修改先同步写进 sessionStorage，服务端确认后再删掉。
 * 刷新或跳转时，未送达的最后一次修改会在下次启动时先补发，再从数据库读取。
 * 这里只暂存尚未确认的那一份，数据的正式来源始终是数据库。
 */
const OUTBOX_KEY = "workday-companion-outbox";
const WRITE_DELAY_MS = 150;
let ready = false;
let hydrationError: Error | null = null;
let revision = 0;
let latest: string | null = null;
let sending = false;
let timer: ReturnType<typeof setTimeout> | undefined;

const nextRevision = () => (revision = Math.max(Date.now(), revision + 1));

const putData = (body: string) =>
  apiFetch("/data", {
    method: "PUT",
    body,
    headers: { "Content-Type": "application/json" },
    // 页面关闭时请求也能送达；超过浏览器 keepalive 上限时退回普通请求
    keepalive: body.length < 60_000,
  });

const outbox = {
  get: () => sessionStorage.getItem(OUTBOX_KEY),
  set: (body: string) => {
    try {
      sessionStorage.setItem(OUTBOX_KEY, body);
    } catch {
      /* 会话存储写满时只依赖网络请求 */
    }
  },
  clearIf: (body: string) => {
    if (sessionStorage.getItem(OUTBOX_KEY) === body)
      sessionStorage.removeItem(OUTBOX_KEY);
  },
};

let lastError: unknown = null;

async function drain() {
  if (sending || !latest) return;
  sending = true;
  const body = latest;
  latest = null;
  let failed = false;
  try {
    await putData(body);
    outbox.clearIf(body);
    lastError = null;
  } catch (e) {
    // 客户端错误（数据不合法等）重试也没用；网络或服务端错误稍后重试
    const status = e instanceof ApiError ? e.status : 0;
    if (status >= 400 && status < 500) outbox.clearIf(body);
    else latest ??= body;
    lastError = e;
    failed = true;
    console.error("数据保存失败", e);
  } finally {
    sending = false;
    if (latest) {
      clearTimeout(timer);
      timer = setTimeout(drain, failed ? 3000 : WRITE_DELAY_MS);
    }
  }
}

/** 等待所有修改写入数据库（清空、重置等操作完成前调用）；写入失败时抛错 */
export async function flushData() {
  while (latest || sending) {
    if (sending) {
      await new Promise((r) => setTimeout(r, 20));
      continue;
    }
    clearTimeout(timer);
    const body = latest;
    await drain();
    if (lastError && latest === body) throw lastError;
  }
}

/** 旧版本把数据存在 localStorage：数据库里还没有数据时自动导入一次 */
async function importLegacy(): Promise<StorageValue<AppData> | null> {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  let parsed: { state?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const state = pickData(migrateData(parsed.state));
  await importLegacyFiles();
  await putData(
    JSON.stringify({
      revision: nextRevision(),
      version: STORAGE_VERSION,
      state,
    }),
  );
  localStorage.removeItem(STORAGE_KEY);
  return { state, version: STORAGE_VERSION };
}

const apiStorage: PersistStorage<AppData> = {
  getItem: async () => {
    try {
      const pending = outbox.get();
      if (pending) {
        await putData(pending).catch((e) => {
          if (!(e instanceof ApiError) || e.status === 0 || e.status >= 500)
            throw e;
        });
        outbox.clearIf(pending);
      }
      const remote = await apiJSON<{
        state: AppData | null;
        version: number;
        revision: number;
      }>("/data");
      revision = Math.max(revision, remote.revision);
      const value = remote.state
        ? { state: remote.state, version: remote.version }
        : await importLegacy();
      ready = true;
      hydrationError = null;
      return value;
    } catch (e) {
      hydrationError = e as Error;
      throw e;
    }
  },
  setItem: (_name, value) => {
    // 还没从数据库读到数据之前，不能用空状态覆盖服务端
    if (!ready) return;
    const body = JSON.stringify({
      revision: nextRevision(),
      version: value.version ?? STORAGE_VERSION,
      state: pickData(value.state),
    });
    latest = body;
    outbox.set(body);
    clearTimeout(timer);
    timer = setTimeout(drain, WRITE_DELAY_MS);
  },
  removeItem: () => {},
};

if (typeof window !== "undefined")
  window.addEventListener("pagehide", () => {
    if (latest) void putData(latest).catch(() => {});
  });

/** 启动时从数据库载入数据；失败时抛错，由入口展示重试界面 */
export async function hydrateStore() {
  await useAppStore.persist.rehydrate();
  if (!ready)
    throw hydrationError ?? new Error("数据载入失败，请刷新页面重试。");
}

export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => ({
      ...emptyData(),

      finishOnboarding: (profile) => set({ profile, onboarded: true }),
      saveProfile: (profile) => set({ profile }),

      ensureEntry: (date) => {
        const existing = get().entries.find((e) => e.date === date);
        if (existing) return existing.id;
        const id = uid();
        const stamp = now();
        set((s) => ({
          entries: [
            ...s.entries,
            {
              id,
              date,
              content: "",
              tags: [],
              conversationId: `conv-${date}`,
              eventIds: [],
              suggestionIds: [],
              createdAt: stamp,
              updatedAt: stamp,
            },
          ],
        }));
        return id;
      },

      setStatus: (input) => {
        const id = get().ensureEntry(input.date);
        const stamp = now();
        set((s) => ({
          entries: s.entries.map((e) =>
            e.id === id
              ? {
                  ...e,
                  mood: input.mood,
                  updatedAt: stamp,
                }
              : e,
          ),
        }));
        return id;
      },

      setDraftText: (entryId, draftText) =>
        set((s) => ({
          entries: s.entries.map((e) =>
            e.id === entryId ? { ...e, draftText, updatedAt: now() } : e,
          ),
        })),

      setSummary: (entryId, summary) =>
        set((s) => ({
          entries: s.entries.map((e) =>
            e.id === entryId
              ? { ...e, aiSummary: summary, updatedAt: now() }
              : e,
          ),
        })),

      appendMessage: (input) => {
        const id = uid();
        const stamp = now();
        set((s) => ({
          messages: [
            ...s.messages,
            {
              ...input,
              id,
              status: input.status ?? ("sent" as MessageStatus),
              createdAt: stamp,
            },
          ],
          entries:
            input.role === "user"
              ? s.entries.map((e) =>
                  e.id === input.dailyEntryId
                    ? {
                        ...e,
                        content: e.content
                          ? `${e.content}\n${input.content}`
                          : input.content,
                        updatedAt: stamp,
                      }
                    : e,
                )
              : s.entries,
        }));
        return id;
      },

      setMessageStatus: (id, status) =>
        set((s) => ({
          messages: s.messages.map((m) => (m.id === id ? { ...m, status } : m)),
        })),

      removeMessage: (id) =>
        set((s) => ({ messages: s.messages.filter((m) => m.id !== id) })),

      addDraft: (input) => {
        const existing = get().events.find(
          (e) =>
            e.sourceType === input.sourceType &&
            e.sourceId === input.sourceId &&
            e.title === input.title,
        );
        if (existing) return existing.id;
        const id = uid();
        const stamp = now();
        set((s) => ({
          events: [
            ...s.events,
            {
              ...input,
              id,
              status: "draft",
              materialIds: [],
              updates: [],
              createdAt: stamp,
              updatedAt: stamp,
            },
          ],
          // 事件候选挂到当天的每日记录上，方便时间线与报告引用
          entries: input.sourceId
            ? s.entries.map((e) =>
                e.id === input.sourceId
                  ? { ...e, eventIds: Array.from(new Set([...e.eventIds, id])) }
                  : e,
              )
            : s.entries,
        }));
        return id;
      },

      confirmEvent: (id) => {
        const target = get().events.find((e) => e.id === id);
        if (!target || target.status !== "draft") return;
        const confirmed = {
          ...target,
          status: "confirmed" as const,
          confirmedAt: now(),
          updatedAt: now(),
        };
        set((s) => {
          const owner = confirmed.sourceId;
          const added = createSuggestions(
            requirementsForEvent(confirmed),
            s.materials,
            s.suggestions,
          ).map((x) => (owner ? { ...x, entryId: owner } : x));
          return {
            events: s.events.map((e) => (e.id === id ? confirmed : e)),
            suggestions: [...s.suggestions, ...added],
            entries: owner
              ? s.entries.map((e) =>
                  e.id === owner
                    ? {
                        ...e,
                        suggestionIds: Array.from(
                          new Set([
                            ...e.suggestionIds,
                            ...added.map((x) => x.id),
                          ]),
                        ),
                      }
                    : e,
                )
              : s.entries,
          };
        });
      },

      updateEvent: (id, patch) =>
        set((s) => {
          const events = s.events.map((e) =>
            e.id === id
              ? { ...e, ...patch, id: e.id, status: e.status, updatedAt: now() }
              : e,
          );
          const event = events.find((e) => e.id === id);
          if (!event || event.status !== "confirmed") return { events };
          const owner = event.sourceId;
          const added = createSuggestions(
            requirementsForEvent(event),
            s.materials,
            s.suggestions,
          ).map((x) => (owner ? { ...x, entryId: owner } : x));
          return {
            events,
            suggestions: [...s.suggestions, ...added],
            entries: owner
              ? s.entries.map((e) =>
                  e.id === owner
                    ? {
                        ...e,
                        suggestionIds: Array.from(
                          new Set([
                            ...e.suggestionIds,
                            ...added.map((x) => x.id),
                          ]),
                        ),
                      }
                    : e,
                )
              : s.entries,
          };
        }),

      dismissEvent: (id) =>
        set((s) => ({
          events: s.events.map((e) =>
            e.id === id && e.status === "draft"
              ? { ...e, status: "dismissed" }
              : e,
          ),
        })),

      deleteEvent: (id) =>
        set((s) => ({
          events: s.events.filter((e) => e.id !== id),
          materials: s.materials.map((m) => ({
            ...m,
            eventIds: m.eventIds.filter((x) => x !== id),
          })),
          suggestions: s.suggestions.filter((x) => x.eventId !== id),
          emergencies: s.emergencies.map((x) =>
            x.eventId === id ? { ...x, eventId: undefined } : x,
          ),
          entries: s.entries.map((e) => ({
            ...e,
            eventIds: e.eventIds.filter((x) => x !== id),
          })),
        })),

      addUpdate: (id, content) =>
        set((s) => ({
          events: s.events.map((e) =>
            e.id === id
              ? {
                  ...e,
                  updates: [
                    ...e.updates,
                    { id: uid(), content, createdAt: now() },
                  ],
                  updatedAt: now(),
                }
              : e,
          ),
        })),

      createManualEvent: (input) => {
        const id = get().addDraft({ ...input, sourceType: "manual" });
        get().confirmEvent(id);
        return id;
      },

      saveMaterial: (input, suggestionId) => {
        const id = input.id || uid();
        const stamp = now();
        const old = get().materials.find((m) => m.id === id);
        const material = {
          ...input,
          id,
          createdAt: old ? old.createdAt : stamp,
          updatedAt: stamp,
        };
        set((s) => {
          const materials = [
            ...s.materials.filter((m) => m.id !== id),
            material,
          ];
          const events = s.events.map((e) => ({
            ...e,
            materialIds: material.eventIds.includes(e.id)
              ? Array.from(new Set([...e.materialIds, id]))
              : e.materialIds.filter((x) => x !== id),
          }));
          let suggestions = reconcileSuggestions(s.suggestions, materials);
          if (suggestionId) {
            const target = suggestions.find((x) => x.id === suggestionId);
            if (target && target.status === "completed") {
              suggestions = suggestions.map((x) =>
                x.id === suggestionId ? { ...x, resolvedMaterialId: id } : x,
              );
            }
          }
          return { materials, events, suggestions };
        });
        return id;
      },

      suggest: (requirements, entryId) => {
        const added = createSuggestions(
          requirements,
          get().materials,
          get().suggestions,
        ).map((x) => (entryId ? { ...x, entryId } : x));
        set((s) => ({
          suggestions: reconcileSuggestions(
            [...s.suggestions, ...added],
            s.materials,
          ),
          entries: entryId
            ? s.entries.map((e) =>
                e.id === entryId
                  ? {
                      ...e,
                      suggestionIds: Array.from(
                        new Set([
                          ...e.suggestionIds,
                          ...added.map((x) => x.id),
                        ]),
                      ),
                    }
                  : e,
              )
            : s.entries,
        }));
        return added.map((x) => x.id);
      },

      setSuggestionStatus: (id, status) =>
        set((s) => ({
          suggestions: s.suggestions.map((x) =>
            x.id === id ? { ...x, status } : x,
          ),
        })),

      saveEmergency: (session) =>
        set((s) => ({
          emergencies: [
            ...s.emergencies.filter((x) => x.id !== session.id),
            session,
          ],
        })),

      updateEmergency: (id, patch) =>
        set((s) => ({
          emergencies: s.emergencies.map((x) =>
            x.id === id ? { ...x, ...patch, id: x.id } : x,
          ),
        })),

      confirmEmergency: (id) => {
        const session = get().emergencies.find((x) => x.id === id);
        if (!session) throw new Error("问卷记录不存在，请重新填写。");
        if (
          session.eventId &&
          get().events.some((e) => e.id === session.eventId)
        )
          return session.eventId as string;
        const title =
          session.factsDraft.split("\n")[0].replace("事项：", "") ||
          "紧急事项记录";
        const entryId = session.date
          ? get().ensureEntry(session.date)
          : undefined;
        const eventId = get().addDraft({
          title,
          occurredAt: session.date || session.createdAt.slice(0, 10),
          people: [],
          description: session.factsDraft,
          attention: session.priority === "routine" ? "watch" : "priority",
          sourceType: "emergency",
          sourceId: entryId,
        });
        get().confirmEvent(eventId);
        get().updateEmergency(id, { eventId });
        return eventId;
      },

      setNotification: (notificationEnabled) => set({ notificationEnabled }),
      setMockConfig: (patch) =>
        set((s) => ({ mockConfig: { ...s.mockConfig, ...patch } })),
      consumeMockConfig: () => {
        const config = { ...get().mockConfig };
        if (config.failNext)
          set((s) => ({ mockConfig: { ...s.mockConfig, failNext: false } }));
        return config;
      },

      loadDemo: async (replace = false) => {
        if (get().onboarded && !replace)
          throw new Error(
            "当前已有工作档案。请在「我的」中确认重置，避免覆盖你的数据。",
          );
        if (replace) await fileService.clear();
        const data = await createDemo();
        set(data);
        await flushData();
      },

      clearData: async () => {
        await fileService.clear();
        set(emptyData());
        await flushData();
        localStorage.removeItem(STORAGE_KEY);
      },
    }),
    {
      name: STORAGE_KEY,
      version: STORAGE_VERSION,
      storage: apiStorage,
      partialize: (state) => pickData(state),
      migrate: (persisted) => migrateData(persisted),
      skipHydration: true,
    },
  ),
);
