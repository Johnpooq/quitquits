import { describe, expect, it } from "vitest";
import {
  MAX_SCORE,
  QUESTIONS,
  RED_LINES,
  detectCrisis,
  pathFor,
  scoreAnswers,
  triageText,
  type Answers,
} from "../src/services/triage";
import {
  buildReply,
  replyKinds,
  type AssistantContext,
} from "../src/services/ai";

/** 某道题选第 n 个选项（0 起） */
const pick = (pairs: Record<string, number>): Answers => pairs;
/** 除红线题外，按给定分值填满题目，用来凑出指定总分 */
const allZero = (): Answers =>
  Object.fromEntries(QUESTIONS.map((q) => [q.id, 0]));

describe("问卷结构", () => {
  it("共 20 题、满分 40 分，Q1 不计分", () => {
    expect(QUESTIONS).toHaveLength(20);
    expect(MAX_SCORE).toBe(40);
    expect(QUESTIONS[0].options.every((o) => o.score === 0)).toBe(true);
  });

  it("六条红线 R1–R6 都有对应的题目选项", () => {
    expect(Object.keys(RED_LINES)).toEqual([
      "R1",
      "R2",
      "R3",
      "R4",
      "R5",
      "R6",
    ]);
    const used = new Set(
      QUESTIONS.flatMap((q) => q.options.map((o) => o.redLine)).filter(Boolean),
    );
    expect([...used].sort()).toEqual(["R1", "R2", "R3", "R4", "R5", "R6"]);
  });

  it("各模块分值范围与原文一致：事实 12、文书 10、证据 12、时效 6", () => {
    const max = (module: string) =>
      QUESTIONS.filter((q) => q.module === module).reduce(
        (s, q) => s + Math.max(...q.options.map((o) => o.score)),
        0,
      );
    expect(max("fact")).toBe(12);
    expect(max("document")).toBe(10);
    expect(max("evidence")).toBe(12);
    expect(max("timing")).toBe(6);
  });

  it("全选最高分时总分正好是 40", () => {
    const answers = Object.fromEntries(
      QUESTIONS.map((q) => [q.id, q.options.length - 1]),
    );
    const result = scoreAnswers(answers);
    expect(result.total).toBe(40);
    expect(result.redLines).toEqual(["R1", "R2", "R3", "R4", "R5", "R6"]);
    expect(result.path).toBe("B");
  });
});

