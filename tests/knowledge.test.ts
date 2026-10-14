import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildReply,
  replyKinds,
  type AssistantContext,
  type SuggestionKind,
} from "../src/services/ai";
import type { MaterialType, WorkEvent } from "../src/types";

const root = join(__dirname, "..", "knowledge");
const docs = readdirSync(root).filter((f) => f.endsWith(".md"));
const knowledge = docs.map((f) => readFileSync(join(root, f), "utf8"));
const squash = (s: string) => s.replace(/\s+/g, "");
const corpus = squash(knowledge.join("\n"));

interface FewShot {
  id: string;
  scenario: string;
  user_input: string;
  context?: { confirmed_events?: { id: string; title: string }[] };
  path: "A" | "A+" | "B";
  suggestions: SuggestionKind[];
  material_types: MaterialType[];
  ideal_reply: string;
  notes?: string;
}
const shotDir = join(root, "fewshot");
const shots: FewShot[] = readdirSync(shotDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(shotDir, f), "utf8")));

const CASE_NO = /（\s*\d{4}\s*）[^（）\n|]{1,16}?号/g;
const STATUTE = /第\s*[一二三四五六七八九十百零\d]+\s*条/g;
const BANNED = /公司违法|一定能赢|一定会赢|必须辞职|应该辞职|稳赢|一定输/;

describe("knowledge/*.md", () => {
  it("三份文档都带 frontmatter：source、path、updated", () => {
    expect(docs.sort()).toEqual([
      "emotion-support.md",
      "evidence-checklist.md",
      "risk-assessment.md",
    ]);
    for (const md of knowledge) {
      const front = md.match(/^---\n([\s\S]+?)\n---\n/)?.[1] ?? "";
      expect(front).toMatch(/^source: docs\/source\/.+\.docx$/m);
      expect(front).toMatch(/^path: \[(A|A\+|B)(, (A|A\+|B))*\]$/m);
      expect(front).toMatch(/^updated: \d{4}-\d{2}-\d{2}$/m);
    }
  });

  it("没有表格里的 ------ 残留行与 pandoc 转义", () => {
    for (const md of knowledge) {
      expect(md).not.toMatch(/^\|(\s*-+\s*\|)+\s*\n\|(\s*-+\s*\|)+\s*$/m);
      expect(md).not.toMatch(/^\| -+ \|/m);
      expect(md).not.toMatch(/\\[[\]|]/);
    }
  });

  it("关键规则原文保留：20 题、满分 40、6 条红线、三档阈值、12356", () => {
    const risk = knowledge[docs.indexOf("risk-assessment.md")];
    expect(risk).toContain("| 题目总量     | 20 题    | 满分 40 分");
    for (const id of ["R1", "R2", "R3", "R4", "R5", "R6"])
      expect(risk).toContain(`| ${id} |`);
    expect(risk).toContain("0 – 5 分，且无红线");
    expect(risk).toContain("6 – 11 分，且无红线");
    expect(risk).toContain("≥ 12 分，或命中任一红线");
    expect(corpus).toContain("12356");
  });
});

const ctxFor = (shot: FewShot): AssistantContext => ({
  date: "2026-10-12",
  entryId: "entry1",
  userText: "",
  confirmedEvents: (shot.context?.confirmed_events ?? []).map(
    (e) =>
      ({
        ...e,
        occurredAt: "2026-10-10",
        people: [],
        description: "",
        status: "confirmed",
        attention: "watch",
        sourceType: "chat",
        materialIds: [],
        updates: [],
        createdAt: "",
        updatedAt: "",
      }) as WorkEvent,
  ),
  draftTitles: [],
  materials: [],
});

describe("knowledge/fewshot", () => {
  it("覆盖要求的五类场景，且字段齐全", () => {
    expect(shots.length).toBeGreaterThanOrEqual(5);
    for (const s of shots) {
      expect(s.user_input).toBeTruthy();
      expect(["A", "A+", "B"]).toContain(s.path);
      expect(s.ideal_reply).toBeTruthy();
      expect(Array.isArray(s.suggestions)).toBe(true);
    }
    const kinds = shots.flatMap((s) => s.suggestions);
    expect(kinds).toContain("coping_methods");
    expect(kinds).toContain("referral");
    expect(kinds).toContain("crisis_hotline");
    expect(kinds).toContain("clarify");
    expect(kinds).toContain("append_update");
  });

  it.each(shots.map((s) => [s.id, s] as const))(
    "%s：规则层的分流与 suggestion 类型和示例一致",
    (_id, shot) => {
      const reply = buildReply(shot.user_input, ctxFor(shot));
      expect(reply.path).toBe(shot.path);
      expect(replyKinds(reply).sort()).toEqual([...shot.suggestions].sort());
      const types = Array.from(
        new Set((reply.requirements ?? []).map((r) => r.type)),
      ).sort();
      expect(types).toEqual([...shot.material_types].sort());
    },
  );

  it.each(shots.map((s) => [s.id, s] as const))(
    "%s：理想回复遵守硬约束",
    (_id, shot) => {
      const reply = shot.ideal_reply;
      expect(reply).not.toMatch(BANNED);
      // 先接情绪再谈事实：第一行不谈材料、证据或转介（补问时间的那一句除外）
      if (!shot.suggestions.includes("clarify"))
        expect(reply.split("\n")[0]).not.toMatch(/律师|材料|证据|建议/);
      if (shot.suggestions.includes("referral"))
        expect(reply).toMatch(/执业律师.*劳动人事争议仲裁委员会.*法律援助中心/);
      if (shot.suggestions.includes("crisis_hotline"))
        expect(reply).toContain("12356");
      if (shot.suggestions.includes("clarify")) {
        expect(reply.match(/[？?]/g)).toHaveLength(1);
        expect(reply.split("\n")).toHaveLength(1);
      }
      if (shot.suggestions.includes("coping_methods")) {
        const bullets = reply.split("\n").filter((l) => l.startsWith("·"));
        expect(bullets.length).toBeGreaterThanOrEqual(2);
        expect(bullets.length).toBeLessThanOrEqual(3);
      }
    },
  );

  it("示例里不新增知识库之外的案号或法条", () => {
    for (const s of shots) {
      const text = `${s.ideal_reply}\n${s.notes ?? ""}`;
      for (const ref of [
        ...(text.match(CASE_NO) ?? []),
        ...(text.match(STATUTE) ?? []),
      ])
        expect(corpus).toContain(squash(ref));
    }
  });
});
