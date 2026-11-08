import { expect, type Page } from "@playwright/test";
import config from "../../data/games/expedition.json";

export async function expeditionFixture(page: Page, chapter?: string, firstComplete = () => true) {
  const stages: Record<string, number> = Object.fromEntries(config.nodes.map(node => [node.id, 0]));
  if (chapter) {
    for (const group of config.chapters) {
      if (group.id === chapter) break;
      for (const id of group.main_path) stages[id] = 3;
    }
    await page.route("**/api/v1/adventure{,/**}", route => route.fulfill({ json: { unlocked: true, stage: 3, revision: 3, discovered: [], release_id: "fixture", mastery: "unverified", trail: [] } }));
    await page.route("**/api/v1/chapter{,/**}", route => route.fulfill({ json: { id: "information-sea", title: "信息之海", completed: true, all_explored: true,
      main_completed: 4, main_total: 4, next_node: "beacon", nodes: [], mastery: "unverified" } }));
  }
  const moves: Record<string, unknown>[] = [];
  let fail = false;
  const main = config.chapters.flatMap(group => group.main_path);
  function state() {
    const unlocked = (requires: string[]) => requires.every(id => id === "beacon" ? firstComplete() : stages[id] === 3);
    return { ...config, release_id: "fixture", unlocked: firstComplete(), mastery: "unverified", main_total: 4 + main.length,
      chapter_total: 1 + config.chapters.length, node_total: 5 + config.nodes.length, mechanism_total: 15 + config.nodes.reduce((sum, node) => sum + node.steps.length, 0),
      main_completed: 4 + main.filter(id => stages[id] === 3).length,
      completed: firstComplete() && main.every(id => stages[id] === 3), all_explored: Object.values(stages).every(stage => stage === 3),
      next_node: main.find(id => stages[id] < 3) ?? main.at(-1),
      chapters: config.chapters.map(group => { const opened = config.nodes.some(node => node.chapter === group.id && unlocked(node.requires));
        return { ...group, title: opened ? group.title : "迷雾中的海域", theme: opened ? group.theme : "继续航行后显现", unlocked: opened,
          main_completed: group.main_path.filter(id => stages[id] === 3).length, completed: group.main_path.every(id => stages[id] === 3) }; }),
      nodes: config.nodes.map(node => ({ ...node, title: unlocked(node.requires) ? node.title : "迷雾", unlocked: unlocked(node.requires),
        stage: stages[node.id], revision: stages[node.id], release_id: "fixture", trail: Array.from({ length: stages[node.id] }, (_, stage) => ({ stage, hint_used: false, created_at: "2026-11-08T00:00:00Z" })) })) };
  }
  await page.route("**/api/v1/expedition{,/**}", async route => {
    if (route.request().url().includes("/lessons/")) { await route.fulfill({ json: { markdown: "## 示例的条件\n这是机制档案夹具。" } }); return; }
    if (route.request().method() === "POST") {
      if (fail) { fail = false; await route.fulfill({ status: 503, json: { detail: "retry" } }); return; }
      const id = route.request().url().split("/").at(-2)!;
      const body = route.request().postDataJSON();
      expect(body.base_revision).toBe(stages[id]); expect(body.stage).toBe(stages[id]);
      moves.push({ node: id, ...body }); stages[id]++;
    }
    await route.fulfill({ json: state() });
  });
  return { stages, moves, failNext: () => { fail = true; } };
}
