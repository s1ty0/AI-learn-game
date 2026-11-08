import { blockOrder, towerIds, towerMetrics, towerSatisfied } from "./tower";
import { voyageIds, voyageMetrics, voyageSatisfied } from "./voyage";

export type ExpeditionIsland = "token" | "embedding" | "position" | "ffn" | "loss" | "gradient" | "descent" | "l2" | "temperature" | "entropy" | "generation" | "cache" | "residual" | "normalization" | "block" | "backprop" | "batch" | "momentum" | "adam" | "clipping" | "topk" | "topp" | "sampling" | "stopping";
export type LabState = {
  cuts: number[]; rows: number[]; position_enabled: boolean; amount: number; inputs: number[]; weight: number; probes: number[];
  rate: number; steps: number; lam: number; temperature: number; probability: number; sequence: string[]; reuse: boolean; modes: string[]; reason: string | null; chain: string[]; local_slope: number;
  momentum_beta: number; correct_bias: boolean; clip_enabled: boolean; max_norm: number; keep_count: number; cutoff: number; draws: number; draw_set: number; stop_enabled: boolean; token_limit: number;
};
export type ExpeditionNode = { id: ExpeditionIsland; chapter: string; title: string; concept: string; kind: string; requires: string[];
  entity_ids: string[]; steps: { title: string; goal: string; hint: string }[]; discovery: string; boundary: string;
  unlocked: boolean; stage: number; revision: number; release_id: string; trail: { stage: number; created_at: string; hint_used: boolean }[] };
export type Expedition = { id: string; version: string; release_id: string; nodes: ExpeditionNode[];
  chapters: { id: string; title: string; theme: string; main_path: string[]; unlocked: boolean; completed: boolean; main_completed: number; all_explored: boolean }[];
  next_node: ExpeditionIsland; main_completed: number; main_total: number; chapter_total: number; node_total: number; mechanism_total: number; completed: boolean; all_explored: boolean; unlocked: boolean; mastery: "unverified" };

export const table = [[1, 0], [0, 1], [1, 1]];
export function initialLab(node: ExpeditionIsland, stage: number): LabState {
  const state: LabState = { cuts: [], rows: [], position_enabled: false, amount: 1, inputs: [-1, 2, 3], weight: 0, probes: [], rate: .1,
    steps: 0, lam: 0, temperature: 1, probability: .4, sequence: ["A"], reuse: false, modes: [], reason: null, chain: [], local_slope: 0,
    momentum_beta: 0, correct_bias: false, clip_enabled: false, max_norm: 1, keep_count: 4, cutoff: 1, draws: 0, draw_set: 0, stop_enabled: false, token_limit: 4 };
  if (node === "token" && stage > 0) state.cuts = [2, 3, 5];
  if (node === "embedding" && stage === 2) state.rows = [2, 0, 2];
  if (node === "position" && stage > 0) { state.position_enabled = true; if (stage === 2) state.amount = 2; }
  if (node === "ffn" && stage > 0) state.inputs = [1, stage === 1 ? 2 : 0, 3];
  if (node === "loss" && stage === 2) { state.weight = 2; state.probes = [1, 3]; }
  if (node === "gradient") state.weight = stage === 1 ? 4 : 0;
  if (node === "descent" && stage === 1) state.rate = .3;
  if (node === "l2") { if (stage > 0) { state.weight = 1; state.lam = 1; } if (stage === 2) state.weight = .5; }
  if (node === "temperature" && stage > 0) state.temperature = stage === 1 ? .5 : 2;
  if (node === "entropy" && stage > 0) state.probability = stage === 1 ? .8 : .1;
  if (node === "generation" && stage > 0) state.sequence = stage === 1 ? ["A", "B"] : ["A", "B", "C", "A"];
  if (node === "cache" && stage > 0) state.modes = ["full", "cached"];
  if (node === "residual") { state.weight = stage === 2 ? -1 : .5; state.reuse = stage > 0; }
  if (node === "normalization") { state.inputs = [1, 2, 3]; state.amount = 0; state.position_enabled = stage > 0; }
  if (node === "block") state.chain = stage === 0 ? [] : stage === 1 ? blockOrder.slice(0, 3) : [...blockOrder];
  if (node === "backprop") { state.weight = stage === 1 ? 2 : 1; state.local_slope = stage === 1 ? -2 : stage === 2 ? 2 : 0; }
  if (node === "batch" && stage > 0) state.rows = stage === 1 ? [0, 1, 2] : [0, 1];
  if (node === "momentum" && stage === 2) state.momentum_beta = .9;
  if (node === "adam" && stage === 2) state.correct_bias = true;
  if (node === "clipping" && stage === 2) state.clip_enabled = true;
  if (node === "topk" && stage > 0) state.keep_count = stage === 1 ? 2 : 1;
  if (node === "topp" && stage > 0) state.cutoff = stage === 1 ? .65 : .85;
  if (node === "stopping" && stage === 2) state.stop_enabled = true;
  return state;
}

