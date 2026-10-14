import type {
  AppData,
  ChatMessage,
  DailyEntry,
  EmergencySession,
  Material,
  MaterialSuggestion,
  WorkEvent,
} from "../../../src/types";
import * as t from "../db/schema";

type Row<T extends { $inferInsert: unknown }> = T["$inferInsert"];

export class InvalidDataError extends Error {}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** 前端用 ISO 字符串，数据库用 timestamptz */
const toTime = (value: string | undefined, field: string): Date => {
  const d = value ? new Date(value) : new Date(NaN);
  if (Number.isNaN(d.getTime()))
    throw new InvalidDataError(`${field} 不是合法时间：${value}`);
  return d;
};
const toOptTime = (value: string | undefined, field: string) =>
  value ? toTime(value, field) : null;
const iso = (d: Date | null) => (d ? d.toISOString() : undefined);

const opt = <T>(v: T | undefined) => (v === undefined ? null : v);

/** 读回时把 null 去掉，和前端的可选字段（undefined）保持一致 */
const compact = <T extends object>(o: T): T =>
  Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== null && v !== undefined),
  ) as T;

const list = <T>(value: T[] | undefined, field: string): T[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new InvalidDataError(`${field} 必须是数组`);
  return value;
};

export interface Rows {
  settings: Row<typeof t.settings>;
  profile: Row<typeof t.profile> | null;
  entries: Row<typeof t.dailyEntry>[];
  messages: Row<typeof t.chatMessage>[];
  events: Row<typeof t.event>[];
  materials: Row<typeof t.material>[];
  suggestions: Row<typeof t.materialSuggestion>[];
  emergencies: Row<typeof t.emergencySession>[];
}

export function toRows(
  deviceId: string,
  state: AppData,
  meta: { revision: number; version: number },
): Rows {
  if (!state || typeof state !== "object")
    throw new InvalidDataError("state 必须是对象");
  const p = state.profile;
  return {
    settings: {
      deviceId,
      onboarded: Boolean(state.onboarded),
      isDemo: Boolean(state.isDemo),
      notificationEnabled: Boolean(state.notificationEnabled),
      mockDelayMs: Math.max(0, Math.round(state.mockConfig?.delayMs ?? 650)),
      mockFailNext: Boolean(state.mockConfig?.failNext),
      dataVersion: meta.version,
      revision: meta.revision,
      updatedAt: new Date(),
    },
    profile: p
      ? {
          deviceId,
          id: p.id,
          employmentStatus: p.employmentStatus,
          company: opt(p.company),
          role: opt(p.role),
          startDate: opt(p.startDate),
          city: opt(p.city),
        }
      : null,
    entries: list(state.entries, "entries").map((e, position) => {
      if (!DATE_ONLY.test(e.date))
        throw new InvalidDataError(`每日记录日期格式不对：${e.date}`);
      return {
        deviceId,
        id: e.id,
        position,
        date: e.date,
        mood: opt(e.mood),
        content: e.content ?? "",
        draftText: opt(e.draftText),
        tags: e.tags ?? [],
        conversationId: e.conversationId,
        eventIds: e.eventIds ?? [],
        suggestionIds: e.suggestionIds ?? [],
        aiSummary: opt(e.aiSummary),
        createdAt: toTime(e.createdAt, "entry.createdAt"),
        updatedAt: toTime(e.updatedAt, "entry.updatedAt"),
      };
    }),
    messages: list(state.messages, "messages").map((m, position) => ({
      deviceId,
      id: m.id,
      position,
      conversationId: m.conversationId,
      dailyEntryId: m.dailyEntryId,
      role: m.role,
      content: m.content,
      candidateEventIds: opt(m.candidateEventIds),
      suggestionIds: opt(m.suggestionIds),
      emergency: opt(m.emergency),
      updateSuggestionEventId: opt(m.updateSuggestionEventId),
      clarify: opt(m.clarify),
      status: m.status,
      createdAt: toTime(m.createdAt, "message.createdAt"),
    })),
    events: list(state.events, "events").map((e, position) => ({
      deviceId,
      id: e.id,
      position,
      title: e.title,
      occurredAt: e.occurredAt,
      people: e.people ?? [],
      description: e.description ?? "",
      status: e.status,
      attention: e.attention,
      sourceType: e.sourceType,
      sourceId: opt(e.sourceId),
      materialIds: e.materialIds ?? [],
      updates: e.updates ?? [],
      confirmedAt: toOptTime(e.confirmedAt, "event.confirmedAt"),
      createdAt: toTime(e.createdAt, "event.createdAt"),
      updatedAt: toTime(e.updatedAt, "event.updatedAt"),
    })),
    materials: list(state.materials, "materials").map((m, position) => ({
      deviceId,
      id: m.id,
      position,
      name: m.name,
      type: m.type,
      status: m.status,
      coverageStart: opt(m.coverageStart),
      coverageEnd: opt(m.coverageEnd),
      isCurrent: Boolean(m.isCurrent),
      eventIds: m.eventIds ?? [],
      fileId: opt(m.fileId),
      fileName: opt(m.fileName),
      mimeType: opt(m.mimeType),
      fileSize: opt(m.fileSize),
      externalLocationNote: opt(m.externalLocationNote),
      extractionDraft: opt(m.extractionDraft),
      confirmedExtraction: opt(m.confirmedExtraction),
      extractionStatus: m.extractionStatus ?? "none",
      note: opt(m.note),
      createdAt: toTime(m.createdAt, "material.createdAt"),
      updatedAt: toTime(m.updatedAt, "material.updatedAt"),
    })),
    suggestions: list(state.suggestions, "suggestions").map((s, position) => ({
      deviceId,
      id: s.id,
      position,
      eventId: opt(s.eventId),
      entryId: opt(s.entryId),
      type: s.type,
      title: s.title,
      reason: s.reason ?? "",
      coverageStart: opt(s.coverageStart),
      coverageEnd: opt(s.coverageEnd),
      status: s.status,
      priority: opt(s.priority),
      resolvedMaterialId: opt(s.resolvedMaterialId),
      createdAt: toTime(s.createdAt, "suggestion.createdAt"),
    })),
    emergencies: list(state.emergencies, "emergencies").map((x, position) => ({
      deviceId,
      id: x.id,
      position,
      category: x.category,
      answers: x.answers ?? {},
      factsDraft: x.factsDraft ?? "",
      priority: x.priority,
      priorityReasons: x.priorityReasons ?? [],
      eventId: opt(x.eventId),
      date: opt(x.date),
      createdAt: toTime(x.createdAt, "emergency.createdAt"),
    })),
  };
}

