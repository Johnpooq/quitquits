import { describe, expect, it } from "vitest";
import { createTestApp, knowledgeDir } from "./helpers";
import type { ChatMessage } from "../src/ai/llm";
import { guardReply } from "../src/ai/guard";
import { HARD_RULES, loadKnowledge, systemPrompt } from "../src/ai/prompt";
import { buildReply } from "../../src/services/ai";

const ctx = {
  date: "2026-10-12",
  entryId: "entry1",
  userText: "",
  confirmedEvents: [],
  draftTitles: [],
  materials: [],
};

/** 假模型：记录收到的 prompt，返回预设回复 */
const fakeChat = (answer: string | ((m: ChatMessage[]) => string)) => {
  const calls: ChatMessage[][] = [];
  const chat = async (messages: ChatMessage[]) => {
    calls.push(messages);
    if (answer === "throw") throw new Error("timeout");
    return typeof answer === "function" ? answer(messages) : answer;
  };
  return { chat, calls };
};

const reply = async (
  app: Awaited<ReturnType<typeof createTestApp>>,
  text: string,
) => {
  const token = await app.register();
  const res = await app.call(token, "/ai/reply", {
    method: "POST",
    body: JSON.stringify({ text, ctx: { ...ctx, userText: text } }),
  });
  return (await res.json()) as {
    content: string;
    mode: string;
    path: string;
    referral?: boolean;
    crisis?: string;
  };
};

describe("system prompt：知识库 + few-shot + 硬约束", () => {
  const knowledge = loadKnowledge(knowledgeDir);

  it("读入三份知识库（去掉 frontmatter）与全部 few-shot", () => {
    expect(knowledge.docs.map((d) => d.slug)).toEqual([
      "emotion-support",
      "evidence-checklist",
      "risk-assessment",
    ]);
    expect(knowledge.docs.every((d) => !d.body.startsWith("---"))).toBe(true);
    expect(knowledge.shots.length).toBeGreaterThanOrEqual(5);
  });

  it("按路径挑选知识库：A 不带证据清单，B 带上证据清单", () => {
    const a = systemPrompt(knowledge, "A");
    const b = systemPrompt(knowledge, "B");
    expect(a).toContain(HARD_RULES);
    expect(a).toContain("职场情绪疏导建议");
    expect(a).not.toContain("职场员工分阶段证据收集清单");
    expect(b).toContain("职场员工分阶段证据收集清单");
    expect(b).toContain("职场权益风险评估问卷与风险信号清单");
    for (const shot of knowledge.shots) expect(b).toContain(shot.user_input);
  });

  it("危机时总会带上情绪疏导建议（含 12356）", () => {
    expect(systemPrompt(knowledge, "B", true)).toContain("12356");
  });
});

