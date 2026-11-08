import { describe, expect, it } from "vitest";
import { initialLab, labMetrics, labSatisfied } from "./expedition";
import { adamTrace, filtered, momentumTrace, samplingTrace, stoppingTrace } from "./voyage";

describe("优化和解码的参照与边界", () => {
  it("手选小批次与完整批次的平均梯度可反向，完整目标可升高", () => {
    expect(labMetrics("batch", 0, { ...initialLab("batch", 0), rows: [0, 1, 2], steps: 1 })).toEqual([3, -1, .1, 3.5, 3.405]);
    const partial = labMetrics("batch", 1, { ...initialLab("batch", 1), rows: [0, 1], steps: 1 });
    expect(partial[2]).toBe(-.05); expect(partial[4]).toBeCloseTo(3.55125, 12); expect(partial[4]).toBeGreaterThan(partial[3]);
  });
  it("动量当前梯度为负时累计速度仍可为正", () => {
    const t = momentumTrace(.9, 3);
    expect(t.weight).toBeCloseTo(-.361, 12); expect(t.velocity).toBeCloseTo(.71, 12);
    expect(t.path[2].gradient).toBe(-1); expect(momentumTrace(0, 3).weight).toBeCloseTo(-.1, 12);
  });
  it("Adam常梯度的前两步符合修正后闭式解，零新梯度仍可能更新", () => {
    [2, .2].forEach((g, i) => {
      expect(adamTrace(1, true).weight[i]).toBeCloseTo(-.1*g/(Math.abs(g)+1e-8), 12);
      expect(adamTrace(2, true).weight[i]).toBeCloseTo(-.2*g/(Math.abs(g)+1e-8), 12);
    });
    expect(adamTrace(1, false).weight[0]).toBeCloseTo(-.1 * .2 / (Math.sqrt(.004)+1e-8), 12);
    expect(adamTrace(3, true).weight[0]).toBeLessThan(adamTrace(2, true).weight[0]);
  });
  it("全局裁剪保持方向和范数，而非逐分量截断", () => {
    const m = labMetrics("clipping", 1, { ...initialLab("clipping", 1), clip_enabled: true, max_norm: 1 });
    expect(m[2]).toBeCloseTo(.6, 12); expect(m[3]).toBeCloseTo(.8, 12);
    expect(Math.hypot(m[2],m[3])).toBeCloseTo(1,12); expect(m[2]*4-m[3]*3).toBeCloseTo(0,12);
  });
  it("Top-p包含跨阈值候选，在精确累计边界不多留一项", () => {
    for (const [p, keep] of [[.05,1],[.4,1],[.4001,2],[.7,2],[.7001,3],[.9,3],[1,4]]) {
      const t = filtered("topp",4,p); expect(t.keep).toBe(keep); expect(t.normalized.reduce((a,b)=>a+b,0)).toBeCloseTo(1,12);
    }
    expect(filtered("topk", 2, 1).normalized[0]).toBeCloseTo(4/7,12);
  });
  it("固定点得到明确频数，EOS与数量边界阻止额外提交", () => {
    expect(samplingTrace(10,0).counts).toEqual([4,3,2,1]); expect(samplingTrace(10,1).counts).toEqual([1,5,1,3]);
    expect(stoppingTrace(12,true,4).sequence).toEqual([0,1,2]); expect(stoppingTrace(12,false,1).sequence).toEqual([0,1]);
    expect(labSatisfied("stopping",0,{ ...initialLab("stopping",0), stop_enabled:true, steps:3 })).toBe(false);
  });
});
