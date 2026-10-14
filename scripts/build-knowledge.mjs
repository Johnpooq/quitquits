// 把 docs/source/*.docx 转成 knowledge/*.md（需要本机安装 pandoc）。
// 只做格式清理，不改写内容：
// - 去掉表格里紧跟在分隔行后面的「| ------ | ---- |」残留行
// - 去掉 pandoc 对方括号与竖线的转义（`\[0\]` → `[0]`，正文里的 `\|` → `|`）
// - 加上 frontmatter：title / source / path（服务的分流路径）/ updated（docx 修改日期）
// 用法：node scripts/build-knowledge.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const DOCS = [
  {
    slug: "risk-assessment",
    source: "docs/source/职场权益风险评估问卷与风险信号清单.docx",
    path: ["A", "A+", "B"],
  },
  {
    slug: "emotion-support",
    source: "docs/source/职场情绪疏导建议.docx",
    path: ["A", "A+"],
  },
  {
    slug: "evidence-checklist",
    source: "docs/source/分阶段证据收集清单.docx",
    path: ["A+", "B"],
  },
];

const isDashRow = (line) =>
  /^\|(\s*-+\s*\|)+\s*$/.test(line.trim());

export function cleanMarkdown(md) {
  const out = [];
  for (const line of md.split("\n")) {
    // 表头分隔行之后再出现一行全是短横线的，是原文档里的残留，删掉
    if (isDashRow(line) && out.length && isDashRow(out[out.length - 1]))
      continue;
    let next = line.replace(/\\\[/g, "[").replace(/\\\]/g, "]");
    if (!next.trimStart().startsWith("|")) next = next.replace(/\\\|/g, "|");
    out.push(next);
  }
  return `${out.join("\n").trim()}\n`;
}

const readModified = (file) => {
  const xml = execFileSync("unzip", ["-p", file, "docProps/core.xml"], {
    encoding: "utf8",
  });
  return xml.match(/<dcterms:modified[^>]*>([^<]+)</)?.[1].slice(0, 10) ?? "";
};

mkdirSync(join(root, "knowledge"), { recursive: true });
for (const doc of DOCS) {
  const file = join(root, doc.source);
  const md = execFileSync("pandoc", [file, "-t", "gfm", "--wrap=none"], {
    encoding: "utf8",
  });
  const body = cleanMarkdown(md);
  const title = body.match(/^# (.+)$/m)?.[1] ?? doc.slug;
  const front = [
    "---",
    `title: ${title}`,
    `source: ${doc.source}`,
    `path: [${doc.path.join(", ")}]`,
    `updated: ${readModified(file)}`,
    "---",
    "",
  ].join("\n");
  writeFileSync(join(root, "knowledge", `${doc.slug}.md`), front + body);
  console.log(`knowledge/${doc.slug}.md`);
}
