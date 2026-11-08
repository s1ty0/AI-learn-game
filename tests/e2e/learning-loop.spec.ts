import { test, expect } from "@playwright/test";
import path from "node:path";

test("地图、实验、提交与历史恢复在浏览器中形成闭环", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const initial = await (await request.get("/api/v1/learner-graph")).json();
  await page.goto("/workbench");
  await expect(page.getByRole("heading", { name: "让知识，连成你的理解。" })).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(initial.payload.nodes.length);
  await page.screenshot({ path: ".runtime/screenshots/map.png", fullPage: true });

  await page.locator(".react-flow__node").filter({ hasText: "因果掩码" }).click();
  const note = `【开发验证样本】因果掩码限制读取未来位置。${Date.now()}`;
  await page.getByLabel("我的解释").fill(note);
  await page.getByRole("button", { name: "保存解释", exact: true }).click();
  await expect(page.getByRole("button", { name: "保存地图", exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.locator(".react-flow__node")).toHaveCount(initial.payload.nodes.length);
  await page.locator(".react-flow__node").filter({ hasText: "因果掩码" }).click();
  await expect(page.getByLabel("我的解释")).toHaveValue(note);

  await page.getByRole("button", { name: "关卡实验", exact: true }).click();
  await page.getByRole("button", { name: "A 不会变化", exact: false }).click();
  await page.locator("#future").fill("30");
  await expect(page.getByTestId("output-0")).toHaveText("2.00");
  await expect(page.getByTestId("output-1")).toHaveText("5.00");
  await page.getByLabel("启用因果掩码").uncheck();
  await expect(page.getByTestId("output-0")).toHaveText("13.33");
  await page.getByLabel("启用因果掩码").check();
  await page.getByLabel("为什么会这样？你会怎样解释“因果掩码限制信息访问”？").fill("【开发验证样本】前两位置没有读取第三个值的权重，因此修改未来值不会影响它们。");
  await page.getByRole("button", { name: "提交这次理解" }).click();
  await expect(page.locator(".result-box")).toContainText("解释已保存");
  await page.screenshot({ path: ".runtime/screenshots/lab.png", fullPage: true });

  await page.getByRole("button", { name: "学习足迹", exact: true }).click();
  await expect(page.locator(".attempt-card").first()).toContainText("前两位置");
  await page.locator(".version-row").filter({ has: page.getByText(`v${initial.revision}`, { exact: true }) }).getByRole("button", { name: "查看" }).click();
  await expect(page.locator(".preview-banner")).toContainText(`历史 v${initial.revision}`);
  await page.getByRole("button", { name: "恢复为新版本", exact: true }).click();
  await expect(page.locator(".preview-banner")).toHaveCount(0);
  const restored = await (await request.get("/api/v1/learner-graph")).json();
  expect(restored.payload).toEqual(initial.payload);
  expect(restored.revision).toBeGreaterThan(initial.revision + 1);
  expect(errors).toEqual([]);
});

test("知识搜索与窄屏阅读可用", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/workbench");
  await page.getByRole("button", { name: "知识图书馆", exact: true }).click();
  await page.getByLabel("搜索知识").fill("Transformer");
  await expect(page.locator(".catalog-item").filter({ hasText: "Transformer" }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: ".runtime/screenshots/mobile.png", fullPage: true });
});

test("两个标签页发生冲突时保留草稿并可明确重新应用", async ({ page, context, request }) => {
  const initial = await (await request.get("/api/v1/learner-graph")).json();
  const second = await context.newPage();
  const noteOne = `【开发验证样本】标签页一保存的关系解释。${Date.now()}`;
  const noteTwo = `【开发验证样本】标签页二尚未同步的关系解释。${Date.now()}`;
  await Promise.all([page.goto("/workbench"), second.goto("/workbench")]);
  for (const current of [page, second]) {
    await current.locator(".react-flow__node").filter({ hasText: "因果掩码" }).click();
  }
  await page.getByLabel("我的解释").fill(noteOne);
  await second.getByLabel("我的解释").fill(noteTwo);
  await page.getByRole("button", { name: "保存解释", exact: true }).click();
  await expect(page.getByRole("button", { name: "保存地图", exact: true })).toBeDisabled();
  await second.getByRole("button", { name: "保存解释", exact: true }).click();
  await expect(second.locator(".alert")).toContainText("另一处已更新");
  await expect(second.getByLabel("我的解释")).toHaveValue(noteTwo);
  await second.getByRole("button", { name: "查看最新版本", exact: true }).click();
  await expect(second.locator(".recovery")).toContainText("服务器已有更新");
  await second.getByRole("button", { name: "把草稿复制为新修订", exact: true }).click();
  await second.getByRole("button", { name: "保存解释", exact: true }).click();
  await expect(second.getByRole("button", { name: "保存地图", exact: true })).toBeDisabled();
  const latest = await (await request.get("/api/v1/learner-graph")).json();
  const restored = await request.post("/api/v1/learner-graph/restore", { data: { base_revision: latest.revision, operation_key: crypto.randomUUID(), revision: initial.revision } });
  expect(restored.ok()).toBeTruthy();
  await second.close();
});

test("刷新后找回尚未提交的当前标签页草稿", async ({ page }) => {
  await page.goto("/workbench");
  await page.locator(".react-flow__node").filter({ hasText: "因果掩码" }).click();
  await page.getByLabel("我的解释").fill("【开发验证样本】这是刷新前的本地草稿。");
  await page.waitForTimeout(500);
  page.once("dialog", dialog => dialog.accept());
  await page.reload();
  await expect(page.locator(".recovery")).toContainText("未同步草稿");
  await page.getByRole("button", { name: "找回草稿", exact: true }).click();
  await page.locator(".react-flow__node").filter({ hasText: "因果掩码" }).click();
  await expect(page.getByLabel("我的解释")).toHaveValue("【开发验证样本】这是刷新前的本地草稿。");
  // Preserve server history; explicitly choose its current contents for cleanup.
  await page.getByRole("button", { name: "学习足迹", exact: true }).click();
});
