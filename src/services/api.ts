/**
 * 后端 API 客户端。没有账号体系：首次访问向服务端申请一个匿名设备令牌，
 * 保存在本机 localStorage，之后所有请求用它区分用户。
 * 令牌只是设备标识，不是 API Key；模型的 Key 只放在服务端 .env。
 */
export const API_BASE = "/api";
export const DEVICE_KEY = "workday-companion-device";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const OFFLINE = "无法连接数据服务，请确认后端已启动后重试。";

let registering: Promise<string> | null = null;

async function register(): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/device`, { method: "POST" });
  } catch {
    throw new ApiError(OFFLINE, 0);
  }
  if (!res.ok) throw new ApiError("无法创建设备标识，请重试。", res.status);
  const { token } = (await res.json()) as { token: string };
  localStorage.setItem(DEVICE_KEY, token);
  return token;
}

export function deviceToken(): Promise<string> {
  const saved = localStorage.getItem(DEVICE_KEY);
  if (saved) return Promise.resolve(saved);
  registering ??= register().finally(() => {
    registering = null;
  });
  return registering;
}

async function errorMessage(res: Response) {
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {
    /* 非 JSON 响应 */
  }
  return `请求失败（${res.status}），请重试。`;
}

export interface ApiOptions {
  /** 这些状态码不当作错误，交给调用方处理 */
  allow?: number[];
}

export async function apiFetch(
  path: string,
  init: RequestInit = {},
  auth = true,
  options: ApiOptions = {},
  retried = false,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (auth) headers.set("Authorization", `Bearer ${await deviceToken()}`);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(OFFLINE, 0);
  }
  // 服务端不认识这个令牌（例如数据库被重置）：重新申请一次
  if (res.status === 401 && auth && !retried) {
    localStorage.removeItem(DEVICE_KEY);
    return apiFetch(path, init, auth, options, true);
  }
  if (!res.ok && !options.allow?.includes(res.status))
    throw new ApiError(await errorMessage(res), res.status);
  return res;
}

export async function apiJSON<T>(
  path: string,
  init: RequestInit = {},
  auth = true,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  const res = await apiFetch(path, { ...init, headers }, auth);
  return (await res.json()) as T;
}
