import type { LabState } from "./expedition";

export const voyageIds = ["batch", "momentum", "adam", "clipping", "topk", "topp", "sampling", "stopping"];
export const probabilities = [.4, .3, .2, .1];
export const drawPoints = [[.05, .15, .25, .35, .45, .55, .65, .75, .85, .95], [.1, .42, .49, .52, .61, .68, .72, .94, .96, .99]];
export function momentumTrace(beta: number, steps: number) {
  let weight = 0, velocity = 0;
  const path = [1, 1, -1].slice(0, steps).map(gradient => {
    velocity = beta * velocity + gradient; weight -= .1 * velocity;
    return { gradient, velocity, weight };
  });
  return { weight, velocity, path };
}
export function adamTrace(steps: number, corrected: boolean) {
  const weight = [0, 0], first = [0, 0], second = [0, 0], mhat = [0, 0], vhat = [0, 0];
  [[2, .2], [2, .2], [0, 0]].slice(0, steps).forEach((gradient, index) => {
    const t = index + 1;
    gradient.forEach((g, i) => {
      first[i] = .9 * first[i] + .1 * g; second[i] = .999 * second[i] + .001 * g * g;
      mhat[i] = corrected ? first[i] / (1 - .9 ** t) : first[i];
      vhat[i] = corrected ? second[i] / (1 - .999 ** t) : second[i];
      weight[i] -= .1 * mhat[i] / (Math.sqrt(vhat[i]) + 1e-8);
    });
  });
  return { weight, first, second, mhat, vhat, time: Math.min(steps, 3) };
}
export function filtered(node: string, count: number, cutoff: number) {
  let keep = count;
  if (node === "topp") {
    let cumulative = 0; keep = 0;
    for (const p of probabilities) { cumulative += p; keep++; if (cumulative >= cutoff - 1e-12) break; }
  }
  const mass = probabilities.slice(0, keep).reduce((a, b) => a + b, 0);
  return { keep, mass, normalized: probabilities.map((p, index) => index < keep ? p / mass : 0) };
}
export function samplingTrace(draws: number, drawSet: number) {
  const counts = [0, 0, 0, 0];
  const sequence = drawPoints[drawSet].slice(0, draws).map(point => {
    let cumulative = 0;
    const index = probabilities.findIndex(p => { cumulative += p; return point < cumulative; });
    counts[index]++; return index;
  });
  return { counts, sequence };
}
export function stoppingTrace(steps: number, eos: boolean, limit: number) {
  const sequence = [0]; let ended = false;
  for (let i = 0; i < Math.min(steps, limit) && !ended; i++) {
    const symbol = [1, 2, 0][sequence.at(-1)!]; sequence.push(symbol); ended = eos && symbol === 2;
  }
  const added = sequence.length - 1;
  return { sequence, ended, capped: added >= limit, added };
}
export function voyageMetrics(node: string, s: LabState): number[] {
  if (node === "batch") {
    const gradient = s.rows.length ? s.rows.reduce((sum, i) => sum + [2, -1, -4][i], 0) / s.rows.length : 0;
    const weight = s.steps ? -.1 * gradient : 0;
    const objective = (w: number) => [-2, 1, 4].reduce((sum, a) => sum + (w - a) ** 2, 0) / 6;
    return [s.rows.length, gradient, weight, objective(0), objective(weight)];
  }
  if (node === "momentum") { const t = momentumTrace(s.momentum_beta, s.steps); return [t.weight, t.velocity, ...t.path.flatMap(item => [item.gradient, item.velocity, item.weight])]; }
  if (node === "adam") { const t = adamTrace(s.steps, s.correct_bias); return [...t.weight, ...t.mhat, ...t.vhat, ...t.first, ...t.second, t.time]; }
  if (node === "clipping") { const scale = s.clip_enabled ? Math.min(1, s.max_norm / 5) : 1; return [5, scale, 3 * scale, 4 * scale, 5 * scale]; }
  if (node === "topk" || node === "topp") { const t = filtered(node, s.keep_count, s.cutoff); return [t.keep, t.mass, ...t.normalized]; }
  if (node === "sampling") { const t = samplingTrace(s.draws, s.draw_set); return [s.draws, ...t.counts, ...t.sequence]; }
  if (node === "stopping") { const t = stoppingTrace(s.steps, s.stop_enabled, s.token_limit); return [t.sequence.length, ...t.sequence, Number(t.ended), Number(t.capped), t.added]; }
  throw new Error("Unknown voyage mechanism");
}
export function voyageSatisfied(node: string, stage: number, s: LabState) {
  if (node === "batch") return JSON.stringify(s.rows.toSorted()) === JSON.stringify([[0, 1, 2], [0, 1], [1, 2]][stage]) && s.steps === 1 && (stage !== 2 || s.reason === "batch-direction");
  if (node === "momentum") return s.momentum_beta === [0, .9, .9][stage] && s.steps === [2, 2, 3][stage] && (stage !== 2 || s.reason === "history-state");
  if (node === "adam") return s.correct_bias === (stage > 0) && s.steps === (stage === 2 ? 3 : 1) && (stage !== 2 || s.reason === "two-moments");
  if (node === "clipping") return s.steps === 1 && s.clip_enabled === (stage > 0) && (stage === 0 || s.max_norm === (stage === 2 ? 2 : 1)) && (stage !== 2 || s.reason === "preserve-direction");
  if (node === "topk" || node === "topp") return filtered(node, s.keep_count, s.cutoff).keep === (node === "topk" ? [2, 1, 3] : [2, 3, 1])[stage] && (stage !== 2 || s.reason === (node === "topk" ? "candidate-set" : "cumulative-prefix"));
  if (node === "sampling") return s.draws === (stage === 0 ? 1 : 10) && s.draw_set === (stage === 2 ? 1 : 0) && (stage !== 2 || s.reason === "finite-observation");
  if (node === "stopping") { const t = stoppingTrace(s.steps, s.stop_enabled, s.token_limit); return s.steps === t.added && (stage === 0 ? s.stop_enabled && t.ended : stage === 1 ? !s.stop_enabled && s.token_limit === 1 && t.capped : s.stop_enabled && s.token_limit === 4 && t.ended && s.reason === "stop-boundaries"); }
  return false;
}
