import { test, expect, type Page } from "@playwright/test";

// Browser interaction checks use a per-test API fixture. Real PostgreSQL transition,
// concurrency, idempotency and retention checks live in the backend suite.
async function voyageFixture(page: Page) {
  let progress = { revision: 0, stage: 0, release_id: "browser-fixture", discovered: [] as string[], mastery: "unverified",
    trail: [] as { stage: number; created_at: string; hint_used: boolean }[] };
  const moves: Record<string, unknown>[] = [];
  await page.route("**/api/v1/adventure{,/**}", async route => {
    if (route.request().url().includes("/prism")) {
      await route.fulfill({ json: { unlocked: progress.stage === 3, stage: 0, revision: 0, release_id: "browser-fixture", discovered: [], trail: [], mastery: "unverified" } });
      return;
    }
    if (route.request().method() === "POST") {
      const move = route.request().postDataJSON();
      moves.push(move);
      progress = { ...progress, revision: progress.revision + 1, stage: progress.stage + 1,
        trail: [...progress.trail, { stage: move.stage, created_at: new Date().toISOString(), hint_used: move.hint_used }],
        discovered: progress.stage === 2 ? ["entity-0068"] : [] };
    }
    await route.fulfill({ json: progress });
  });
  return moves;
}

test("只露出一座小岛，逐步操作后才揭示知识，并保留探索位置", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const moves = await voyageFixture(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "雾里，有一束光。" })).toBeVisible();
  await expect(page.getByRole("button", { name: "探索第一束光", exact: true })).toBeEnabled();
  await expect(page.getByText("因果掩码", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "知识图书馆", exact: true })).toHaveCount(0);
  await expect(page.locator(".beacon-entry")).toHaveCount(1);
  await page.screenshot({ path: ".runtime/screenshots/adventure-world.png", animations: "disabled" });

  await page.getByRole("button", { name: "探索第一束光", exact: true }).click();
  await page.getByRole("button", { name: "我发现了，继续" }).click();
  await expect(page.locator(".room-feedback")).toContainText("20 或更大");
  await page.getByRole("slider", { name: "第三座的信号" }).fill("30");
  await expect(page.getByTestId("beacon-output-0")).toHaveText("2.00");
  await page.getByRole("button", { name: "一点线索", exact: true }).click();
  await page.getByRole("button", { name: "收起线索", exact: true }).click();
  await page.getByRole("button", { name: "我发现了，继续" }).click();
  await expect(page.getByRole("heading", { name: "让光越过边界" })).toBeVisible();
  expect(moves[0].hint_used).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "探索第一束光", exact: true }).click();
  await expect(page.getByRole("heading", { name: "让光越过边界" })).toBeVisible();
  await page.getByRole("button", { name: "打开光闸", exact: true }).click();
  await expect(page.getByTestId("beacon-output-0")).toHaveText("13.33");
  await page.getByRole("button", { name: "试试最后的机关" }).click();
  await expect(page.getByRole("heading", { name: "修好这座小岛" })).toBeVisible();
  await page.getByRole("slider", { name: "第三座的信号" }).fill("30");
  await page.getByRole("button", { name: "关闭光闸", exact: true }).click();
  await page.getByRole("button", { name: "因为两座灯塔隔得太远", exact: true }).click();
  await page.getByRole("button", { name: "点亮小岛", exact: true }).click();
  await expect(page.locator(".room-feedback")).toContainText("距离没变");
  expect(moves).toHaveLength(2);
  await page.getByRole("button", { name: "光闸挡住了来自后面的光", exact: true }).click();
  await page.screenshot({ path: ".runtime/screenshots/adventure-puzzle.png", fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "点亮小岛", exact: true }).click();
  await expect(page.getByRole("heading", { name: "小岛，亮起来了。" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "因果掩码", exact: true })).toBeVisible();
  await page.screenshot({ path: ".runtime/screenshots/adventure-reward.png", fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "看看我的发现", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("新情境中验证掌握");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "你让一小片世界亮了起来。" })).toBeVisible();
  await page.getByRole("button", { name: "我的发现", exact: true }).click();
  await page.getByRole("button", { name: "重游回声机关", exact: true }).click();
  await expect(page.getByRole("heading", { name: "唤醒第三座灯塔" })).toBeVisible();
  expect(moves).toHaveLength(3);
  expect(errors).toEqual([]);
});

