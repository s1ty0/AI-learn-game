import { test, expect } from "@playwright/test";

test("新光路依次开放，分光台存档续玩并保留新发现", async ({ page }) => {
  let progress = { unlocked: true, revision: 0, stage: 0, release_id: "prism-browser-fixture", discovered: [] as string[], mastery: "unverified", trail: [] as object[] };
  const moves: Record<string, unknown>[] = [];
  await page.route("**/api/v1/adventure{,/**}", async route => {
    if (!route.request().url().includes("/prism")) {
      await route.fulfill({ json: { stage: 3, revision: 3, release_id: "fixture", discovered: ["entity-0068"], trail: [], mastery: "unverified" } }); return;
    }
    if (route.request().method() === "POST") {
      const move = route.request().postDataJSON(); moves.push(move);
      progress = { ...progress, revision: progress.revision + 1, stage: progress.stage + 1,
        discovered: progress.stage === 2 ? ["entity-0142", "entity-0147"] : [], trail: [...progress.trail, { stage: move.stage, created_at: new Date().toISOString(), hint_used: move.hint_used }] };
    }
    await route.fulfill({ json: progress });
  });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "探索分光台", exact: true }).click();
  await expect(page.getByRole("heading", { name: "让三束光平等地到达", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "带着观察，继续", exact: true }).click();
  await expect(page.locator(".room-feedback")).toContainText("三束偏好相同");
  await page.keyboard.press("2");
  for (let n = 0; n < 8; n++) await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("prism-output")).toHaveText("6.00");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "让第三束光说得更多", exact: true })).toBeVisible();
  await page.getByRole("slider", { name: "第3束偏好", exact: true }).fill("3");
  await expect.poll(async () => Number(await page.getByTestId("prism-output").textContent())).toBeGreaterThan(8);
  await page.getByRole("button", { name: "带着观察，继续", exact: true }).click();
  await expect(page.getByRole("heading", { name: "把光的重心移回来", exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "探索分光台", exact: true }).click();
  await expect(page.getByRole("heading", { name: "把光的重心移回来", exact: true })).toBeVisible();
  await page.getByRole("slider", { name: "第3束偏好", exact: true }).fill("0");
  await page.getByRole("slider", { name: "第1束偏好", exact: true }).fill("3");
  await page.getByRole("button", { name: "只留下了最大偏好的那一束", exact: true }).click();
  await page.getByRole("button", { name: "点亮分光台", exact: true }).click();
  await expect(page.locator(".room-feedback")).toContainText("没有只选一束");
  expect(moves).toHaveLength(2);
  await page.getByRole("button", { name: "改变了每束信息参与的比例", exact: true }).click();
  await page.screenshot({ path: ".runtime/screenshots/prism-puzzle.png", fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "点亮分光台", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Softmax", exact: true })).toBeVisible();
  await page.screenshot({ path: ".runtime/screenshots/prism-reward.png", fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "我的发现", exact: true }).click();
  await page.getByRole("button", { name: "重游分光台", exact: true }).click();
  await expect(page.getByRole("heading", { name: "让三束光平等地到达", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "回到群岛", exact: true }).click();
  await page.getByRole("button", { name: "我的发现", exact: true }).click();
  await expect(page.locator(".journal-prism")).toContainText("权重分配");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "我的发现", exact: true }).click();
  await page.getByRole("button", { name: "重游分光台", exact: true }).click();
  await expect(page.getByRole("heading", { name: "让三束光平等地到达", exact: true })).toBeVisible();
  expect(moves).toHaveLength(3);
  expect(errors).toEqual([]);
});

test("背景音乐默认关闭，实际WAV可播、音量可记住且能暂停", async ({ page }) => {
  await page.goto("/");
  const audio = page.locator("audio");
  await expect(page.getByRole("button", { name: "播放背景音乐", exact: true })).toBeVisible();
  expect(await audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
  await page.getByRole("button", { name: "播放背景音乐", exact: true }).click();
  await expect(page.getByRole("button", { name: "暂停背景音乐", exact: true })).toBeVisible();
  await expect.poll(async () => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(.1);
  await expect.poll(async () => audio.evaluate((element: HTMLAudioElement) => element.volume)).toBeGreaterThan(.1);
  expect(await audio.evaluate((element: HTMLAudioElement) => element.duration)).toBeCloseTo(64, 1);
  await page.getByLabel("音乐设置", { exact: true }).click();
  await page.getByRole("slider", { name: "音乐音量", exact: false }).fill("12");
  await expect.poll(async () => audio.evaluate((element: HTMLAudioElement) => element.volume)).toBeCloseTo(.12, 2);
  await page.getByRole("button", { name: "暂停背景音乐", exact: true }).click();
  await expect.poll(async () => audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
  await page.reload();
  await page.getByLabel("音乐设置", { exact: true }).click();
  await expect(page.getByRole("slider", { name: "音乐音量", exact: false })).toHaveValue("12");
  expect(await audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
});

test("390像素宽的分光台与音乐设置可用", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/v1/adventure{,/**}", route => route.fulfill({ json: route.request().url().includes("/prism")
    ? { unlocked: true, stage: 0, revision: 0, release_id: "fixture", discovered: [], trail: [], mastery: "unverified" }
    : { stage: 3, revision: 3, release_id: "fixture", discovered: ["entity-0068"], trail: [], mastery: "unverified" } }));
  await page.goto("/");
  await page.getByRole("button", { name: "探索分光台", exact: true }).click();
  await expect(page.getByRole("slider", { name: "第3束偏好", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: ".runtime/screenshots/prism-mobile.png", fullPage: true, animations: "disabled" });
  await page.getByLabel("音乐设置", { exact: true }).click();
  await expect(page.getByRole("slider", { name: "音乐音量", exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("音乐加载失败给出反馈，仍可进入和操作机关", async ({ page }) => {
  await page.route("**/api/v1/adventure", route => route.fulfill({ json: { stage: 0, revision: 0, release_id: "fixture", discovered: [], trail: [], mastery: "unverified" } }));
  await page.route("**/audio/mist-sea-glow.wav", route => route.abort("failed"));
  await page.goto("/");
  await page.getByRole("button", { name: "播放背景音乐", exact: true }).click();
  await expect(page.locator(".music-message")).toContainText(/音乐/);
  await page.getByRole("button", { name: "探索第一束光", exact: true }).click();
  await expect(page.getByRole("slider", { name: "第三座的信号", exact: true })).toBeVisible();
  await page.getByRole("slider", { name: "第三座的信号", exact: true }).fill("30");
  await expect(page.getByTestId("beacon-output-0")).toHaveText("2.00");
});