export const mse = (weight: number) => [1, 2, 3].reduce((sum, x) => sum + (weight * x - 2 * x) ** 2, 0) / 3;
export function tokenParts(stage: number, cuts: number[]) {
  const sentence = stage === 1 ? "AI让AI发光" : "AI让学习发光";
  const positions = [0, ...cuts.toSorted((a, b) => a - b), sentence.length];
  return positions.slice(0, -1).map((start, index) => sentence.slice(start, positions[index + 1]));
}
export function vocabulary(stage: number) { return stage === 2 ? ["AI", "让", "学习", "发光", "学习发光"] : ["AI", "让", "学习", "发光"]; }
export function trajectory(rate: number, steps: number) {
  let weight = 0;
  const path = [mse(weight)];
  for (let i = 0; i < steps; i++) { weight -= rate * (28 / 3) * (weight - 2); path.push(mse(weight)); }
  return { weight, path };
}
export function labMetrics(node: ExpeditionIsland, stage: number, s: LabState): number[] {
  if (voyageIds.includes(node)) return voyageMetrics(node, s);
  if (towerIds.includes(node)) return towerMetrics(node, s);
  if (node === "token") { const parts = tokenParts(stage, s.cuts); return [parts.length, ...parts.map(part => vocabulary(stage).indexOf(part))]; }
  if (node === "embedding") return [s.rows.length, ...s.rows.flatMap(row => table[row] ?? [])];
  if (node === "position") return [0, 1, 2].map(index => 2 + (s.position_enabled ? index * s.amount : 0));
  if (node === "ffn") return [...s.inputs, ...s.inputs.map(value => Math.max(0, 2 * value - 1))];
  if (node === "loss") return [s.weight, 2 * s.weight, 3 * s.weight, mse(s.weight), ...s.probes.map(mse)];
  if (node === "gradient") return [(s.weight - 2) ** 2, 2 * (s.weight - 2), (s.weight - .1 - 2) ** 2, (s.weight + .1 - 2) ** 2];
  if (node === "descent") { const { weight, path } = trajectory(s.rate, s.steps); return [weight, ...path]; }
  if (node === "l2") { const error = (s.weight - 1) ** 2, penalty = s.lam * s.weight ** 2; return [error, penalty, error + penalty]; }
  if (node === "temperature") { const values = [0, 1, 3].map(logit => Math.exp((logit - 3) / s.temperature)); const sum = values.reduce((a, b) => a + b, 0); return values.map(value => value / sum); }
  if (node === "entropy") return [s.probability, (1-s.probability)*.75, (1-s.probability)*.25, -Math.log(s.probability)];
  if (node === "generation") return [s.sequence.length, ...s.sequence.map(token => ["A", "B", "C"].indexOf(token))];
  const ratio = Math.exp(Math.sqrt(2));
  const result = (2 + 6 + 10 * ratio) / (2 + ratio);
  return [result, result, s.reuse ? 1 : 3, 3];
}

