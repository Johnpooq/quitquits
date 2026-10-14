/**
 * 风险评估问卷与分流规则，来自 knowledge/risk-assessment.md。
 *
 * 规则写成代码而不是只留在 prompt 里：分流结果由这里决定，
 * 模型只负责在既定路径下组织语言，不能改变路径、红线与转介要求。
 *
 * 与原文的一处差异：原文 Q9 的红线选项标注为 [2 · 红线 R3]，
 * 但模块三表头写的是「0 / 1 / 3 分，含红线」，且按原文分值加总只有 39 分，
 * 与「满分 40 分」不一致。这里按模块三表头把 Q9 的红线选项记为 3 分，满分 40。
 * 由于命中任一红线都直接判定路径 B，这一分之差不影响分流结果。
 */

export type TriagePath = "A" | "A+" | "B";
export type RedLine = "R1" | "R2" | "R3" | "R4" | "R5" | "R6";
export type QuestionModule =
  "situation" | "fact" | "document" | "evidence" | "timing";

export interface QuestionOption {
  label: string;
  score: number;
  redLine?: RedLine;
}
export interface Question {
  id: string;
  module: QuestionModule;
  text: string;
  options: QuestionOption[];
}

const opts = (
  labels: [string, string, string],
  scores: [number, number, number] = [0, 1, 2],
  redLine?: RedLine,
): QuestionOption[] =>
  labels.map((label, i) => ({
    label,
    score: scores[i],
    ...(i === 2 && redLine ? { redLine } : {}),
  }));

export const SITUATIONS = [
  { label: "还在职，只是有些摩擦、心里不太踏实", tag: "摩擦期", urgency: 1 },
  {
    label: "正在被约谈、被劝退，或被要求「自己写个辞职信」",
    tag: "施压期",
    urgency: 2,
  },
  {
    label: "已经签了离职文件或已经离职，但对结果不满意",
    tag: "回溯期",
    urgency: 2,
  },
  {
    label: "已经收到解除通知，或被停岗停薪、被移出工作群和系统",
    tag: "已解除",
    urgency: 3,
  },
  { label: "已经进入仲裁或诉讼程序", tag: "争议中", urgency: 3 },
] as const;

