import { test, expect, type Page } from "@playwright/test";
import config from "../../data/games/expedition.json";
import { expeditionFixture } from "./expedition-fixture";
import { explanations, labMetrics, type ExpeditionIsland, type LabState } from "../../apps/web/src/lib/expedition";
import { blockLabels, blockOrder } from "../../apps/web/src/lib/tower";

async function enter(page: Page, id: string) {
  const node = config.nodes.find(node => node.id === id)!;
  if (!await page.getByRole("dialog").count()) await page.getByRole("button", { name: "展开群岛总览", exact: true }).click();
  const group = page.locator(".atlas-chapter").filter({ has: page.locator("summary strong", { hasText: config.chapters.find(ch => ch.id === node.chapter)!.title }) });
  if (!await group.getAttribute("open")) {
    // The boolean open attribute is an empty string when present.
    if (!await group.evaluate(element => (element as HTMLDetailsElement).open)) await group.locator("summary").click();
  }
  await group.getByRole("button").filter({ hasText: node.title }).click();
  await expect(page.getByRole("heading", { name: node.steps[0].title, exact: true })).toBeVisible();
}
async function dial(page: Page, name: string, value: number) { await page.getByRole("slider", { name, exact: true }).fill(String(value)); }
async function perform(page: Page, id: string, stage: number) {
  if (id === "residual") {
    if (stage === 0) await page.getByRole("button", { name: "接通原信号支路", exact: true }).click();
    if (stage > 0) await dial(page, "子层改变量", stage === 1 ? -1 : 0);
  } else if (id === "normalization") {
    if (stage === 0) await page.getByRole("button", { name: "启用归一化", exact: true }).click();
    if (stage === 1) await dial(page, "整体平移", 2);
    if (stage === 2) await page.getByRole("button", { name: "让三个特征相同", exact: true }).click();
  } else if (id === "block" && stage < 2) {
    for (const item of stage === 0 ? blockOrder.slice(0, 3) : blockOrder.slice(3)) await page.getByRole("button", { name: blockLabels[item], exact: true }).click();
  } else if (id === "backprop") {
    if (stage === 2) await dial(page, "链路参数 w", 1.5);
    await page.getByRole("button", { name: `局部导数${[-2, 2, 0][stage]}`, exact: true }).click();
  }
  if (id === "token") {
    if (stage === 0) for (const key of [2, 3, 5]) await page.keyboard.press(String(key));
    if (stage === 2) await page.getByRole("button", { name: "切分位置5", exact: true }).click();
  } else if (id === "embedding" && stage < 2) {
    for (const row of stage === 1 ? [1, 2] : [2, 0, 2]) await page.getByRole("button", { name: `取第${row}行向量`, exact: true }).click();
  } else if (id === "position") {
    if (stage === 0) await page.getByRole("button", { name: "位置信号关闭", exact: true }).click();
    if (stage === 1) await dial(page, "位置信号强度", 2);
  } else if (id === "ffn") {
    if (stage === 0) await dial(page, "位置1输入", 1);
    if (stage === 1) await dial(page, "位置2输入", 0);
  } else if (id === "loss") {
    if (stage === 0) await dial(page, "预测斜率 w", 2);
    if (stage === 1) for (const weight of [1, 3]) { await dial(page, "预测斜率 w", weight); await page.getByRole("button", { name: "记录这次观测", exact: true }).click(); }
  } else if (id === "gradient") await dial(page, "当前位置 w", stage === 0 ? 1 : stage === 1 ? 3 : 2);
  else if (id === "descent") {
    if (stage === 2) await dial(page, "学习率", .1);
    await page.getByRole("button", { name: "走一步", exact: true }).click(); await page.getByRole("button", { name: "走一步", exact: true }).click();
  } else if (id === "l2") { if (stage < 2) await dial(page, "参数 w", stage === 0 ? 1 : .5); }
  else if (id === "temperature" && stage < 2) await dial(page, "温度 T", stage === 0 ? .5 : 2);
  else if (id === "entropy" && stage < 2) await dial(page, "真实目标 A 的概率", stage === 0 ? .8 : .1);
  else if (id === "generation" && stage < 2) { for (const symbol of stage === 0 ? ["B"] : ["C", "A"]) await page.getByRole("button", { name: `追加${symbol}`, exact: true }).click(); }
  else if (id === "cache") {
    if (stage === 0) await page.getByRole("button", { name: "运行完整重算", exact: true }).click();
    await page.getByRole("button", { name: "运行复用缓存", exact: true }).click();
  }
  if (stage === 2 && id !== "token" || id === "token" && stage === 1) {
    await page.getByRole("button", { name: explanations[id as ExpeditionIsland][0].text, exact: true }).click();
  }
}