export function labSatisfied(node: ExpeditionIsland, stage: number, s: LabState) {
  if (voyageIds.includes(node)) return voyageSatisfied(node, stage, s);
  if (towerIds.includes(node)) return towerSatisfied(node, stage, s);
  const metrics = labMetrics(node, stage, s);
  if (node === "token") return JSON.stringify(s.cuts.toSorted((a,b) => a-b)) === JSON.stringify(stage === 2 ? [2, 3] : [2, 3, 5]) && (stage !== 1 || s.reason === "same-id");
  if (node === "embedding") return JSON.stringify(s.rows) === JSON.stringify(stage === 1 ? [1, 2] : [2, 0, 2]) && (stage !== 2 || s.reason === "address");
  if (node === "position") return s.position_enabled && (stage === 0 ? s.amount > 0 : Math.abs(metrics[2] - 6) < 1e-6) && (stage !== 2 || s.reason === "order");
  if (node === "ffn") return s.inputs[0] >= 1 && s.inputs[2] === 3 && (stage === 0 ? s.inputs[1] === 2 : s.inputs[1] <= 0) && (stage !== 2 || s.reason === "pointwise");
  if (node === "loss") return stage === 0 ? s.weight === 2 : stage === 1 ? s.probes.includes(1) && s.probes.includes(3) : s.reason === "squared-mean";
  if (node === "gradient") return stage === 0 ? s.weight >= 1 && s.weight <= 2 : stage === 1 ? s.weight >= 2 && s.weight <= 3 : s.weight === 2 && s.reason === "local-slope";
  if (node === "descent") return s.steps >= 2 && (stage === 1 ? metrics.at(-1)! > mse(0)*2 : metrics.at(-1)! < .01) && (stage !== 2 || s.steps <= 4 && s.reason === "negative-gradient");
  if (node === "l2") return stage === 0 ? s.lam === 0 && s.weight === 1 : s.lam === 1 && s.weight === .5 && (stage !== 2 || s.reason === "tradeoff");
  if (node === "temperature") return stage === 0 ? metrics[2] > .95 : stage === 1 ? metrics[2] < .65 : s.reason === "distribution";
  if (node === "entropy") return stage === 0 ? metrics[3] < .25 : stage === 1 ? Math.abs(s.probability - .1) < 1e-6 : s.reason === "target";
  if (node === "generation") return JSON.stringify(s.sequence) === JSON.stringify(stage === 0 ? ["A", "B"] : ["A", "B", "C", "A"]) && (stage !== 2 || s.reason === "append-history");
  return stage === 0 ? s.modes.includes("full") && s.modes.includes("cached") : s.reuse && (stage !== 2 || s.reason === "reuse-history");
}

