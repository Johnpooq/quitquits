import type {
  DailyStatusInput,
  EventInput,
  Material,
  MockConfig,
  Mood,
  WorkEvent,
} from "../types";
import { MOODS, addDays, today } from "../constants";
import {
  matchingMaterials,
  requirementSatisfied,
  requirementsForChange,
  type MaterialRequirement,
} from "./materials";
import {
  EVIDENCE_LIMITS,
  HOTLINE,
  REFERRAL,
  triageText,
  type CrisisLevel,
  type TextTriage,
  type TriagePath,
} from "./triage";
import { apiJSON } from "./api";

/**
 * AI 分两层：
 * - 本文件里的纯函数是**规则层**：意图、分流路径、事件草稿、留痕建议、转介与危机提示
 *   都由这里决定（前端测试与服务端共用同一份代码）；
 * - `aiService` 调用服务端 `/api/ai/*`。服务端先跑规则层，配置了模型时
 *   再让模型在既定路径内组织语言，并做一次安全兜底；未配置模型时直接返回规则模板，
 *   界面标注「模拟 AI」。
 * `aiService.reply / summarize / extract` 的签名保持不变。
 */
export const simulate = async (config: MockConfig) => {
  await new Promise((r) => setTimeout(r, Math.max(0, config.delayMs)));
  if (config.failNext)
    throw new Error("模拟服务暂时没有回应，你的输入仍然保留。请重试。");
};

/** 从一段自然语言里识别出值得记录的候选事件；纯情绪表达返回 null */
export function detectEvent(
  content: string,
  sourceType: EventInput["sourceType"],
  sourceId?: string,
  date = today(),
): EventInput | null {
  let title = "";
  let attention: EventInput["attention"] = "watch";
  if (/会议.*取消|取消.*会议/.test(content)) title = "会议安排变化";
  else if (/移出|项目群/.test(content)) title = "项目群成员变化";
  else if (/劝退|劝离|个人原因|辞职信|主动辞职/.test(content)) {
    title = "被劝退或被要求写个人原因";
    attention = "priority";
  } else if (/协议|签文件|签离职|签署/.test(content)) {
    title = "被要求签署文件";
    attention = /今天|当天|立即/.test(content) ? "priority" : "watch";
  } else if (/解除|辞退/.test(content)) {
    title = "收到解除沟通";
    attention = "priority";
  } else if (/调岗|停职/.test(content)) title = "工作安排调整";
  else if (/工资.*异常|工资.*没|欠薪|考勤/.test(content))
    title = "工资或考勤情况待核对";
  else if (/完成项目|表扬|绩效.*正常/.test(content)) {
    title = "工作中的积极进展";
    attention = "normal";
  } else if (/项目.*变化|项目.*调整/.test(content)) title = "项目安排变化";
  else if (/HR|人事/.test(content)) title = "HR 沟通记录";
  if (!title) return null;
  return {
    title,
    occurredAt: date,
    description: content,
    people: [],
    attention,
    sourceType,
    sourceId,
  };
}

export type Intent = "emotion" | "materials" | "urgent" | "event" | "smalltalk";

const EMOTION =
  /累|烦|难受|焦虑|委屈|开心|还行|撑不住|emo|心累|压力大|不想上班|难过|崩溃|想哭/;
const POSITIVE = /开心|还行|不错|顺利|挺好/;
const NEGATIVE = /累|烦|难受|焦虑|委屈|撑不住|emo|压力|不想|难过|崩溃|想哭/;
const MATERIALS = /留什么|留点|保存什么|要保存|该保存|材料|证据|收集|截图/;
const URGENT =
  /今天签|当天签|立即签|今天就签|要求今天|今天离职|被通知解除|马上签|今天就办/;
/** 时间说得不确定，才需要补问一句 */
const VAGUE_TIME = /前几天|前阵子|上周|上个月|之前|某天|有段时间/;

/** 判断用户这句话想做什么，决定 AI 的回应方式 */
export function classifyIntent(text: string): Intent {
  if (URGENT.test(text)) return "urgent";
  if (MATERIALS.test(text)) return "materials";
  if (detectEvent(text, "chat")) return "event";
  if (EMOTION.test(text)) return "emotion";
  return "smalltalk";
}

