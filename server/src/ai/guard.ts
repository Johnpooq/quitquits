import type { AssistantReply } from "../../../src/services/ai";
import { HOTLINE, REFERRAL } from "../../../src/services/triage";

/** 结论性、越界或替用户做决定的表述 */
export const BANNED =
  /公司违法|属于违法|构成违法|违法解除|违法辞退|一定能赢|一定会赢|肯定能赢|一定输|稳赢|必胜|胜诉率|必须辞职|应该辞职|赶紧辞职|你必须离职/;
const CASE_NO = /（\s*\d{4}\s*）[^（）\n]{1,16}?号/g;
const STATUTE =
  /《[^》]{2,30}》\s*第\s*[一二三四五六七八九十百零\d]+\s*条|第\s*[一二三四五六七八九十百零\d]+\s*条/g;

const squash = (s: string) => s.replace(/\s+/g, "");

export interface GuardResult {
  content: string;
  /** 模型输出不合格，改用规则模板 */
  fallback: boolean;
  reason?: string;
}

/** 有没有编造知识库之外的案号或法条 */
export function unknownReferences(text: string, corpus: string): string[] {
  return [
    ...(text.match(CASE_NO) ?? []),
    ...(text.match(STATUTE) ?? []),
  ].filter((ref) => !corpus.includes(squash(ref)));
}

/**
 * 模型回复的安全兜底：
 * - 出现结论性表述、编造案号法条、补问超过一句、过长 → 改用规则模板；
 * - 高风险缺转介、危机缺 12356 → 在末尾补上。
 */
export function guardReply(
  candidate: string,
  rules: AssistantReply,
  corpus: string,
): GuardResult {
  const text = candidate.trim();
  const reject = (reason: string): GuardResult => ({
    content: rules.content,
    fallback: true,
    reason,
  });
  if (!text) return reject("empty");
  if (BANNED.test(text)) return reject("banned");
  if (unknownReferences(text, corpus).length) return reject("reference");
  if (text.length > 700) return reject("too_long");
  if (rules.clarify && (text.match(/[？?]/g)?.length ?? 0) > 1)
    return reject("clarify");
  let content = text;
  if (rules.crisis && rules.crisis !== "none" && !content.includes("12356"))
    content += `\n${HOTLINE}`;
  if (
    rules.referral &&
    !(/律师/.test(content) && /仲裁/.test(content) && /法律援助/.test(content))
  )
    content += `\n${REFERRAL}`;
  return { content, fallback: false };
}

/** 总结与提取：只做禁用表述检查，不合格就用规则结果 */
export function guardText(candidate: string, fallback: string, corpus: string) {
  const text = candidate.trim();
  if (
    !text ||
    BANNED.test(text) ||
    unknownReferences(text, corpus).length ||
    text.length > 2000
  )
    return fallback;
  return text;
}