export const explanations: Record<ExpeditionIsland, { id: string; text: string }[]> = {
  batch: [{ id: "batch-direction", text: "批次改变平均梯度，单步不保证整批目标下降" }, { id: "always-full", text: "每个小批次都必须和整批同方向" }, { id: "no-gradient", text: "选了小批次就不需要计算梯度" }],
  momentum: [{ id: "history-state", text: "历史状态与当前梯度一起决定更新" }, { id: "current-only", text: "只要当前梯度变号，更新必立刻变号" }, { id: "always-faster", text: "任何任务用动量都会更快收敛" }],
  adam: [{ id: "two-moments", text: "历史一阶矩与平方梯度二阶矩共同缩放更新" }, { id: "just-rate", text: "Adam只是把所有坐标学习率一起增大" }, { id: "always-zero", text: "当前梯度为零就必定没有参数变化" }],
  clipping: [{ id: "preserve-direction", text: "统一缩放梯度长度，保留非零梯度方向" }, { id: "clip-each", text: "把每个分量都截成同一个最大值" }, { id: "replace-rate", text: "裁剪后不再需要学习率" }],
  topk: [{ id: "candidate-set", text: "先保留最高的k个候选，再在集合内归一化" }, { id: "kth-only", text: "无论概率如何，都直接选择第k名" }, { id: "truth-filter", text: "保留下来的候选一定符合事实" }],
  topp: [{ id: "cumulative-prefix", text: "累计到首次达到阈值，保留这个最短前缀" }, { id: "individual-p", text: "只保留单个概率大于p的所有候选" }, { id: "fixed-count", text: "任意分布下都固定保留p个候选" }],
  sampling: [{ id: "finite-observation", text: "有限次频数随观测点变化，不能当作分布本身" }, { id: "ten-proof", text: "十次频数一定严格等于真实概率" }, { id: "fake-random", text: "预设观测点就是通过了随机性检验" }],
  stopping: [{ id: "stop-boundaries", text: "EOS可提前停止，新增上限提供另一条边界" }, { id: "prefix-count", text: "新增token上限必须包含提示前缀" }, { id: "quality-done", text: "停止就说明内容已经完整且正确" }],
  residual: [{ id: "identity-path", text: "零修正时仍保留原输入的恒等支路" }, { id: "always-grow", text: "残差只允许信号越来越大" }, { id: "no-gradient-loss", text: "任意深度的梯度都不会消失" }],
  normalization: [{ id: "feature-axis", text: "本关在同一token的特征维统计" }, { id: "batch-axis", text: "本关把不同样本混合统计" }, { id: "token-axis", text: "本关把所有token平均为一个值" }],
  block: [{ id: "pre-norm", text: "本关先归一化再进子层，另有Post-LN约定" }, { id: "only-order", text: "所有Transformer都只能采用这个顺序" }, { id: "replace-skip", text: "归一化会替代残差支路" }],
  backprop: [{ id: "chain-product", text: "沿单条链组合局部导数，多路径还需累加" }, { id: "sum-factors", text: "任何计算图都只把局部导数相加" }, { id: "update-first", text: "先更新参数，再补算旧参数的梯度" }],
  token: [{ id: "same-id", text: "同一词表中相同token对应同一编号" }, { id: "position-id", text: "同一个token换位置就必须换编号" }, { id: "bigger-meaning", text: "编号越大语义越重要" }],
  embedding: [{ id: "address", text: "编号是查表地址，向量才是表示" }, { id: "raw-coordinate", text: "编号本身就是向量坐标" }, { id: "ordered-meaning", text: "编号差就是语义距离" }],
  position: [{ id: "order", text: "补充顺序线索，内容表示仍然保留" }, { id: "replace-content", text: "用位置编号替代全部内容" }, { id: "change-vocab", text: "重新给词表中的每个词编号" }],
  ffn: [{ id: "pointwise", text: "同一函数分别加工各位置的输入" }, { id: "gather-all", text: "直接把所有位置取平均" }, { id: "no-context", text: "输入不可能包含其他位置的信息" }],
  loss: [{ id: "squared-mean", text: "各处误差平方后求平均" }, { id: "signed-sum", text: "让正负误差互相抵消" }, { id: "max-only", text: "永远只看误差最大的一处" }],
  gradient: [{ id: "local-slope", text: "描述当前位置的局部变化率" }, { id: "global-proof", text: "任意函数梯度为零就全局最优" }, { id: "loss-itself", text: "坡度就是损失值本身" }],
  descent: [{ id: "negative-gradient", text: "沿负梯度，用步长控制更新幅度" }, { id: "positive-gradient", text: "沿梯度越大越好" }, { id: "any-rate", text: "只要方向对，步长多大都一样" }],
  l2: [{ id: "tradeoff", text: "在拟合与参数大小之间权衡" }, { id: "always-better", text: "正则越强测试表现一定越好" }, { id: "no-cost", text: "不改目标，也不会牺牲训练拟合" }],
  temperature: [{ id: "distribution", text: "改变概率分布，不重训参数" }, { id: "truth", text: "降低温度就保证事实正确" }, { id: "train-again", text: "每次调温度都重新训练模型" }],
  entropy: [{ id: "target", text: "看真实目标被分到多少概率" }, { id: "top-only", text: "只看模型最高预测有多自信" }, { id: "all-equal", text: "目标是谁不影响损失" }],
  generation: [{ id: "append-history", text: "选下一个，追加到历史，再预测" }, { id: "all-at-once", text: "一次同时生成全部未来符号" }, { id: "restart", text: "每步丢掉历史并重新开始" }],
  cache: [{ id: "reuse-history", text: "复用历史K/V，新查询仍读取它们" }, { id: "zero-compute", text: "有缓存后就完全不需要计算" }, { id: "ignore-past", text: "有缓存后不再需要历史信息" }]
};