export const QUESTIONS: Question[] = [
  {
    id: "Q1",
    module: "situation",
    text: "你现在和公司的关系，大概处于哪一步？",
    options: SITUATIONS.map((s) => ({ label: s.label, score: 0 })),
  },
  {
    id: "Q2",
    module: "fact",
    text: "公司是否已经用书面形式通知你解除劳动合同？",
    options: opts(
      ["没有", "口头说过但无书面文件", "有书面解除通知书"],
      [0, 1, 2],
      "R2",
    ),
  },
  {
    id: "Q3",
    module: "fact",
    text: "公司是否已经停止你正常上班？（收回权限、移出群、不排班、让你先休息）",
    options: opts(
      ["没有", "有过类似要求但工资照发", "是，且已停发工资或停缴社保"],
      [0, 1, 2],
      "R2",
    ),
  },
  {
    id: "Q4",
    module: "fact",
    text: "公司是否向你提出过调岗、降薪或变更工作地点？",
    options: opts([
      "没有",
      "提过但还没实际执行",
      "已经实际执行，岗位变了或工资少了",
    ]),
  },
  {
    id: "Q5",
    module: "fact",
    text: "公司是否以违纪、绩效不合格、不能胜任工作为由，对你作出过处罚或考核结论？",
    options: opts(["没有", "有处罚但未升级到解除", "有，且已作为解除理由"]),
  },
  {
    id: "Q6",
    module: "fact",
    text: "公司是否要求过你「自己写辞职信」，或让你写「个人原因」？",
    options: opts(["没有", "暗示过", "明确要求过"]),
  },
  {
    id: "Q7",
    module: "fact",
    text: "如果是合同到期情形：公司是否给过你「不续签」或「终止」的通知？",
    options: opts(["不适用", "收到过但理由含糊", "收到明确的不再续签通知"]),
  },
  {
    id: "Q8",
    module: "document",
    text: "你是否签过任何写着「个人原因离职」「双方已结清」「无任何经济纠纷」「自愿放弃」字样的文件？",
    options: opts(
      ["没签过", "签过但手写了保留意见", "签过且无任何保留"],
      [0, 1, 3],
      "R1",
    ),
  },
  {
    id: "Q9",
    module: "document",
    text: "你是否在任何文件上书面表达过「不愿续签」「同意解除」「接受调整」？",
    // 原文标注为 2 分，这里按模块三表头记 3 分（见文件头注释）
    options: opts(
      ["没有", "有但当时有可解释的语境", "有且表达明确"],
      [0, 1, 3],
      "R3",
    ),
  },
  {
    id: "Q10",
    module: "document",
    text: "你手里是否有加盖公章、有经办人签字的书面协议原件？",
    options: opts(["有原件", "只有复印件或照片", "什么都没有，被公司收走了"]),
  },
  {
    id: "Q11",
    module: "document",
    text: "公司给出的解除理由，有没有书面文件写清楚？",
    options: opts(["有且写明具体理由", "只有口头通知", "连理由都没说清"]),
  },
  {
    id: "Q12",
    module: "evidence",
    text: "入职时的录用通知书、以及每一份劳动合同原件，你还留着吗？",
    options: opts(["都有", "只有部分", "都没有"]),
  },
  {
    id: "Q13",
    module: "evidence",
    text: "完整的工资条、银行流水、个税 APP 记录，你留了吗？",
    options: opts(["都有且连续", "只有部分月份", "没有"]),
  },
  {
    id: "Q14",
    module: "evidence",
    text: "收到调岗、降薪、处罚通知时，你是否书面回复过「不同意」？",
    options: opts(["回复过并留了发送记录", "只在嘴上说过", "什么都没做"]),
  },
  {
    id: "Q15",
    module: "evidence",
    text: "与领导、HR 的关键沟通（劝退、先休息、让你写个人原因），有没有录音或事后书面确认？",
    options: opts(["有录音或书面确认", "有零散聊天记录", "完全没有"]),
  },
  {
    id: "Q16",
    module: "evidence",
    text: "考勤记录、OA 记录、企业微信或钉钉聊天，你导出备份过吗？",
    options: opts([
      "已备份到自己设备或云端",
      "只有零散截图",
      "全在公司系统里，手上没有",
    ]),
  },
  {
    id: "Q17",
    module: "evidence",
    text: "公司的员工手册，你签收过吗？手上有没有当时签收的版本？",
    options: opts(["签收过且留了版本", "签过但没留底", "从没签收也没见过"]),
  },
  {
    id: "Q18",
    module: "timing",
    text: "从你离职或被解除到现在，过了多久？",
    options: opts(
      ["不到 1 年", "接近 1 年（9 个月以上）", "已超过 1 年"],
      [0, 1, 2],
      "R4",
    ),
  },
  {
    id: "Q19",
    module: "timing",
    text: "如涉及主张协议被欺诈或胁迫而撤销，从签协议到现在过了多久？",
    options: opts(["不到 1 年", "接近 1 年", "已超过 1 年"], [0, 1, 2], "R5"),
  },
  {
    id: "Q20",
    module: "timing",
    text: "工作邮箱、企业微信、钉钉、OA 这些账号，现在还能登录吗？",
    options: opts(
      [
        "都还能登录且资料还在",
        "部分已被停用",
        "账号已被收回，数据无法访问且未备份",
      ],
      [0, 1, 2],
      "R6",
    ),
  },
];

export const RED_LINES: Record<RedLine, string> = {
  R1: "已签署含「个人原因 / 已结清 / 无争议 / 自愿放弃」且无保留意见的文件",
  R2: "已收到书面解除通知，或已被停岗停薪",
  R3: "已书面表态「不愿续签 / 同意终止 / 接受调整」",
  R4: "距离离职或解除已超过 1 年",
  R5: "距签署争议协议已超过 1 年",
  R6: "关键证据载体已被关闭或删除且无备份",
};

/** 分流阈值：0–5 → A，6–11 → A+，≥12 或命中红线 → B */
export const THRESHOLDS = { warn: 6, high: 12 } as const;

export const MAX_SCORE = QUESTIONS.reduce(
  (sum, q) => sum + Math.max(...q.options.map((o) => o.score)),
  0,
);

/** 答案：题号 → 选项下标（0 起）。未作答的题按 0 分计，并在结果里列出 */
export type Answers = Partial<Record<string, number>>;

export interface ScoreResult {
  total: number;
  modules: Record<Exclude<QuestionModule, "situation">, number>;
  redLines: RedLine[];
  path: TriagePath;
  /** Q1 的处境标签与紧迫度；选 D / E 时紧迫度直接最高 */
  situation?: (typeof SITUATIONS)[number];
  urgentFirst: boolean;
  unanswered: string[];
}

export function pathFor(total: number, redLines: RedLine[]): TriagePath {
  if (redLines.length > 0 || total >= THRESHOLDS.high) return "B";
  if (total >= THRESHOLDS.warn) return "A+";
  return "A";
}

