import { test, expect, type Page } from "@playwright/test";
import { expeditionFixture } from "./expedition-fixture";

const names: Record<string, string> = { mask: "回声小岛", prism: "分光台", query: "寻光镜", heads: "双镜湾", beacon: "归航灯塔" };
const required: Record<string, string[]> = { mask: [], prism: ["mask"], query: ["prism"], heads: ["query"], beacon: ["query"] };

async function chapterFixture(page: Page) {
  const stages: Record<string, number> = { mask: 3, prism: 3, query: 0, heads: 0, beacon: 0 };
  const moves: Record<string, unknown>[] = [];
  await expeditionFixture(page, undefined, () => stages.beacon === 3);
  function state() {
    const main = ["mask", "prism", "query", "beacon"];
    return { id: "information-sea", version: "fixture", release_id: "fixture", title: "信息之海", mastery: "unverified",
      main_total: 4, main_completed: main.filter(id => stages[id] === 3).length,
      completed: main.every(id => stages[id] === 3), all_explored: Object.values(stages).every(stage => stage === 3),
      next_node: main.find(id => stages[id] < 3) ?? "beacon",
      nodes: Object.keys(names).map(id => {
        const unlocked = required[id].every(previous => stages[previous] === 3);
        return { id, title: unlocked ? names[id] : "迷雾", kind: id === "heads" ? "side" : id === "beacon" ? "finale" : "main", requires: required[id],
          entity_ids: [], unlocked, stage: stages[id], revision: stages[id], release_id: "fixture", trail: [],
          status: stages[id] === 3 ? "completed" : unlocked ? "available" : "locked" };
      }) };
  }
  await page.route("**/api/v1/adventure{,/**}", route => route.fulfill({ json: { unlocked: true, stage: 3, revision: 3, discovered: [], release_id: "fixture", mastery: "unverified", trail: [] } }));
  await page.route("**/api/v1/chapter{,/**}", async route => {
    if (route.request().method() === "POST") {
      const id = route.request().url().split("/").at(-2)!;
      const body = route.request().postDataJSON(); moves.push({ node: id, ...body }); stages[id]++;
    }
    await route.fulfill({ json: state() });
  });
  return { stages, moves };
}

async function setQuery(page: Page, x: number, y: number) {
  await page.getByRole("slider", { name: "横向查询", exact: true }).fill(String(x));
  await page.getByRole("slider", { name: "纵向查询", exact: true }).fill(String(y));
}

