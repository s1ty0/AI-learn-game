import type { LabState } from "./expedition";

export const towerIds = ["residual", "normalization", "block", "backprop"];
export const blockOrder = ["norm-attention", "attention", "add-attention", "norm-ffn", "ffn", "add-ffn"];
export const blockLabels: Record<string, string> = {
  "norm-attention": "LN₁ · 校准输入", attention: "Attention · 汇聚", "add-attention": "加回 x",
  "norm-ffn": "LN₂ · 校准中间值", ffn: "FFN · 逐位置加工", "add-ffn": "加回 h",
};
export function towerMetrics(node: string, s: LabState): number[] {
  if (node === "residual") return [s.weight, ...[1, 2, 3].map(x => s.reuse ? x + s.weight : s.weight)];
  if (node === "normalization") {
    const values = s.inputs.map(x => x + s.amount), mean = values.reduce((a, b) => a + b, 0) / 3;
    const variance = values.reduce((sum, x) => sum + (x - mean) ** 2, 0) / 3;
    return [mean, variance, ...values.map(x => s.position_enabled ? (x - mean) / Math.sqrt(variance + 1e-5) : x)];
  }
  if (node === "block") return [s.chain.length, ...s.chain.map(item => blockOrder.indexOf(item))];
  if (node === "backprop") {
    const prediction = 2 * s.weight, error = prediction - 3, local = 2 * error;
    return [prediction, error ** 2, local, 2, 2 * local, 2 * s.local_slope];
  }
  throw new Error("Unknown tower mechanism");
}
export function towerSatisfied(node: string, stage: number, s: LabState) {
  if (node === "residual") return s.reuse && s.weight === [.5, -1, 0][stage] && (stage !== 2 || s.reason === "identity-path");
  if (node === "normalization") return s.position_enabled && JSON.stringify(s.inputs) === JSON.stringify(stage === 2 ? [2, 2, 2] : [1, 2, 3]) && (stage !== 1 || s.amount === 2) && (stage !== 2 || s.reason === "feature-axis");
  if (node === "block") return JSON.stringify(s.chain) === JSON.stringify(stage === 0 ? blockOrder.slice(0, 3) : blockOrder) && (stage !== 2 || s.reason === "pre-norm");
  if (node === "backprop") return s.weight === [1, 2, 1.5][stage] && s.local_slope === 2 * (2 * s.weight - 3) && (stage !== 2 || s.reason === "chain-product");
  return false;
}