describe("计分与分流阈值", () => {
  it("0–5 分且无红线 → 路径 A", () => {
    expect(pathFor(0, [])).toBe("A");
    expect(pathFor(5, [])).toBe("A");
  });
  it("6–11 分且无红线 → 路径 A+", () => {
    expect(pathFor(6, [])).toBe("A+");
    expect(pathFor(11, [])).toBe("A+");
  });
  it("≥12 分 → 路径 B", () => {
    expect(pathFor(12, [])).toBe("B");
    expect(pathFor(40, [])).toBe("B");
  });
  it("命中任一红线，0 分也直接判定路径 B", () => {
    expect(pathFor(0, ["R4"])).toBe("B");
  });

  it("全部选第一个选项：0 分，路径 A", () => {
    const r = scoreAnswers(allZero());
    expect(r.total).toBe(0);
    expect(r.path).toBe("A");
    expect(r.unanswered).toEqual([]);
  });

  it("5 分（证据模块各缺一部分）仍是路径 A，6 分进入 A+", () => {
    const five = scoreAnswers({
      ...allZero(),
      ...pick({ Q12: 1, Q13: 1, Q14: 1, Q15: 1, Q16: 1 }),
    });
    expect(five.total).toBe(5);
    expect(five.modules.evidence).toBe(5);
    expect(five.path).toBe("A");
    const six = scoreAnswers({
      ...allZero(),
      ...pick({ Q12: 1, Q13: 1, Q14: 1, Q15: 1, Q16: 1, Q17: 1 }),
    });
    expect(six.total).toBe(6);
    expect(six.path).toBe("A+");
  });

  it("11 分是 A+ 的上限，12 分进入 B（不含红线）", () => {
    const eleven = scoreAnswers({
      ...allZero(),
      ...pick({ Q4: 2, Q5: 2, Q6: 2, Q12: 2, Q13: 2, Q14: 1 }),
    });
    expect(eleven.total).toBe(11);
    expect(eleven.redLines).toEqual([]);
    expect(eleven.path).toBe("A+");
    const twelve = scoreAnswers({
      ...allZero(),
      ...pick({ Q4: 2, Q5: 2, Q6: 2, Q12: 2, Q13: 2, Q14: 2 }),
    });
    expect(twelve.total).toBe(12);
    expect(twelve.path).toBe("B");
  });

  it.each([
    ["Q8", 2, "R1", 3],
    ["Q2", 2, "R2", 2],
    ["Q3", 2, "R2", 2],
    ["Q9", 2, "R3", 3],
    ["Q18", 2, "R4", 2],
    ["Q19", 2, "R5", 2],
    ["Q20", 2, "R6", 2],
  ] as const)("%s 选红线选项 → %s，路径 B", (id, option, line, score) => {
    const r = scoreAnswers({ ...allZero(), [id]: option });
    expect(r.redLines).toEqual([line]);
    expect(r.total).toBe(score);
    expect(r.path).toBe("B");
  });

  it("签过但手写了保留意见不算红线", () => {
    const r = scoreAnswers({ ...allZero(), Q8: 1 });
    expect(r.redLines).toEqual([]);
    expect(r.modules.document).toBe(1);
  });

  it("Q1 选 D / E 时紧迫度最高，但不改变分数", () => {
    const d = scoreAnswers({ ...allZero(), Q1: 3 });
    expect(d.urgentFirst).toBe(true);
    expect(d.situation?.tag).toBe("已解除");
    expect(d.total).toBe(0);
    expect(scoreAnswers({ ...allZero(), Q1: 0 }).urgentFirst).toBe(false);
  });

  it("未作答的计分题按 0 分并列出，选项越界直接报错", () => {
    const r = scoreAnswers({ Q2: 1 });
    expect(r.total).toBe(1);
    expect(r.unanswered).toHaveLength(18);
    expect(() => scoreAnswers({ Q2: 3 })).toThrow();
  });
});

describe("对话快速扫描（18 条风险信号）", () => {
  it.each([
    ["被劝退了，HR 让我写个人原因", "B", [1, 9]],
    ["收到书面解除通知了", "B", [2]],
    ["我在续签意向表上写了不愿续签", "B", [3]],
    ["账号被停用了，资料我也没备份", "B", [5]],
    ["我离职已经一年多了，还能要回加班费吗", "B", [6]],
    ["HR 口头劝退，让我自己写辞职信", "A+", [9]],
    ["这次绩效考核给了我不合格", "A+", [11]],
    ["公司在 OA 上发了个征求意见稿", "A+", [14]],
    ["经常加班，但是没有审批单", "A+", [15]],
    ["今天挺正常的", "A", []],
    ["合同和 offer 原件都在", "A", [17]],
  ] as const)("「%s」→ 路径 %s", (text, path, ids) => {
    const r = triageText(text);
    expect(r.path).toBe(path);
    expect(r.signals.map((s) => s.id)).toEqual(ids);
  });

  it("识别危机信号：自伤念头与持续症状", () => {
    expect(detectCrisis("有时候觉得不想活了")).toBe("selfharm");
    expect(detectCrisis("已经失眠两周了")).toBe("persistent");
    expect(detectCrisis("今天好累")).toBe("none");
  });
});

const ctx = (over: Partial<AssistantContext> = {}): AssistantContext => ({
  date: "2026-10-12",
  entryId: "entry1",
  userText: "",
  confirmedEvents: [],
  draftTitles: [],
  materials: [],
  ...over,
});

