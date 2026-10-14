import {
  buildReply,
  buildSummary,
  type AssistantContext,
  type AssistantReply,
  type AiMode,
} from "../../../src/services/ai";
import { requirementSatisfied } from "../../../src/services/materials";
import { triageText } from "../../../src/services/triage";
import { MOODS } from "../../../src/constants";
import type { DailyStatusInput } from "../../../src/types";
import { guardReply, guardText } from "./guard";
import type { ChatFn } from "./llm";
import { replyPrompt, systemPrompt, type Knowledge } from "./prompt";

const SUMMARY_RULES = `你在给一页工作日记写「AI 今日总结」。只复述用户自己说过的事实与感受，不评价、不建议、不下任何结论，不提法律、不判断公司对错。两三句话，不超过 80 字，不要标题。`;
const EXTRACT_RULES = `你在帮用户把一份文本材料整理成摘要草稿。只逐条列出文本里明确写到的日期、人物、金额和事项，不推断、不评价、不下结论，不提法律。文本没写的就不写。不超过 300 字，用「· 」列点。`;

/**
 * 服务端的 AI：规则层（src/services/ai.ts + triage.ts）先决定路径、动作与材料，
 * 配置了模型时再让模型在这些判断之内组织语言，最后过一遍安全兜底。
 * 模型不可用或输出不合格时，一律退回规则模板，并如实标注 mode。
 */
export function createAiService(options: {
  knowledge: Knowledge;
  chat?: ChatFn;
  log?: (message: string) => void;
}) {
  const { knowledge, chat } = options;
  const log = options.log ?? ((m: string) => console.warn(`[ai] ${m}`));
  const mode: AiMode = chat ? "llm" : "rules";

  return {
    mode,

    async reply(text: string, ctx: AssistantContext): Promise<AssistantReply> {
      const rules = buildReply(text, ctx);
      if (!chat) return { ...rules, mode: "rules" };
      try {
        const crisis = Boolean(rules.crisis && rules.crisis !== "none");
        const gaps = Array.from(
          new Set(
            (rules.requirements ?? [])
              .filter((r) => !requirementSatisfied(r, ctx.materials))
              .map((r) => r.title),
          ),
        );
        const out = await chat([
          {
            role: "system",
            content: systemPrompt(knowledge, rules.path ?? "A", crisis),
          },
          {
            role: "user",
            content: replyPrompt({
              text,
              earlier: ctx.userText.replace(text, "").trim(),
              reply: rules,
              signalLabels: triageText(text).signals.map((s) => s.label),
              materialGaps: gaps,
            }),
          },
        ]);
        const guarded = guardReply(out, rules, knowledge.corpus);
        if (guarded.fallback)
          log(`模型回复未通过检查（${guarded.reason}），改用规则模板`);
        return {
          ...rules,
          content: guarded.content,
          mode: guarded.fallback ? "rules" : "llm",
        };
      } catch (e) {
        log(`模型调用失败，改用规则模板：${(e as Error).message}`);
        return { ...rules, mode: "rules" };
      }
    },

    async summarize(status: Partial<DailyStatusInput>, userText: string) {
      const fallback = buildSummary(status, userText);
      if (!chat) return fallback;
      try {
        const mood = status.mood ? MOODS[status.mood]?.label : undefined;
        const out = await chat([
          { role: "system", content: SUMMARY_RULES },
          {
            role: "user",
            content: `心情：${mood ?? "未选择"}\n今天的记录：\n${userText.slice(-3000) || "（没有写文字）"}`,
          },
        ]);
        const text = guardText(out, "", knowledge.corpus);
        return text ? `AI：${text.replace(/^AI[：:]\s*/, "")}` : fallback;
      } catch (e) {
        log(`总结生成失败，改用规则模板：${(e as Error).message}`);
        return fallback;
      }
    },

    async extract(file: { name: string; text?: string }) {
      if (file.text === undefined)
        return `${chat ? "AI 提取" : "模拟提取结果"}：已接收文件「${file.name}」。当前不读取图片或 PDF 中的人物与事实，请查看原文件并手动填写摘要。`;
      const excerpt = `模拟提取结果 · TXT 原文节选（最多 1200 字，未核实）\n${file.text.slice(0, 1200)}`;
      if (!chat) return excerpt;
      try {
        const out = await chat([
          { role: "system", content: EXTRACT_RULES },
          { role: "user", content: file.text.slice(0, 12000) },
        ]);
        const text = guardText(out, "", knowledge.corpus);
        return text
          ? `AI 提取草稿（未核实，请对照原文确认）\n${text}`
          : excerpt;
      } catch (e) {
        log(`文件提取失败，改用原文节选：${(e as Error).message}`);
        return excerpt;
      }
    },
  };
}
export type AiService = ReturnType<typeof createAiService>;