export function scoreAnswers(answers: Answers): ScoreResult {
  const modules = { fact: 0, document: 0, evidence: 0, timing: 0 };
  const redLines = new Set<RedLine>();
  const unanswered: string[] = [];
  for (const q of QUESTIONS) {
    const index = answers[q.id];
    if (index === undefined) {
      if (q.module !== "situation") unanswered.push(q.id);
      continue;
    }
    const option = q.options[index];
    if (!option) throw new Error(`${q.id} 没有第 ${index + 1} 个选项`);
    if (q.module === "situation") continue;
    modules[q.module] += option.score;
    if (option.redLine) redLines.add(option.redLine);
  }
  const total =
    modules.fact + modules.document + modules.evidence + modules.timing;
  const lines = [...redLines].sort();
  const situation =
    answers.Q1 === undefined ? undefined : SITUATIONS[answers.Q1];
  return {
    total,
    modules,
    redLines: lines,
    path: pathFor(total, lines),
    situation,
    urgentFirst: (situation?.urgency ?? 0) >= 3,
    unanswered,
  };
}

/* ---------------- 对话里的快速扫描（第五节 18 条风险信号） ---------------- */

export type SignalLevel = "high" | "medium" | "low";
export interface Signal {
  id: number;
  level: SignalLevel;
  label: string;
  test: (text: string) => boolean;
}

const re = (pattern: RegExp) => (t: string) => pattern.test(t);
const both = (a: RegExp, b: RegExp) => (t: string) => a.test(t) && b.test(t);
const OVER_A_YEAR = "(一年多|超过一年|超过 ?1 ?年|1 ?年多|一年以上|两年|2 ?年)";

export const SIGNALS: Signal[] = [
  {
    id: 1,
    level: "high",
    label: "被要求或已签署写有「个人原因离职」「已结清」「无任何争议」的文件",
    test: re(
      /(签|写|填).{0,12}(个人原因|已结清|结清|无任何争议|无争议|自愿放弃)|(个人原因|已结清|无任何争议|无争议|自愿放弃).{0,10}(签|写|填)/,
    ),
  },
  {
    id: 2,
    level: "high",
    label: "已收到书面解除通知，或已被停岗、停薪、移出系统",
    test: re(
      /解除通知|辞退通知|被通知解除|停岗|停薪|停发工资|停缴社保|移出(了)?(系统|OA)|系统.{0,4}(权限)?.{0,4}(被)?(关|收回|停用)/,
    ),
  },
  {
    id: 3,
    level: "high",
    label: "合同到期，自己已在文件上写过「不愿续签」",
    test: re(/(写|签|填).{0,8}不(愿|想)续签|不(愿|想)续签.{0,8}(写|签|填)/),
  },
  {
    id: 4,
    level: "high",
    label:
      "连续签过两次固定期限合同，公司以「合同期满」终止，而你从未书面提出续订",
    test: both(
      /连续.{0,6}(两次|2 ?次|二次|两份).{0,10}(合同|固定期限)/,
      /(期满|到期).{0,8}终止|终止/,
    ),
  },
  {
    id: 5,
    level: "high",
    label: "工作账号被停用、被踢出工作群、系统数据被删，且你手上没有备份",
    test: both(
      /(账号|账户).{0,6}(停用|被停|收回|注销|关闭)|踢出.{0,4}群|数据.{0,4}(被删|删除|清空)/,
      /没(有)?备份|未备份|没存|没留/,
    ),
  },
  {
    id: 6,
    level: "high",
    label: "距离离职或被解除已超过 1 年",
    test: re(
      new RegExp(
        `(离职|解除|辞退|开除).{0,10}${OVER_A_YEAR}|${OVER_A_YEAR}前.{0,8}(离职|解除|辞退|开除)`,
      ),
    ),
  },
  {
    id: 7,
    level: "high",
    label: "距离签署有争议的解除协议已超过 1 年",
    test: re(
      new RegExp(
        `签.{0,10}协议.{0,10}${OVER_A_YEAR}|${OVER_A_YEAR}前.{0,8}签.{0,6}协议`,
      ),
    ),
  },
  {
    id: 8,
    level: "high",
    label: "提出「被迫解除」时只写了单一理由，事后才想补充",
    test: both(/被迫(解除|离职)/, /只写了|只提了|只写|想补充|再补/),
  },
  {
    id: 9,
    level: "medium",
    label: "HR 口头劝退、让你「自己写辞职信」",
    test: re(
      /劝退|劝离|(让|要|叫)我.{0,6}(自己)?(写|交|提).{0,4}(辞职|离职)|主动辞职/,
    ),
  },
  {
    id: 10,
    level: "medium",
    label: "调岗降薪「已通知但没实际执行」（文件还写着「拟」）",
    test: re(
      /(调岗|降薪).{0,10}(还没|没有|尚未|未).{0,4}(执行|落实|实施)|拟(调岗|降薪)/,
    ),
  },
  {
    id: 11,
    level: "medium",
    label: "收到处罚或考核通知，但你没有书面提异议",
    test: re(
      /处罚|处分|警告|PIP|绩效改进|(考核|绩效).{0,8}(不合格|不达标|不胜任|垫底)/,
    ),
  },
  {
    id: 12,
    level: "medium",
    label: "公司制度你从没签收过，或签收版本没留底",
    test: re(
      /(员工手册|规章制度|公司制度).{0,10}(没签|没有签|从没|没见过|没留|没有留)/,
    ),
  },
  {
    id: 13,
    level: "medium",
    label: "你的岗位特殊，打卡记录不能反映真实工作（外勤、仓库、驻店）",
    test: re(
      /(外勤|仓库|驻店|驻场).{0,20}(打卡|考勤|定位)|(打卡|考勤|定位).{0,20}(外勤|仓库|驻店|驻场)/,
    ),
  },
  {
    id: 14,
    level: "medium",
    label: "公司通过 OA 或邮件发布制度「征求意见稿」",
    test: re(/征求意见稿/),
  },
  {
    id: 15,
    level: "medium",
    label: "加班很多，但没有任何加班审批单或工作痕迹",
    test: both(/加班/, /没(有)?.{0,4}(审批|加班单|记录|痕迹)/),
  },
  {
    id: 16,
    level: "medium",
    label: "收入结构复杂（提成、定额、补贴），但没有留存完整凭证",
    test: both(
      /提成|定额|补贴/,
      /没(有)?.{0,4}(留|保存|凭证|记录)|未.{0,2}留存/,
    ),
  },
  {
    id: 17,
    level: "low",
    label: "劳动合同、offer 原件齐全，工资流水连续完整，社保正常",
    test: re(/(合同|offer|Offer).{0,10}(都在|齐全|原件都)/),
  },
  {
    id: 18,
    level: "low",
    label: "关键沟通有录音或书面留痕，收到不利通知后都做过书面异议",
    test: re(/有录音|录了音|录音了|书面(回复|提出|提了).{0,6}(不同意|异议)/),
  },
];

