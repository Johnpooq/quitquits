import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { TriagePath } from "../../../src/services/triage";
import type { AssistantReply, SuggestionKind } from "../../../src/services/ai";

export interface KnowledgeDoc {
  slug: string;
  title: string;
  source: string;
  paths: TriagePath[];
  body: string;
}
export interface FewShot {
  id: string;
  scenario: string;
  user_input: string;
  path: TriagePath;
  suggestions: SuggestionKind[];
  material_types: string[];
  ideal_reply: string;
}
export interface Knowledge {
  docs: KnowledgeDoc[];
  shots: FewShot[];
  /** 全部知识库正文（去掉空白），用来核对模型有没有编造案号或法条 */
  corpus: string;
}

export function loadKnowledge(dir: string): Knowledge {
  const docs = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((file) => {
      const raw = readFileSync(join(dir, file), "utf8");
      const [, front = "", body = raw] =
        raw.match(/^---\n([\s\S]+?)\n---\n([\s\S]*)$/) ?? [];
      const field = (key: string) =>
        front.match(new RegExp(`^${key}: (.+)$`, "m"))?.[1].trim() ?? "";
      return {
        slug: file.replace(/\.md$/, ""),
        title: field("title"),
        source: field("source"),
        paths: field("path")
          .replace(/[[\]]/g, "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean) as TriagePath[],
        body: body.trim(),
      };
    });
  const shotDir = join(dir, "fewshot");
  const shots = readdirSync(shotDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(shotDir, f), "utf8")) as FewShot);
  return {
    docs,
    shots,
    corpus: docs
      .map((d) => d.body)
      .join("\n")
      .replace(/\s+/g, ""),
  };
}

export const HARD_RULES = `你是「今天你想离职了吗？」工作日记里的 AI 整理助手，不是律师，也不是心理咨询师。必须遵守：
1. 先接情绪，再谈事实：开头先用 1–2 句回应用户的感受，再说别的。
2. 不说「公司违法」「一定能赢」「一定会输」「你必须辞职」「你应该辞职」，不对公司或任何人的行为做对错判断。
3. 不下法律结论：不判断是否违法、能否胜诉、能拿多少赔偿；不引用任何案号或法条。
4. 高风险必须转介：系统判断为高风险时，明确建议尽快咨询执业律师、当地劳动人事争议仲裁委员会或当地法律援助中心，并提醒取证只用自己有权访问的内容、不要伪造证据。
5. 出现伤害自己的念头，或持续两周以上的失眠、低落：语气温和、不评判，给出全国心理援助热线 12356，工作上的事先放一放。
6. 情绪疏导每次最多给 2–3 条，优先当下就能做的。
7. 时间说不清时只补问一句「大概哪一天」，不追问其他。
8. 路径、风险信号、要不要建事件、要列哪些材料缺口，都已经由系统决定。你只负责把话说好，不得改变、增加或删除这些判断，也不要提「路径」「信号编号」这类内部术语。
9. 只输出给用户看的中文回复正文：不要 Markdown 标题，可以用「· 」列点，不超过 300 字。`;

/** system prompt = 硬约束 + 当前路径相关的知识库 + few-shot 示例 */
export function systemPrompt(
  knowledge: Knowledge,
  path: TriagePath,
  crisis = false,
): string {
  const docs = knowledge.docs.filter(
    (d) => d.paths.includes(path) || (crisis && d.slug === "emotion-support"),
  );
  const shots = knowledge.shots.map((s) =>
    [
      `【示例 · ${s.scenario}】`,
      `用户：${s.user_input}`,
      `系统判断：路径 ${s.path}；应触发 ${s.suggestions.join("、") || "无"}`,
      `理想回复：\n${s.ideal_reply}`,
    ].join("\n"),
  );
  return [
    HARD_RULES,
    "# 知识库（只能依据这些内容给出方法与材料建议，不要编造）",
    ...docs.map((d) => `## ${d.title}（来源：${d.source}）\n${d.body}`),
    "# 示例（学习语气、顺序与分寸，不要照抄事实）",
    ...shots,
  ].join("\n\n");
}

const ACTION = (r: AssistantReply) =>
  r.crisis && r.crisis !== "none"
    ? "危机支持"
    : r.clarify
      ? "只补问一句时间"
      : r.updateSuggestionEventId
        ? "建议把新情况追加为已确认事件的进展"
        : r.emergency
          ? "时间敏感：提供「整理当前情况」入口，由用户主动进入"
          : r.candidateEvent
            ? `已整理一条事件草稿「${r.candidateEvent.title}」放进今日整理`
            : r.requirements?.length
              ? "列出材料库里缺失的材料"
              : r.methods?.length
                ? "情绪疏导"
                : "回应并记录";

/** 给模型的用户消息：用户原话 + 系统的结构化判断 + 规则模板草稿 */
export function replyPrompt(input: {
  text: string;
  earlier: string;
  reply: AssistantReply;
  signalLabels: string[];
  materialGaps: string[];
}): string {
  const { reply } = input;
  const mustInclude = [
    reply.referral &&
      "转介：执业律师、当地劳动人事争议仲裁委员会、当地法律援助中心",
    reply.crisis && reply.crisis !== "none" && "全国心理援助热线 12356",
    reply.evidenceReminder && "现在就开始固定证据的提醒",
    input.materialGaps.length && `材料缺口：${input.materialGaps.join("、")}`,
  ].filter(Boolean);
  return [
    `用户刚说：「${input.text}」`,
    input.earlier ? `今天更早的记录：\n${input.earlier.slice(-1500)}` : "",
    "系统判断（必须遵守，不要改变）：",
    JSON.stringify(
      {
        风险路径: reply.path,
        风险信号: input.signalLabels,
        本次动作: ACTION(reply),
        必须包含: mustInclude,
        情绪疏导方法数量上限: reply.methods?.length ? 3 : 0,
      },
      null,
      2,
    ),
    `规则模板草稿（信息不能少，可以把话说得更自然）：\n${reply.content}`,
    "请直接输出回复正文。",
  ]
    .filter(Boolean)
    .join("\n\n");
}