type Selected<T extends { $inferSelect: unknown }> = T["$inferSelect"];
const byPosition = <T extends { position: number }>(rows: T[]) =>
  [...rows].sort((a, b) => a.position - b.position);

export function fromRows(rows: {
  settings: Selected<typeof t.settings>;
  profile: Selected<typeof t.profile> | undefined;
  entries: Selected<typeof t.dailyEntry>[];
  messages: Selected<typeof t.chatMessage>[];
  events: Selected<typeof t.event>[];
  materials: Selected<typeof t.material>[];
  suggestions: Selected<typeof t.materialSuggestion>[];
  emergencies: Selected<typeof t.emergencySession>[];
}): AppData {
  const s = rows.settings;
  const p = rows.profile;
  return {
    profile: p
      ? compact({
          id: p.id,
          employmentStatus: p.employmentStatus as NonNullable<
            AppData["profile"]
          >["employmentStatus"],
          company: p.company,
          role: p.role,
          startDate: p.startDate,
          city: p.city,
        } as NonNullable<AppData["profile"]>)
      : null,
    onboarded: s.onboarded,
    isDemo: s.isDemo,
    notificationEnabled: s.notificationEnabled,
    mockConfig: { delayMs: s.mockDelayMs, failNext: s.mockFailNext },
    entries: byPosition(rows.entries).map(
      ({ deviceId: _d, position: _p, ...e }) =>
        compact({
          ...e,
          createdAt: iso(e.createdAt),
          updatedAt: iso(e.updatedAt),
        }) as unknown as DailyEntry,
    ),
    messages: byPosition(rows.messages).map(
      ({ deviceId: _d, position: _p, ...m }) =>
        compact({
          ...m,
          createdAt: iso(m.createdAt),
        }) as unknown as ChatMessage,
    ),
    events: byPosition(rows.events).map(
      ({ deviceId: _d, position: _p, ...e }) =>
        compact({
          ...e,
          confirmedAt: iso(e.confirmedAt),
          createdAt: iso(e.createdAt),
          updatedAt: iso(e.updatedAt),
        }) as unknown as WorkEvent,
    ),
    materials: byPosition(rows.materials).map(
      ({ deviceId: _d, position: _p, ...m }) =>
        compact({
          ...m,
          createdAt: iso(m.createdAt),
          updatedAt: iso(m.updatedAt),
        }) as unknown as Material,
    ),
    suggestions: byPosition(rows.suggestions).map(
      ({ deviceId: _d, position: _p, ...x }) =>
        compact({
          ...x,
          createdAt: iso(x.createdAt),
        }) as unknown as MaterialSuggestion,
    ),
    emergencies: byPosition(rows.emergencies).map(
      ({ deviceId: _d, position: _p, ...x }) =>
        compact({
          ...x,
          createdAt: iso(x.createdAt),
        }) as unknown as EmergencySession,
    ),
  };
}
