import type { BrowserContext } from "@playwright/test";
import type { Snapshot } from "../../apps/web/src/lib/api";

// Only the seed read reaches the real API. All mutations and historical reads use
// a shared per-test memory store, including when the test opens a second tab.
// PostgreSQL persistence, conflicts and idempotency are covered by API tests.
export async function workbenchFixture(context: BrowserContext, supplied?: Snapshot) {
  let initial = supplied;
  if (!initial) {
    const seed = await context.request.get("http://127.0.0.1:3000/api/v1/learner-graph");
    if (!seed.ok()) throw new Error("Workbench seed unavailable");
    initial = await seed.json() as Snapshot;
  }
  const versions: Snapshot[] = [structuredClone({ ...initial, revision: 0, note: "独立浏览器夹具", restored_from: null })];
  const attempts: Record<string, unknown>[] = [];
  const operations = new Map<string, { hash: string; result: Snapshot }>();
  const current = () => structuredClone(versions.at(-1)!);
  await context.route("**/api/v1/learner-graph{,/**}", async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      const hash = JSON.stringify(body), prior = operations.get(body.operation_key);
      if (prior) { await route.fulfill({ status: prior.hash === hash ? 200 : 409, json: prior.hash === hash ? prior.result : { detail: "Operation key reused" } }); return; }
      if (body.base_revision !== current().revision) {
        await route.fulfill({ status: 409, json: { detail: { code: "revision_conflict", message: "另一处已更新此图。你的草稿已保留，请先查看最新版本。" } } }); return;
      }
      const restored = pathname.endsWith("/restore") ? versions.find(item => item.revision === body.revision) : null;
      const snapshot = { ...current(), revision: current().revision + 1, payload: structuredClone(restored?.payload ?? body.payload),
        note: restored ? `从 v${restored.revision} 恢复为新版本` : body.note, restored_from: restored?.revision ?? null, created_at: new Date().toISOString() };
      versions.push(snapshot); operations.set(body.operation_key, { hash, result: snapshot });
      await route.fulfill({ json: snapshot }); return;
    }
    const historical = pathname.match(/\/versions\/(\d+)$/);
    await route.fulfill({ json: historical ? versions.find(item => item.revision === Number(historical[1])) : pathname.endsWith("/versions") ? [...versions].reverse() : current() });
  });
  await context.route("**/api/v1/attempts", async route => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      const attempt = { id: `fixture-${attempts.length}`, explanation: body.explanation, prediction_correct: body.prediction === "same", status: "needs_review",
        created_at: new Date().toISOString(), message: "解释已保存，仍待复核；本次不自动标记掌握。", next_step: "补充这条关系并解释原因。" };
      attempts.unshift(attempt); await route.fulfill({ json: attempt }); return;
    }
    await route.fulfill({ json: attempts });
  });
  return { current };
}
