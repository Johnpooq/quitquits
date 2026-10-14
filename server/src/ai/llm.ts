export interface ChatMessage {
  role: "system" | "user";
  content: string;
}
/** 调一次模型，返回纯文本 */
export type ChatFn = (messages: ChatMessage[]) => Promise<string>;

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

/**
 * OpenAI 兼容的 /chat/completions 接口（DeepSeek、通义千问、Kimi、OpenAI 等）。
 * API Key 只在服务端读取，不会下发给前端，也不会写进日志。
 */
export function openAiCompatible(config: LlmConfig): ChatFn {
  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  return async (messages) => {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.4,
        max_tokens: 800,
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    if (!res.ok) throw new Error(`模型接口返回 ${res.status}`);
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("模型没有返回内容");
    return content;
  };
}