/** 从「涉及主管、和 HR」这类说法里抽出人物 */
export function parsePeople(text: string): string[] {
  const mentioned = text.match(/(?:涉及|和|跟|与)([^，。,；;]+)/)?.[1];
  if (!mentioned) return [];
  return Array.from(
    new Set(
      mentioned
        .split(/[、,，和及]/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

/**
 * 尽量用已有信息推断日期，**能推断就不补问**。
 * 说不清才返回 null，由调用方决定是否澄清。
 */
export function resolveDate(text: string, fallback: string): string | null {
  if (/今天|当天|刚刚|刚才/.test(text)) return fallback;
  if (/昨天|昨日/.test(text)) return addDays(fallback, -1);
  if (/前天/.test(text)) return addDays(fallback, -2);
  if (VAGUE_TIME.test(text)) return null;
  // 没提时间：默认就用这一天的记录日期
  return fallback;
}

/**
 * 情绪疏导方法（knowledge/emotion-support.md 的条目编号）。
 * 原文要求「每次最多给 2–3 条，且优先给当下就能做的」。
 */
export const COPING: Record<number, string> = {
  1: "给情绪起个名字：别只说「好烦」，试着写下几点、发生了什么、身体哪里发紧、是什么情绪，具体了就没那么压人。",
  3: "做几轮 4-7-8 呼吸：吸气 4 秒、屏息 7 秒、呼气 8 秒，先把身体拉回当下。",
  4: "把「我担心会发生的」和「已经确定发生的」分两栏写下来，很多让人睡不着的其实在左栏。",
  5: "今晚先顾身体：按时吃饭、早点睡，有力气的话快走 20 分钟。",
  11: "如果是你最好的朋友遇到这件事，你会对他说什么？把这句话写下来念给自己听。",
  12: "分清「这件事出了错」和「我是个失败者」，一件具体的事不能否定整个你。",
  13: "把大问题拆成今天能做的一件小事，比如只整理一下这周的聊天记录。",
};

/** 按用户当下的状态挑 2–3 条「马上能做」的方法 */
export function copingMethods(text: string): number[] {
  if (/我不行|是不是我|我很差|没用|失败|自责/.test(text)) return [11, 12, 4];
  if (/累|疲惫|心累|撑不住|不想上班/.test(text)) return [3, 5, 13];
  return [1, 3, 4];
}

export const EVIDENCE_REMINDER =
  "另外，你提到的情况是需要留意的信号，现在就可以开始顺手存证据：书面沟通留底、聊天记录导出备份，再按时间记下谁、什么时候、说了什么、给了什么文件。";

export interface AssistantContext {
  /** 当前记录的日期 */
  date: string;
  /** 当前每日记录 id，作为候选事件与留痕建议的来源 */
  entryId: string;
  /** 当天全部用户原文（含本条） */
  userText: string;
  /** 当天已确认的事件 */
  confirmedEvents: WorkEvent[];
  /** 当天已有的草稿标题，避免重复生成同一候选 */
  draftTitles: string[];
  materials: Material[];
}

export interface AssistantReply {
  content: string;
  /** 需要用户确认的事件草稿。一般候选进「今日整理」，不必当场确认。 */
  candidateEvent?: EventInput;
  /** 这条草稿值得及时关注，在对话里给一张轻量卡片 */
  noteworthy?: boolean;
  /** 时间说不清，先补问一句 */
  clarify?: EventInput;
  /** 留痕建议（已按库存去重，只包含确实缺失的） */
  requirements?: MaterialRequirement[];
  /** 时间敏感，展示「整理当前情况」卡片 */
  emergency?: boolean;
  /** 已确认事件被补充，建议追加进展 */
  updateSuggestionEventId?: string;
  /** 分流路径（triage.ts 决定，模型不能改变） */
  path?: TriagePath;
  /** 命中的风险信号编号（knowledge/risk-assessment.md 第五节） */
  signals?: number[];
  /** 危机信号：回复里必须给出 12356 */
  crisis?: CrisisLevel;
  /** 路径 B：回复里必须有专业转介 */
  referral?: boolean;
  /** 路径 A+：提醒现在就开始固定证据 */
  evidenceReminder?: boolean;
  /** 本次给出的情绪疏导方法编号（2–3 条） */
  methods?: number[];
  /** 回复由谁生成：规则模板或真实模型 */
  mode?: AiMode;
}

/**
 * 用户问「该保存什么」时的基础清单。
 * 判断依据是当天全部原文加上当前这条消息——用户可能先说了情况再问该留什么。
 */
function baseRequirements(
  ctx: AssistantContext,
  text: string,
): MaterialRequirement[] {
  const haystack = `${ctx.userText} ${text}`;
  const list: MaterialRequirement[] = [
    {
      type: "contract",
      entryId: ctx.entryId,
      title: "当前有效劳动合同",
      reason: "用于确认劳动关系与岗位信息。",
      currentOnly: true,
    },
    {
      type: "salary",
      entryId: ctx.entryId,
      title: "最近一个月工资记录",
      reason: "便于核对发放情况，只补缺失的月份。",
    },
  ];
  if (/HR|人事|谈话|沟通/.test(haystack))
    list.push({
      type: "hr",
      entryId: ctx.entryId,
      title: "本次 HR 沟通记录",
      reason: "沟通内容建议保留原始记录。",
    });
  if (/考勤|打卡|加班/.test(haystack))
    list.push({
      type: "attendance",
      entryId: ctx.entryId,
      title: "相关考勤记录",
      reason: "考勤与工作时长建议留一份原始记录。",
    });
  if (/项目群|移出|群聊/.test(haystack))
    list.push({
      type: "project",
      entryId: ctx.entryId,
      title: "群聊变化记录",
      reason: "群成员或权限变化建议截图留存。",
    });
  return list;
}

/** 路径 B 下按命中的信号给出的「接下来几天建议做的事」（均出自知识库原文） */
function nextSteps(triage: TextTriage): string[] {
  const ids = new Set(triage.signals.map((s) => s.id));
  const steps: string[] = [];
  if (ids.has(1) || ids.has(9))
    steps.push(
      "在弄清楚之前，先不要签写有「个人原因」「已结清」「无争议」的文件；如果必须签，可以手写加注「本人不认可上述内容，保留追究权利」。",
    );
  if (ids.has(2))
    steps.push(
      "解除通知书即使拒收，也拍照、录像或留存快递记录；账号还能登录时，先备份自己有权访问的工作记录。",
    );
  if (ids.has(3) || ids.has(4))
    steps.push("续签相关的表态与申请，尽量用书面形式（邮件 + 快递留痕）。");
  if (ids.has(5))
    steps.push("把手上还能找到的截图、导出文件集中放到自己的设备或云端。");
  if (ids.has(6) || ids.has(7))
    steps.push("时间上要特别留意：劳动仲裁时效和撤销权期间都是 1 年。");
  if (ids.has(8))
    steps.push("提出被迫解除时，理由要一次写全，每一条都要有材料对应。");
  steps.push("按时间记下：谁、什么时候、说了什么、给了什么文件。");
  return steps;
}

/** 路径 A+ 下按中风险信号给出的存证提醒（均出自知识库原文） */
const WARN_STEPS: Record<number, string> = {
  9: "HR 口头劝退时，先别急着自己写辞职信，相关对话尽量录音或事后书面确认。",
  10: "调岗降薪如果还写着「拟」，留好通知原文，之后是否实际执行也记下来。",
  11: "如果要在考核结果上签字，可以手写注明「本人不认可该考核结果」，并留一份。",
  12: "员工手册、规章制度的签收记录，自己拍照留底。",
  13: "外勤、驻店这类岗位，留下能证明实际工作的沟通与任务记录。",
  14: "收到制度征求意见稿时，在期限内书面提交异议并留存发送记录。",
  15: "加班审批单、加班时的沟通记录都留存下来。",
  16: "提成、定额、补贴这类收入的凭证尽量留全。",
};

function warnSteps(triage: TextTriage): string[] {
  return triage.signals.flatMap((s) => WARN_STEPS[s.id] ?? []);
}

/** 路径 B：先接情绪，再给事实清单、材料缺口、后续步骤与转介 */
function pathBContent(
  triage: TextTriage,
  ctx: AssistantContext,
  requirements: MaterialRequirement[],
  event?: EventInput,
): string {
  const gaps = Array.from(
    new Set(
      requirements
        .filter((r) => !requirementSatisfied(r, ctx.materials))
        .map((r) => r.title),
    ),
  );
  const lines = [
    "遇到这种事，心里发紧、委屈都很正常，先别急着怪自己。",
    "你提到的情况，可能已经触发了权益受损和证据灭失的风险，需要尽快处理。我不替你下结论，先把能做的列出来：",
  ];
  if (event)
    lines.push(`· 已记下的事实：${event.title}（${event.occurredAt}），可以在「今日整理」里核对。`);
  lines.push(
    gaps.length
      ? `· 还缺的材料：${gaps.join("、")}。`
      : "· 材料库里相关材料已经有了，记得核对是不是最新版本。",
  );
  for (const step of nextSteps(triage)) lines.push(`· ${step}`);
  lines.push(REFERRAL, EVIDENCE_LIMITS);
  return lines.join("\n");
}

/** 路径 B 补充的基础材料：劳动合同是多数主张的起点 */
const contractRequirement = (entryId: string): MaterialRequirement => ({
  type: "contract",
  entryId,
  title: "当前有效劳动合同",
  reason: "用于确认劳动关系与岗位信息。",
  currentOnly: true,
});

const withContract = (list: MaterialRequirement[], entryId: string) =>
  list.some((r) => r.type === "contract")
    ? list
    : [...list, contractRequirement(entryId)];

function crisisReply(level: CrisisLevel, triage: TextTriage): AssistantReply {
  const content =
    level === "selfharm"
      ? [
          "谢谢你愿意说出来。这些念头听起来真的很沉重，你不需要一个人扛着。",
          `如果此刻有伤害自己的想法，请先联系身边信任的人，或拨打全国心理援助热线 12356（24 小时）；如果有紧迫的危险，请立即拨打 120 或 110。`,
          "工作上的事可以先放一放，等你感觉安全一些，我们再慢慢整理。",
        ].join("\n")
      : [
          "听起来这段时间你一直在硬撑，睡不好、提不起劲，真的很辛苦。",
          `持续这么久的失眠或低落，不是「想不开」，是需要专业支持的信号。${HOTLINE}`,
          "愿意的话，也可以继续在这里说说。",
        ].join("\n");
  return {
    content,
    crisis: level,
    path: triage.path,
    signals: triage.signals.map((s) => s.id),
  };
}

/**
 * 根据用户输入生成结构化回应。
 *
 * 设计原则是**减少打扰**，并且**先接情绪再谈事实**：
 * - 危机信号优先：出现自伤念头时先给 12356，不建事件、不谈材料；
 * - 分流路径由 triage.ts 决定：A 只做情绪疏导，A+ 附带存证提醒，B 必须转介；
 * - 默认使用已有信息（日期默认就是这一天，人物从原话里抽），能整理就直接整理；
 * - 只有时间确实说不清（「前几天」）才补问一句；
 * - 一般候选直接进「今日整理」，值得及时关注的变化才在对话里给一张轻量卡片。
 */
export function buildReply(text: string, ctx: AssistantContext): AssistantReply {
  const triage = triageText(text);
  if (triage.crisis !== "none") return crisisReply(triage.crisis, triage);

  const meta = {
    path: triage.path,
    signals: triage.signals.map((s) => s.id),
  };
  const highRisk = triage.path === "B";
  const finish = (reply: AssistantReply): AssistantReply => {
    if (highRisk) return { ...meta, ...reply, referral: true };
    if (triage.path === "A+")
      return {
        ...meta,
        ...reply,
        content: [reply.content, EVIDENCE_REMINDER, ...warnSteps(triage)].join(
          "\n",
        ),
        evidenceReminder: true,
      };
    return { ...meta, ...reply };
  };
  const intent = classifyIntent(text);

  if (intent === "urgent") {
    const content =
      "听起来这件事在时间上比较紧，先深呼吸一下。我不会替你判断对错，但可以帮你把已知事实整理下来。要不要现在整理一下当前情况？一步一步来，整理完可以回到今天的记录。";
    const steps = nextSteps(triage).slice(0, -1);
    return finish({
      content: highRisk
        ? [content, ...steps.map((s) => `· ${s}`), REFERRAL].join("\n")
        : content,
      emergency: true,
    });
  }

  if (intent === "materials") {
    const requirements = baseRequirements(ctx, text);
    const existing = requirements
      .filter((r) => matchingMaterials(r, ctx.materials).length > 0)
      .map((r) => matchingMaterials(r, ctx.materials)[0].name);
    const lines: string[] = ["我先查了你的材料库。"];
    lines.push(
      existing.length
        ? `已有：${Array.from(new Set(existing)).join("、")}，这些不需要重复处理。`
        : "材料库里暂时没有可以直接复用的材料。",
    );
    const content = `${lines.join("")}\n下面只列出可能缺失的部分，按你知道的情况保存就好，不必勉强。`;
    return finish({
      content: highRisk ? `${content}\n${REFERRAL}\n${EVIDENCE_LIMITS}` : content,
      requirements,
    });
  }

  const detected = detectEvent(text, "chat", ctx.entryId, ctx.date);
  const changeRequirements = () => {
    const list = requirementsForChange(
      `${ctx.userText} ${text}`,
      ctx.entryId,
      ctx.date,
    );
    return highRisk ? withContract(list, ctx.entryId) : list;
  };

  if (detected) {
    // 已确认事件被新消息补充 → 建议追加进展，而不是新建重复事件
    const related = ctx.confirmedEvents.find((e) => e.title === detected.title);
    if (related) {
      const content = `你提到的这件事，和已经记录的「${related.title}」看起来是同一件。要不要把这次的补充作为进展追加进去？我不会自动改写已确认的内容。`;
      return finish({
        content: highRisk ? `${content}\n${REFERRAL}` : content,
        updateSuggestionEventId: related.id,
      });
    }
    // 时间说不清才补问，而且只问这一句；高风险时把转介作为陈述附在后面
    const occurredAt = resolveDate(text, ctx.date);
    if (!occurredAt) {
      const content =
        "这件事大概发生在哪一天？说个大概就行（例如「昨天」「就按今天」），我按你说的记。";
      return {
        ...meta,
        content: highRisk
          ? `${content}\n另外，这类情况${REFERRAL.replace(/^建议/, "建议你")}`
          : content,
        clarify: detected,
        ...(highRisk ? { referral: true } : {}),
      };
    }
    const draft: EventInput = {
      ...detected,
      occurredAt,
      people: parsePeople(text),
    };
    const requirements = changeRequirements();
    if (ctx.draftTitles.includes(detected.title)) {
      const content =
        "这件事今天已经有一条在「今日整理」里了，我不再重复生成。需要的话可以在那里确认或编辑。";
      return finish({
        content: highRisk ? `${content}\n${REFERRAL}` : content,
        requirements,
      });
    }
    const noteworthy = draft.attention !== "normal";
    return finish({
      content: highRisk
        ? pathBContent(triage, ctx, requirements, draft)
        : noteworthy
          ? "听起来是个值得留意的变化，换谁遇到都会有点不踏实。我先用现有信息整理了一条，要不要单独记下来？也可以先放着，之后在「今日整理」里处理。"
          : "我记下了一条，放在「今日整理」里，需要的时候再确认就好。",
      candidateEvent: draft,
      noteworthy,
      requirements,
    });
  }

  if (highRisk) {
    const requirements = changeRequirements();
    return finish({
      content: pathBContent(triage, ctx, requirements),
      requirements,
    });
  }

  if (intent === "emotion") {
    if (POSITIVE.test(text) && !NEGATIVE.test(text))
      return finish({
        content: "真好，这样的日子也值得记下来。想多说两句也可以。",
      });
    const methods = copingMethods(text);
    return finish({
      content: [
        "听起来今天挺消耗的，这种感受是真实的。不需要每一次都发生特别的事才值得说，我会把你说的记在这里。",
        "想缓一缓的话，可以挑一件马上能做的：",
        ...methods.map((id) => `· ${COPING[id]}`),
        "不想做也没关系，想继续说我都在。",
      ].join("\n"),
      methods,
    });
  }

  return finish({
    content:
      triage.path === "A+"
        ? "听起来这件事让你心里不太踏实，有这种感受很正常，这不等于否定你这个人。"
        : "我记下了。如果愿意，可以再说得具体一点，比如发生了什么、涉及谁、大概什么时候。",
  });
}

/**
 * few-shot 与测试使用的「应触发的 suggestion 类型」。
 * 只看结构化字段，不看措辞，方便对照规则层与模型输出。
 */
export type SuggestionKind =
  | "coping_methods"
  | "candidate_event"
  | "clarify"
  | "materials"
  | "emergency"
  | "append_update"
  | "evidence_reminder"
  | "referral"
  | "crisis_hotline";

export function replyKinds(
  reply: AssistantReply,
  materials: Material[] = [],
): SuggestionKind[] {
  const kinds: SuggestionKind[] = [];
  if (reply.crisis && reply.crisis !== "none") kinds.push("crisis_hotline");
  if (reply.methods?.length) kinds.push("coping_methods");
  if (reply.candidateEvent) kinds.push("candidate_event");
  if (reply.clarify) kinds.push("clarify");
  if (reply.requirements?.some((r) => !requirementSatisfied(r, materials)))
    kinds.push("materials");
  if (reply.emergency) kinds.push("emergency");
  if (reply.updateSuggestionEventId) kinds.push("append_update");
  if (reply.evidenceReminder) kinds.push("evidence_reminder");
  if (reply.referral) kinds.push("referral");
  return kinds;
}

/** 用当天的状态与用户原文生成一段模拟总结（与原文分开保存） */
export function buildSummary(
  status: Partial<DailyStatusInput>,
  userText: string,
): string {
  const parts: string[] = [];
  if (status.mood)
    parts.push(`今天的你感到${MOODS[status.mood as Mood].label}`);
  const head = parts.length ? `${parts.join("，")}。` : "";
  const body = userText
    ? "已按关键词整理候选事件，请核对原文后再确认。"
    : "不需要每一天都发生特别的事，记录感受本身也有意义。";
  return `模拟 AI：${head}愿记录帮你看见自己的节奏。${body}`;
}

export type AiMode = "llm" | "rules";
let mode: AiMode = "rules";
/** 界面上的 AI 标识：接了真实模型显示「AI」，规则模板显示「模拟 AI」 */
export const aiLabel = () => (mode === "llm" ? "AI" : "模拟 AI");

/** 规则模式下保留「演示设置」里的模拟延迟；任何模式都支持「下一次失败」 */
const prepare = async (config: MockConfig) => {
  if (mode === "rules") return simulate(config);
  if (config.failNext)
    throw new Error("模拟服务暂时没有回应，你的输入仍然保留。请重试。");
};

const post = <T>(path: string, body: unknown) =>
  apiJSON<T>(path, { method: "POST", body: JSON.stringify(body) });

export const aiService = {
  /** 启动时读取服务端是否接了真实模型，用于界面上的 AI 标识 */
  async init() {
    const health = await apiJSON<{ ai: AiMode }>("/health", {}, false);
    mode = health.ai;
  },
  async reply(text: string, ctx: AssistantContext, config: MockConfig) {
    await prepare(config);
    return post<AssistantReply>("/ai/reply", { text, ctx });
  },
  async summarize(
    status: Partial<DailyStatusInput>,
    userText: string,
    config: MockConfig,
  ) {
    await prepare(config);
    const { summary } = await post<{ summary: string }>("/ai/summarize", {
      status,
      userText,
    });
    return summary;
  },
  async extract(file: File, config: MockConfig) {
    await prepare(config);
    const isText = file.name.toLowerCase().endsWith(".txt");
    const { text } = await post<{ text: string }>("/ai/extract", {
      name: file.name,
      type: file.type,
      text: isText ? (await file.text()).slice(0, 20000) : undefined,
    });
    return text;
  },
};
