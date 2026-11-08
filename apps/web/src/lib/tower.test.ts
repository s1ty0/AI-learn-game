import { describe, expect, it } from "vitest";
import { initialLab, labMetrics, labSatisfied } from "./expedition";
import { blockOrder } from "./tower";

describe("积木高塔的独立参照与反例", () => {
  it("归一化等于手算总体方差，平移不改变结果，常数输入有限", () => {
    const base = { ...initialLab("normalization", 0), position_enabled: true };
    const output = labMetrics("normalization", 0, base);
    expect(output[0]).toBe(2); expect(output[1]).toBeCloseTo(2 / 3, 12);
    expect(output[2]).toBeCloseTo(-1 / Math.sqrt(2 / 3 + .00001), 12);
    expect(output[3]).toBe(0); expect(output[4]).toBeCloseTo(-output[2], 12);
    const shifted = labMetrics("normalization", 1, { ...base, amount: 2 });
    shifted.slice(2).forEach((value, index) => expect(value).toBeCloseTo(output[index + 2], 12));
    expect(labMetrics("normalization", 2, { ...base, inputs: [2, 2, 2] })).toEqual([2, 0, 0, 0, 0]);
  });
  it("沿链的解析梯度与独立中心差分一致，选错局部因子不能通过", () => {
    const h = .00001, objective = (w: number) => (2 * w - 3) ** 2;
    for (const w of [0, .5, 1, 1.5, 2, 3]) {
      const metrics = labMetrics("backprop", 0, { ...initialLab("backprop", 0), weight: w });
      expect(metrics[4]).toBeCloseTo((objective(w + h) - objective(w - h)) / (2 * h), 8);
    }
    expect(labSatisfied("backprop", 0, { ...initialLab("backprop", 0), local_slope: 2 })).toBe(false);
  });
  it("残差零分支输出原输入，断开支路时不满足目标", () => {
    const state = { ...initialLab("residual", 2), weight: 0, reuse: true, reason: "identity-path" };
    expect(labMetrics("residual", 2, state)).toEqual([0, 1, 2, 3]);
    expect(labSatisfied("residual", 2, state)).toBe(true);
    expect(labSatisfied("residual", 2, { ...state, reuse: false })).toBe(false);
  });
  it("完整组件数量不能替代正确的Pre-LN依赖顺序", () => {
    const state = { ...initialLab("block", 2), chain: [...blockOrder], reason: "pre-norm" };
    expect(labSatisfied("block", 2, state)).toBe(true);
    expect(labSatisfied("block", 2, { ...state, chain: [blockOrder[1], blockOrder[0], ...blockOrder.slice(2)] })).toBe(false);
    expect(labSatisfied("block", 2, { ...state, reason: "only-order" })).toBe(false);
  });
});