async function finishQuery(page: Page) {
  await page.getByRole("button", { name: "探索寻光镜", exact: true }).click();
  await expect(page.getByRole("heading", { name: "让第二束回应你的呼唤", exact: true })).toBeVisible();
  await setQuery(page, -1, 1); await page.getByRole("button", { name: "带着观察，继续", exact: true }).click();
  await expect(page.getByRole("heading", { name: "把查询转向共同的方向", exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "探索寻光镜", exact: true }).click();
  await expect(page.getByRole("heading", { name: "把查询转向共同的方向", exact: true })).toBeVisible();
  await setQuery(page, 2, 2); await page.getByRole("button", { name: "带着观察，继续", exact: true }).click();
  await expect(page.getByRole("heading", { name: "把目光转回来", exact: true })).toBeVisible();
  await setQuery(page, 2, -2);
  await page.getByRole("button", { name: "查询改变了与键的匹配分数", exact: true }).click();
  await page.getByRole("button", { name: "点亮这处发现", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Q、K、V", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "回到航图", exact: true }).click();
}

test("主线连到终点，支线不阻塞，航图可回看与重游", async ({ page }) => {
  const { stages, moves } = await chapterFixture(page);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "探索寻光镜", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "展开这一程航图", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("主线 2 / 4");
  await expect(page.getByRole("dialog").getByRole("button").filter({ hasText: "归航灯塔" })).toHaveCount(0);
  await page.screenshot({ path: ".runtime/screenshots/chapter-fog.png", animations: "disabled" });
  await page.keyboard.press("Escape");
  await finishQuery(page);
  const map = page.getByRole("dialog");
  await expect(map).toContainText("双镜湾"); await expect(map).toContainText("归航灯塔");
  await page.screenshot({ path: ".runtime/screenshots/chapter-branch.png", animations: "disabled" });
  await map.getByRole("button").filter({ hasText: "归航灯塔" }).click();
  await expect(page.getByRole("heading", { name: "修好会偷看未来的灯塔", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "带着观察，继续", exact: true }).click();
  await expect(page.locator(".room-feedback")).toContainText("先关好未来光路");
  await page.getByRole("button", { name: "因果光闸已打开", exact: true }).click();
  await page.getByRole("button", { name: "带着观察，继续", exact: true }).click();
  await expect(page.getByRole("heading", { name: "让后面的变化留在后面", exact: true })).toBeVisible();
  await page.getByRole("slider", { name: "第三个值", exact: true }).fill("30");
  await expect(page.getByTestId("final-output-0")).toHaveText("2.00");
  await expect(page.getByTestId("final-output-1")).toHaveText("4.00");
  await page.getByRole("button", { name: "带着观察，继续", exact: true }).click();
  await expect(page.getByRole("heading", { name: "接好最后一条光路", exact: true })).toBeVisible();
  for (const name of ["查询与键匹配", "归一化成权重", "屏蔽未来位置", "按权重汇聚值"]) await page.getByRole("button", { name, exact: true }).click();
  await page.getByRole("button", { name: "点亮归航灯塔", exact: true }).click();
  await expect(page.locator(".room-feedback")).toContainText("先算匹配");
  for (let n = 0; n < 3; n++) await page.getByRole("button", { name: "撤回一步", exact: true }).click();
  for (const name of ["屏蔽未来位置", "归一化成权重", "按权重汇聚值"]) await page.getByRole("button", { name, exact: true }).click();
  await page.screenshot({ path: ".runtime/screenshots/chapter-finale.png", fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "点亮归航灯塔", exact: true }).click();
  await expect(page.getByRole("heading", { name: "这一程，终于连成了光。", exact: true })).toBeVisible();
  expect(stages.heads).toBe(0); expect(stages.beacon).toBe(3);
  await page.getByRole("button", { name: "回到航图", exact: true }).click();
  await expect(map).toContainText("主线 4 / 4"); await expect(map).toContainText("主线已连通");
  await expect(map).toContainText("双镜湾支线仍可选做");
  await page.screenshot({ path: ".runtime/screenshots/chapter-complete.png", animations: "disabled" });
  await page.keyboard.press("Escape"); await page.reload();
  await expect(page.getByRole("heading", { name: "前面，还有一片新的光。", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "探索碎词码头", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "展开群岛总览", exact: true }).click();
  await map.getByRole("button").filter({ hasText: "01 · 信息之海" }).click();
  await map.getByRole("button").filter({ hasText: "寻光镜" }).click();
  await expect(page.getByRole("heading", { name: "让第二束回应你的呼唤", exact: true })).toBeVisible();
  expect(moves).toHaveLength(6); expect(errors).toEqual([]);
});

test("可选双镜支线保留两种输出，窄屏可拖动查询与切换镜片", async ({ page }) => {
  const { stages } = await chapterFixture(page); stages.query = 3;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "展开这一程航图", exact: true }).click();
  await page.getByRole("dialog").getByRole("button").filter({ hasText: "双镜湾" }).click();
  await expect(page.getByRole("heading", { name: "让镜片 A 留住低处的光", exact: true })).toBeVisible();
  const pad = await page.getByRole("group", { name: "拖动查询光镜，方向键也可操作", exact: true }).boundingBox();
  if (!pad) throw new Error("Missing query control");
  await page.mouse.move(pad.x + pad.width / 2, pad.y + pad.height / 2); await page.mouse.down();
  await page.mouse.move(pad.x + pad.width - 2, pad.y + pad.height - 2, { steps: 10 }); await page.mouse.up();
  await expect.poll(async () => Number(await page.getByTestId("query-output").textContent())).toBeLessThan(4);
  await page.getByRole("button", { name: "带着观察，继续", exact: true }).click();
  await expect(page.getByRole("heading", { name: "让镜片 B 看向另一处", exact: true })).toBeVisible();
  await setQuery(page, 2, 2); await page.getByRole("button", { name: "带着观察，继续", exact: true }).click();
  await expect(page.getByRole("heading", { name: "把两个视角一起带走", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "取平均，当成同一个视角", exact: true }).click();
  await page.getByRole("button", { name: "点亮这处发现", exact: true }).click();
  await expect(page.locator(".room-feedback")).toContainText("并排拼接");
  await page.getByRole("button", { name: "并排拼接，保留两个输出", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: ".runtime/screenshots/chapter-heads-mobile.png", fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "点亮这处发现", exact: true }).click();
  await expect(page.getByRole("heading", { name: "多头注意力", exact: true })).toBeVisible();
  expect(stages.heads).toBe(3); expect(stages.beacon).toBe(0);
});
