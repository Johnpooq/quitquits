import { expect, test, type Page } from "@playwright/test";

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
};

const token = (page: Page) =>
  page.evaluate(() => localStorage.getItem("workday-companion-device"));

/** 直接查后端数据库里的数据（不经过页面） */
const serverState = async (page: Page) => {
  const res = await page.request.get("/api/data", {
    headers: { Authorization: `Bearer ${await token(page)}` },
  });
  expect(res.ok()).toBe(true);
  return (await res.json()).state as {
    entries: { date: string; content: string; draftText?: string }[];
    messages: { content: string }[];
    materials: { fileId?: string; name: string }[];
  } | null;
};

const startDemo = async (page: Page) => {
  await page.goto("/");
  await page.getByRole("button", { name: "体验演示" }).click();
  await expect(page.getByRole("heading", { name: "今天的状态" })).toBeVisible({
    timeout: 15000,
  });
};

const send = async (page: Page, text: string) => {
  await page.locator("#message").fill(text);
  await page.getByRole("button", { name: "发送" }).click();
};

test("刷新后数据来自后端数据库，而不是浏览器存储", async ({ page }) => {
  await startDemo(page);
  await send(page, "今天主管把我叫去聊了很久");
  await expect(
    page.getByTestId("conversation").getByText("今天主管把我叫去聊了很久"),
  ).toBeVisible();
  // 未发送的草稿也写进数据库
  await page.locator("#message").fill("还没想好怎么说");

  await expect
    .poll(async () => {
      const state = await serverState(page);
      const entry = state?.entries.find((e) => e.date === todayKey());
      return [
        state?.messages.some((m) => m.content === "今天主管把我叫去聊了很久"),
        entry?.draftText,
      ];
    })
    .toEqual([true, "还没想好怎么说"]);

  // 浏览器里只剩匿名设备标识：没有 AppData，也没有待发送的修改
  const local = await page.evaluate(() => ({
    keys: Object.keys(localStorage),
    outbox: sessionStorage.getItem("workday-companion-outbox"),
  }));
  expect(local.keys).toEqual(["workday-companion-device"]);
  expect(local.outbox).toBeNull();

  // 清掉会话存储后刷新，内容仍然从数据库读回
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expect(
    page.getByTestId("conversation").getByText("今天主管把我叫去聊了很久"),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.locator("#message")).toHaveValue("还没想好怎么说");
});

test("演示材料文件存在服务端，可以下载原件", async ({ page }) => {
  await startDemo(page);
  const state = await serverState(page);
  const material = state?.materials.find((m) => m.fileId);
  expect(material).toBeDefined();
  const res = await page.request.get(`/api/files/${material!.fileId}`, {
    headers: { Authorization: `Bearer ${await token(page)}` },
  });
  expect(res.ok()).toBe(true);
  expect(await res.text()).toContain("虚构演示材料");
});

test("旧版本 localStorage 与 IndexedDB 数据在首次启动时自动导入", async ({
  page,
}) => {
  const date = todayKey();
  // 先打开一个同源的静态文件，写入旧版本数据（此时应用还没启动）
  await page.goto("/favicon.svg");
  await page.evaluate(
    async ({ date }) => {
      const legacy = {
        version: 1,
        state: {
          onboarded: true,
          profile: { id: "p1", employmentStatus: "在职" },
          entries: [
            { id: "old-entry", date, content: "旧版本留下的记录", tags: [] },
          ],
          events: [],
          suggestions: [],
          materials: [
            {
              id: "old-material",
              name: "旧版本上传的文件",
              type: "other",
              status: "uploaded",
              isCurrent: true,
              eventIds: [],
              fileId: "old-file",
              fileName: "旧文件.txt",
              mimeType: "text/plain",
              extractionStatus: "none",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
          messages: [
            {
              id: "old-msg",
              role: "user",
              content: "旧版本的一条消息",
              conversationId: "default",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
      };
      // 旧数据缺少的时间字段由迁移补齐前，这里给出与旧版一致的值
      Object.assign(legacy.state.entries[0], {
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      localStorage.setItem("workday-companion-v1", JSON.stringify(legacy));
      await new Promise<void>((resolve, reject) => {
        const r = indexedDB.open("workday-companion-files", 1);
        r.onupgradeneeded = () =>
          r.result.createObjectStore("files", { keyPath: "id" });
        r.onsuccess = () => {
          const tx = r.result.transaction("files", "readwrite");
          tx.objectStore("files").put({
            id: "old-file",
            blob: new Blob(["旧文件内容"], { type: "text/plain" }),
            name: "旧文件.txt",
            type: "text/plain",
          });
          tx.oncomplete = () => {
            r.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    },
    { date },
  );

  await page.goto(`/today/${date}`);
  await expect(page.getByText("旧版本的一条消息")).toBeVisible({
    timeout: 15000,
  });

  // 已写入数据库，旧的 localStorage 键被移除
  const state = await serverState(page);
  expect(state?.entries[0].content).toBe("旧版本留下的记录");
  expect(
    await page.evaluate(() => localStorage.getItem("workday-companion-v1")),
  ).toBeNull();
  // IndexedDB 里的旧文件按原 id 上传到了服务端
  const file = await page.request.get("/api/files/old-file", {
    headers: { Authorization: `Bearer ${await token(page)}` },
  });
  expect(await file.text()).toBe("旧文件内容");

  // 再刷新一次也不会重复导入
  await page.reload();
  await expect(page.getByText("旧版本的一条消息")).toHaveCount(1, {
    timeout: 15000,
  });
});

test("出现自伤念头时给出 12356，不建事件", async ({ page }) => {
  await startDemo(page);
  await send(page, "最近真的撑不下去了，有时候觉得不想活了");
  const conversation = page.getByTestId("conversation");
  await expect(conversation.getByText(/12356/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: "记下来" })).toHaveCount(0);
});

test("被劝退要写个人原因：列出材料缺口并给出转介提示", async ({ page }) => {
  await startDemo(page);
  await send(page, "被劝退了，HR 让我在离职申请上写「个人原因」");
  const conversation = page.getByTestId("conversation");
  await expect(conversation.getByText(/还缺的材料/)).toBeVisible({
    timeout: 15000,
  });
  await expect(conversation.getByText(/执业律师/)).toBeVisible();
  await expect(conversation).not.toContainText("公司违法");
});

test("后端不可用时不渲染空页面，给出重试入口", async ({ page }) => {
  await page.route("**/api/**", (route) => route.abort());
  await page.goto("/today");
  await expect(page.getByRole("alert")).toContainText("无法连接数据服务");
  await expect(page.getByRole("button", { name: "重试" })).toBeVisible();
});