for (const chapter of config.chapters) test(`${chapter.title}的三处主线与可选支线均可操作，读数一致`, async ({ page }) => {
  const fixture = await expeditionFixture(page, chapter.id);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  for (const node of config.nodes.filter(node => node.chapter === chapter.id)) {
    await enter(page, node.id);
    for (let stage = 0; stage < 3; stage++) {
      await expect(page.getByRole("heading", { name: node.steps[stage].title, exact: true })).toBeVisible();
      await perform(page, node.id, stage);
      if (stage === 1) await page.screenshot({ path: `.runtime/screenshots/expedition-${node.id}.png`, fullPage: true, animations: "disabled" });
      await page.getByRole("button", { name: stage === 2 ? "点亮这处发现" : "带着观察，继续", exact: true }).click();
    }
    await expect(page.getByRole("heading", { name: `${node.title}，亮起来了。`, exact: true })).toBeVisible();
    if (node.id === "block") {
      await page.getByText("展开机制、条件与反例", { exact: false }).click();
      await expect(page.getByRole("heading", { name: "示例的条件", exact: true })).toBeVisible();
    }
    await page.getByRole("button", { name: "带着发现，回到群岛", exact: true }).click();
    expect(fixture.stages[node.id]).toBe(3);
  }
  expect(fixture.moves).toHaveLength(12);
  for (const move of fixture.moves) {
    const metrics = labMetrics(move.node as ExpeditionIsland, move.stage as number, move.state as LabState);
    expect(move.observed).toEqual(metrics);
  }
  await page.screenshot({ path: `.runtime/screenshots/expedition-${chapter.id}-atlas.png`, animations: "disabled" });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "我的发现", exact: true }).click();
  await expect(page.locator(".expedition-discoveries")).toContainText(chapter.title);
  expect(errors).toEqual([]);
});

test("新海域逐步解锁，失败保留操作，刷新续玩，重游不再写记录", async ({ page }) => {
  const fixture = await expeditionFixture(page, "representation");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/"); await enter(page, "token");
  await page.getByRole("button", { name: "带着观察，继续", exact: true }).click();
  await expect(page.locator(".room-feedback")).toContainText("AI");
  await perform(page, "token", 0); fixture.failNext();
  await page.getByRole("button", { name: "带着观察，继续", exact: true }).click();
  await expect(page.locator(".room-feedback")).toContainText("尚未保存成功");
  await expect(page.getByRole("button", { name: "切分位置2", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "带着观察，继续", exact: true }).click();
  await expect(page.getByRole("heading", { name: config.nodes[0].steps[1].title, exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "探索碎词码头", exact: true }).click();
  await expect(page.getByRole("heading", { name: config.nodes[0].steps[1].title, exact: true })).toBeVisible();
  for (const stage of [1, 2]) { await perform(page, "token", stage); await page.getByRole("button", { name: stage === 2 ? "点亮这处发现" : "带着观察，继续", exact: true }).click(); }
  await page.getByRole("button", { name: "带着发现，回到群岛", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("向量仓库");
  await expect(page.getByRole("dialog")).not.toContainText("学习山谷");
  await expect(page.getByRole("dialog")).not.toContainText("时序信标");
  await enter(page, "token");
  for (const stage of [0, 1, 2]) { await perform(page, "token", stage); await page.getByRole("button", { name: stage === 2 ? "点亮这处发现" : "带着观察，继续", exact: true }).click(); }
  expect(fixture.moves).toHaveLength(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: ".runtime/screenshots/expedition-token-mobile.png", fullPage: true, animations: "disabled" });
});

test("向量支持乱序拖放，所有新场景在390像素宽无横向溢出，滑杆上可用Esc返回", async ({ page }) => {
  const fixture = await expeditionFixture(page, "representation");
  await page.setViewportSize({ width: 390, height: 844 });
  for (const node of config.nodes) {
    for (const id of Object.keys(fixture.stages)) fixture.stages[id] = id === node.id ? 0 : 3;
    await page.goto("/");
    await enter(page, node.id);
    await expect(page.getByRole("heading", { name: node.steps[0].title, exact: true })).toBeVisible();
    if (node.id === "embedding") {
      const slots = page.locator(".warehouse-slot");
      await page.getByRole("button", { name: "取第2行向量", exact: true }).dragTo(slots.nth(2));
      await expect(slots.nth(2).locator("strong")).toHaveText("[1, 1]");
      await expect(slots.nth(0).locator("strong")).toHaveText("待取");
      await page.getByRole("button", { name: "取第2行向量", exact: true }).dragTo(slots.nth(0));
      await page.getByRole("button", { name: "取第0行向量", exact: true }).dragTo(slots.nth(1));
      await page.getByRole("button", { name: "带着观察，继续", exact: true }).click();
      await expect(page.getByRole("heading", { name: node.steps[1].title, exact: true })).toBeVisible();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (["embedding", "descent", "cache", "residual", "normalization", "block", "backprop"].includes(node.id)) await page.screenshot({ path: `.runtime/screenshots/expedition-${node.id}-mobile.png`, fullPage: true, animations: "disabled" });
    if (node.id === "loss") {
      await page.getByRole("slider", { name: "预测斜率 w", exact: true }).focus();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toBeVisible();
    }
  }
});