export type CrisisLevel = "none" | "persistent" | "selfharm";

const SELF_HARM =
  /不想活|活不下去|想死|去死|轻生|自杀|自残|伤害自己|结束(自己的)?生命|活着没(有)?意思|跳楼|割腕|离开这个世界/;
const PERSISTENT =
  /(失眠|睡不着|情绪低落|吃不下).{0,8}(两周|两个星期|半个月|一个月|好几周|几个星期)|(两周|两个星期|半个月|一个月|好几周).{0,10}(失眠|睡不着|情绪低落|吃不下)|无法正常(工作|生活)/;

/** 危机信号：自伤念头必须给出 12356；持续症状建议寻求专业帮助 */
export function detectCrisis(text: string): CrisisLevel {
  if (SELF_HARM.test(text)) return "selfharm";
  if (PERSISTENT.test(text)) return "persistent";
  return "none";
}

export interface TextTriage {
  path: TriagePath;
  signals: { id: number; level: SignalLevel; label: string }[];
  crisis: CrisisLevel;
}

/**
 * 用户一开口先做的快速扫描：命中任一高风险信号 → 路径 B；
 * 命中中风险信号 → 路径 A+；否则路径 A。低风险信号只用于正反馈。
 */
export function triageText(text: string): TextTriage {
  const signals = SIGNALS.filter((s) => s.test(text)).map(
    ({ id, level, label }) => ({ id, level, label }),
  );
  const path: TriagePath = signals.some((s) => s.level === "high")
    ? "B"
    : signals.some((s) => s.level === "medium")
      ? "A+"
      : "A";
  return { path, signals, crisis: detectCrisis(text) };
}

/** 路径 B 必须出现的转介指引（原文 1.2「必转介」） */
export const REFERRAL =
  "建议尽快咨询执业律师、当地劳动人事争议仲裁委员会或当地法律援助中心，由专业人士结合你的具体材料判断。";
/** 原文 1.2「有警示」：取证的法律限制与人身安全边界 */
export const EVIDENCE_LIMITS =
  "保存材料时请只用自己有权访问的内容：不要非法侵入公司系统、不要拿走商业秘密、不要伪造或改动证据；如果遇到威胁、跟踪或暴力，请优先报警。";
/** 情绪疏导建议第 21、22 条 */
export const HOTLINE =
  "全国心理援助热线 12356（24 小时）可以随时打；也可以去当地精神卫生中心的心理门诊，或找心理咨询师、精神科医生聊一聊。";