test("手机上只见当前可探索入口，机关仍可操作", async ({ page }) => {
  await voyageFixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "探索第一束光", exact: true })).toBeEnabled();
  await page.screenshot({ path: ".runtime/screenshots/adventure-mobile.png", fullPage: true, animations: "disabled" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "探索第一束光", exact: true }).click();
  await page.getByRole("slider", { name: "第三座的信号" }).fill("30");
  await expect(page.getByTestId("beacon-output-2")).toHaveText("13.33");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: ".runtime/screenshots/adventure-mobile-room.png", fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "我发现了，继续" }).click();
  await page.getByRole("button", { name: "打开光闸", exact: true }).click();
  await page.getByRole("button", { name: "试试最后的机关" }).click();
  await page.getByRole("slider", { name: "第三座的信号" }).fill("30");
  await page.getByRole("button", { name: "关闭光闸", exact: true }).click();
  await expect(page.getByRole("button", { name: "光闸挡住了来自后面的光", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("方向键移动光灵，E点亮入口，并能全程用键盘解开机关", async ({ page }) => {
  await voyageFixture(page);
  await page.goto("/");
  const explorer = page.getByTestId("light-explorer");
  await expect(explorer).toBeVisible();
  await expect(page.locator(".exploration-field")).toHaveAttribute("data-controls-ready", "true");
  await page.keyboard.down("d");
  await expect.poll(async () => Number(await explorer.getAttribute("data-x")), { intervals: [16], timeout: 4000 }).toBeGreaterThan(48);
  await page.keyboard.up("d");
  await page.keyboard.down("w");
  await expect.poll(async () => Number(await explorer.getAttribute("data-y")), { intervals: [16], timeout: 3000 }).toBeLessThan(52);
  await page.keyboard.up("w");
  await expect(page.locator(".exploration-field")).toHaveClass(/near-light/);
  await page.keyboard.press("e");
  await expect(page.locator(".exploration-field")).toHaveClass(/is-igniting/);
  await expect(page.getByRole("heading", { name: "唤醒第三座灯塔", exact: true })).toBeVisible();
  for (let n = 0; n < 10; n++) await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("slider", { name: "第三座的信号" })).toHaveValue("20");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "让光越过边界", exact: true })).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.getByTestId("beacon-output-0")).toHaveText("13.33");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "修好这座小岛", exact: true })).toBeVisible();
  for (let n = 0; n < 15; n++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");
  await page.keyboard.press("1");
  await expect(page.getByRole("button", { name: "光闸挡住了来自后面的光", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "小岛，亮起来了。", exact: true })).toBeVisible();
});

test("存档接口失败时也能点击地面移动、进入和拖动灯塔，不伪造通关", async ({ page }) => {
  await page.route("**/api/v1/adventure", route => route.fulfill({ status: 503, json: { detail: "offline fixture" } }));
  await page.goto("/");
  await expect(page.locator(".voyage-error")).toContainText("暂时连不上");
  const field = page.locator(".exploration-field");
  const area = await field.boundingBox();
  if (!area) throw new Error("Missing exploration field");
  await page.mouse.click(area.x + area.width * .39, area.y + area.height * .68);
  await expect.poll(async () => Number(await page.getByTestId("light-explorer").getAttribute("data-x"))).toBeGreaterThan(34);
  await page.getByRole("button", { name: "探索第一束光", exact: true }).click();
  await expect(page.getByRole("heading", { name: "唤醒第三座灯塔", exact: true })).toBeVisible();
  const tower = await page.getByRole("button", { name: "拖动或点击第三座灯塔调节信号", exact: true }).boundingBox();
  if (!tower) throw new Error("Missing draggable tower");
  const start = { x: tower.x + tower.width / 2, y: tower.y + tower.height / 2 };
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(start.x + 80, start.y - 20, { steps: 12 }); await page.mouse.up();
  await expect(page.getByRole("slider", { name: "第三座的信号" })).toHaveValue("30");
  await expect(page.getByTestId("beacon-output-0")).toHaveText("2.00");
  await page.getByRole("button", { name: "我发现了，继续" }).click();
  await expect(page.locator(".room-feedback")).toContainText("存档连接恢复后");
  await expect(page.getByRole("heading", { name: "唤醒第三座灯塔", exact: true })).toBeVisible();
});

test("浏览器扩展在body注入huiyi属性后仍可正常水合和点击", async ({ page }) => {
  await voyageFixture(page);
  await page.addInitScript(() => {
    // Simulate a content script as soon as the HTML parser creates body.
    const observer = new MutationObserver(inject);
    function inject() {
      if (!document.body) return;
      document.body.setAttribute("huiyi-version", "2.2.0");
      document.body.setAttribute("huiyi-id", "dgeiaiglmhdhajbpfbmajaajdlfdinpi");
      document.body.setAttribute("huiyi-oem", "default");
      observer.disconnect();
    }
    observer.observe(document, { childList: true, subtree: true });
    inject();
  });
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("body")).toHaveAttribute("huiyi-version", "2.2.0");
  await page.getByRole("button", { name: "我的发现", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "探索第一束光", exact: true }).click();
  await expect(page.getByRole("heading", { name: "唤醒第三座灯塔", exact: true })).toBeVisible();
  expect(errors.filter(error => /hydrat|server rendered|server-rendered/i.test(error))).toEqual([]);
});

test("存档请求悬挂时8秒超时，等待期间仍能移动和进入机关", async ({ page }) => {
  await page.route("**/api/v1/adventure", async route => {
    await new Promise(resolve => setTimeout(resolve, 10000));
    await route.fulfill({ status: 503, body: "delayed fixture" }).catch(() => {});
  });
  await page.goto("/");
  await expect(page.locator(".exploration-field")).toHaveAttribute("data-controls-ready", "true");
  await page.keyboard.down("ArrowRight");
  await expect.poll(async () => Number(await page.getByTestId("light-explorer").getAttribute("data-x"))).toBeGreaterThan(33);
  await page.keyboard.up("ArrowRight");
  await page.getByRole("button", { name: "探索第一束光", exact: true }).click();
  await expect(page.getByRole("heading", { name: "唤醒第三座灯塔", exact: true })).toBeVisible();
  await expect(page.locator(".voyage-error")).toContainText("暂时连不上", { timeout: 11000 });
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("slider", { name: "第三座的信号" })).toHaveValue("11");
});