describe("分流结果驱动 AI 回复", () => {
  it("只说累：路径 A，给 2–3 条方法，不建事件", () => {
    const r = buildReply("今天好累", ctx());
    expect(r.path).toBe("A");
    expect(r.methods?.length).toBeGreaterThanOrEqual(2);
    expect(r.methods?.length).toBeLessThanOrEqual(3);
    expect(r.candidateEvent).toBeUndefined();
    expect(replyKinds(r)).toEqual(["coping_methods"]);
  });

  it("开心的日子不塞情绪疏导方法", () => {
    const r = buildReply("今天挺开心的", ctx());
    expect(r.methods).toBeUndefined();
  });

  it("被劝退写个人原因：路径 B，先接情绪，再列材料缺口与转介", () => {
    const r = buildReply("被劝退了，HR 让我写个人原因", ctx());
    expect(r.path).toBe("B");
    expect(r.referral).toBe(true);
    expect(r.candidateEvent?.attention).toBe("priority");
    const [first] = r.content.split("\n");
    expect(first).not.toMatch(/律师|材料|证据|建议/);
    expect(r.content).toContain("还缺的材料");
    expect(r.content).toMatch(/执业律师/);
    expect(r.content).toMatch(/劳动人事争议仲裁委员会/);
    expect(r.content).toMatch(/法律援助中心/);
    expect(r.content).toMatch(/不要非法侵入公司系统/);
  });

  it("材料库已有的材料不出现在缺口里", () => {
    const r = buildReply(
      "被劝退了，HR 让我写个人原因",
      ctx({
        materials: [
          {
            id: "m1",
            name: "劳动合同",
            type: "contract",
            status: "uploaded",
            isCurrent: true,
            eventIds: [],
            extractionStatus: "none",
            createdAt: "",
            updatedAt: "",
          },
        ],
      }),
    );
    const gaps = r.content.split("\n").find((l) => l.includes("还缺的材料"));
    expect(gaps).not.toContain("劳动合同");
  });

  it("自伤念头：给 12356，不建事件、不谈材料", () => {
    const r = buildReply("真的不想活了", ctx());
    expect(r.crisis).toBe("selfharm");
    expect(r.content).toContain("12356");
    expect(r.candidateEvent).toBeUndefined();
    expect(r.requirements).toBeUndefined();
    expect(replyKinds(r)).toEqual(["crisis_hotline"]);
  });

  it("持续失眠：建议寻求专业帮助并给出 12356", () => {
    const r = buildReply("已经失眠两周了，每天都很焦虑", ctx());
    expect(r.crisis).toBe("persistent");
    expect(r.content).toContain("12356");
  });

  it("中风险信号：路径 A+，附带「现在就开始存证据」的提醒", () => {
    const r = buildReply("这次绩效考核给了我不合格", ctx());
    expect(r.path).toBe("A+");
    expect(r.evidenceReminder).toBe(true);
    expect(r.content).toContain("存证据");
    expect(r.referral).toBeUndefined();
  });

  it("高风险但时间说不清：仍只问一句，并附上转介", () => {
    const r = buildReply("前几天被劝退了，还让我写个人原因", ctx());
    expect(r.clarify).toBeDefined();
    expect(r.referral).toBe(true);
    expect(r.content.match(/？/g)).toHaveLength(1);
    expect(r.content).toContain("执业律师");
  });

  it("所有回复都不出现结论性或越界表述", () => {
    const inputs = [
      "今天好累",
      "被劝退了，HR 让我写个人原因",
      "收到书面解除通知了",
      "HR 要求我今天就签离职协议，上面写着个人原因",
      "我离职已经一年多了",
      "真的不想活了",
    ];
    for (const text of inputs)
      expect(buildReply(text, ctx()).content).not.toMatch(
        /公司违法|一定能赢|一定会赢|必须辞职|应该辞职|稳赢|一定输/,
      );
  });
});
