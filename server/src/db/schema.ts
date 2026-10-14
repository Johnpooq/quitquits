import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import type {
  EmergencySession,
  EventInput,
  EventUpdate,
} from "../../../src/types";

/**
 * 表结构按前端的 `AppData` 建。没有账号体系：每张表都带 device_id，
 * 主键是 (device_id, id)，不同匿名设备的数据互不可见。
 * `position` 保存数组顺序（例如对话消息的先后），读回时按它排序。
 */

const ts = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const device = pgTable("device", {
  id: text("id").primaryKey(),
  /** 只存令牌的 SHA-256，不存明文 */
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

const deviceId = () =>
  text("device_id")
    .notNull()
    .references(() => device.id, { onDelete: "cascade" });

export const settings = pgTable("settings", {
  deviceId: deviceId().primaryKey(),
  onboarded: boolean("onboarded").notNull().default(false),
  isDemo: boolean("is_demo").notNull().default(false),
  notificationEnabled: boolean("notification_enabled").notNull().default(false),
  mockDelayMs: integer("mock_delay_ms").notNull().default(650),
  mockFailNext: boolean("mock_fail_next").notNull().default(false),
  dataVersion: integer("data_version").notNull().default(3),
  /** 客户端写入序号：比已保存的旧就忽略，避免乱序请求覆盖新数据 */
  revision: bigint("revision", { mode: "number" }).notNull().default(0),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const profile = pgTable("profile", {
  deviceId: deviceId().primaryKey(),
  id: text("id").notNull(),
  employmentStatus: text("employment_status").notNull(),
  company: text("company"),
  role: text("role"),
  startDate: text("start_date"),
  city: text("city"),
});

export const dailyEntry = pgTable(
  "daily_entry",
  {
    deviceId: deviceId(),
    id: text("id").notNull(),
    position: integer("position").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    mood: text("mood"),
    content: text("content").notNull().default(""),
    draftText: text("draft_text"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    conversationId: text("conversation_id").notNull(),
    eventIds: jsonb("event_ids").$type<string[]>().notNull().default([]),
    suggestionIds: jsonb("suggestion_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    aiSummary: text("ai_summary"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.deviceId, t.id] }),
    index("daily_entry_date_idx").on(t.deviceId, t.date),
  ],
);

export const chatMessage = pgTable(
  "chat_message",
  {
    deviceId: deviceId(),
    id: text("id").notNull(),
    position: integer("position").notNull(),
    conversationId: text("conversation_id").notNull(),
    dailyEntryId: text("daily_entry_id").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    candidateEventIds: jsonb("candidate_event_ids").$type<string[]>(),
    suggestionIds: jsonb("suggestion_ids").$type<string[]>(),
    emergency: boolean("emergency"),
    updateSuggestionEventId: text("update_suggestion_event_id"),
    clarify: jsonb("clarify").$type<EventInput>(),
    status: text("status").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.deviceId, t.id] }),
    index("chat_message_entry_idx").on(t.deviceId, t.dailyEntryId),
  ],
);

export const event = pgTable(
  "event",
  {
    deviceId: deviceId(),
    id: text("id").notNull(),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    occurredAt: text("occurred_at").notNull(),
    people: jsonb("people").$type<string[]>().notNull().default([]),
    description: text("description").notNull().default(""),
    status: text("status").notNull(),
    attention: text("attention").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id"),
    materialIds: jsonb("material_ids").$type<string[]>().notNull().default([]),
    updates: jsonb("updates").$type<EventUpdate[]>().notNull().default([]),
    confirmedAt: ts("confirmed_at"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.id] })],
);

export const material = pgTable(
  "material",
  {
    deviceId: deviceId(),
    id: text("id").notNull(),
    position: integer("position").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    status: text("status").notNull(),
    coverageStart: text("coverage_start"),
    coverageEnd: text("coverage_end"),
    isCurrent: boolean("is_current").notNull(),
    eventIds: jsonb("event_ids").$type<string[]>().notNull().default([]),
    fileId: text("file_id"),
    fileName: text("file_name"),
    mimeType: text("mime_type"),
    fileSize: integer("file_size"),
    externalLocationNote: text("external_location_note"),
    extractionDraft: text("extraction_draft"),
    confirmedExtraction: text("confirmed_extraction"),
    extractionStatus: text("extraction_status").notNull(),
    note: text("note"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.id] })],
);

export const materialSuggestion = pgTable(
  "material_suggestion",
  {
    deviceId: deviceId(),
    id: text("id").notNull(),
    position: integer("position").notNull(),
    /** 可以为空：材料收集不以确认事件为前提 */
    eventId: text("event_id"),
    entryId: text("entry_id"),
    type: text("type").notNull(),
    title: text("title").notNull(),
    reason: text("reason").notNull(),
    coverageStart: text("coverage_start"),
    coverageEnd: text("coverage_end"),
    status: text("status").notNull(),
    priority: boolean("priority"),
    resolvedMaterialId: text("resolved_material_id"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.id] })],
);

export const emergencySession = pgTable(
  "emergency_session",
  {
    deviceId: deviceId(),
    id: text("id").notNull(),
    position: integer("position").notNull(),
    category: text("category").notNull(),
    answers: jsonb("answers")
      .$type<EmergencySession["answers"]>()
      .notNull()
      .default({}),
    factsDraft: text("facts_draft").notNull().default(""),
    priority: text("priority").notNull(),
    priorityReasons: jsonb("priority_reasons")
      .$type<string[]>()
      .notNull()
      .default([]),
    eventId: text("event_id"),
    date: text("date"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.id] })],
);

/** 上传文件的元数据；文件本体在本地磁盘 STORAGE_DIR/<device_id>/<id> */
export const storedFile = pgTable(
  "stored_file",
  {
    deviceId: deviceId(),
    id: text("id").notNull(),
    name: text("name").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.id] })],
);