describe("真实模型调用与安全兜底", () => {
  it("未配置模型：直接返回规则模板，mode = rules", async () => {
    const t = await createTestApp();
    const r = await reply(t, "被劝退了，HR 让我写个人原因");
    expect(r.mode).toBe("rules");
    expect(r.path).toBe("B");
    expect(r.content).toContain("执业律师");
    await t.close();
  });

  it("配置了模型：用模型的措辞，结构化判断不变", async () => {
    const { chat, calls } = fakeChat(
      "被劝退还要写个人原因，换谁都会难受。\n· 先别签。\n建议尽快咨询执业律师、当地劳动人事争议仲裁委员会或当地法律援助中心。",
    );
    const t = await createTestApp(chat);
    const r = await reply(t, "被劝退了，HR 让我写个人原因");
    expect(r.mode).toBe("llm");
    expect(r.content.startsWith("被劝退还要写个人原因")).toBe(true);
    expect(r.path).toBe("B");
    expect(r.referral).toBe(true);
    const [system, user] = calls[0];
    expect(system.content).toContain("职场员工分阶段证据收集清单");
    expect(user.content).toContain("被劝退了，HR 让我写个人原因");
    expect(user.content).toContain("还缺的材料");
    await t.close();
  });

  it("模型说出结论性表述：丢弃，改用规则模板", async () => {
    const { chat } = fakeChat("别担心，这属于公司违法，你一定能赢。");
    const t = await createTestApp(chat);
    const r = await reply(t, "被劝退了，HR 让我写个人原因");
    expect(r.mode).toBe("rules");
    expect(r.content).not.toMatch(/公司违法|一定能赢/);
    expect(t.logs.join()).toContain("banned");
    await t.close();
  });

  it("模型编造知识库之外的案号：丢弃", async () => {
    const { chat } = fakeChat("类似情况可以参考（2099）京民终 1 号。");
    const t = await createTestApp(chat);
    expect((await reply(t, "被劝退了，HR 让我写个人原因")).mode).toBe("rules");
    await t.close();
  });

  it("高风险但模型漏了转介：自动补上", async () => {
    const { chat } = fakeChat("听起来很难受，先别签字。");
    const t = await createTestApp(chat);
    const r = await reply(t, "被劝退了，HR 让我写个人原因");
    expect(r.mode).toBe("llm");
    expect(r.content).toMatch(/执业律师.*劳动人事争议仲裁委员会.*法律援助中心/);
    await t.close();
  });

  it("自伤念头但模型漏了 12356：自动补上", async () => {
    const { chat } = fakeChat("谢谢你说出来，你不是一个人。");
    const t = await createTestApp(chat);
    const r = await reply(t, "我真的不想活了");
    expect(r.crisis).toBe("selfharm");
    expect(r.content).toContain("12356");
    await t.close();
  });

  it("模型调用失败：退回规则模板，不报错", async () => {
    const { chat } = fakeChat("throw");
    const t = await createTestApp(chat);
    const r = await reply(t, "今天好累");
    expect(r.mode).toBe("rules");
    expect(r.content).toContain("消耗");
    await t.close();
  });

  it("时间说不清时模型追问了好几句：丢弃，只问一句", () => {
    const rules = buildReply("前几天老板取消了两个项目会议", ctx);
    const g = guardReply("是哪天？涉及谁？有材料吗？", rules, "");
    expect(g.fallback).toBe(true);
    expect(g.content.match(/？/g)).toHaveLength(1);
  });
});

describe("总结与文件提取", () => {
  it("规则模式：沿用「模拟 AI」总结与 TXT 原文节选", async () => {
    const t = await createTestApp();
    const token = await t.register();
    const s = await t.call(token, "/ai/summarize", {
      method: "POST",
      body: JSON.stringify({ status: { mood: "tired" }, userText: "" }),
    });
    expect(((await s.json()) as { summary: string }).summary).toMatch(
      /^模拟 AI：.*疲惫/,
    );
    const e = await t.call(token, "/ai/extract", {
      method: "POST",
      body: JSON.stringify({ name: "a.txt", text: "原文内容" }),
    });
    expect(((await e.json()) as { text: string }).text).toContain(
      "TXT 原文节选",
    );
    const pdf = await t.call(token, "/ai/extract", {
      method: "POST",
      body: JSON.stringify({ name: "a.pdf" }),
    });
    expect(((await pdf.json()) as { text: string }).text).toContain(
      "手动填写摘要",
    );
    await t.close();
  });

  it("模型模式：总结标注「AI」，出现结论性表述时退回规则总结", async () => {
    let answer = "今天你有些疲惫，记下了被移出项目群这件事。";
    const t = await createTestApp(async () => answer);
    const token = await t.register();
    const summarize = async () =>
      (
        (await (
          await t.call(token, "/ai/summarize", {
            method: "POST",
            body: JSON.stringify({
              status: { mood: "tired" },
              userText: "被移出项目群",
            }),
          })
        ).json()) as { summary: string }
      ).summary;
    expect(await summarize()).toBe(`AI：${answer}`);
    answer = "公司违法了，你应该辞职。";
    expect(await summarize()).toMatch(/^模拟 AI：/);
    await t.close();
  });
});
