import { describe, expect, it } from "vitest";
import { mixLight } from "./prism";

describe("分光台权重与输出", () => {
  it("相同偏好平均汇聚，不默认只选一束", () => {
    expect(mixLight([2, 2, 2]).weights).toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(mixLight([2, 2, 2]).output).toBeCloseTo(6);
  });
  it("同时平移分数不改变权重", () => {
    const a = mixLight([0, 1, 3]), b = mixLight([10, 11, 13]);
    a.weights.forEach((weight, index) => expect(weight).toBeCloseTo(b.weights[index], 12));
    expect(a.weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });
  it("提高第三束偏好推高汇聚值，转向第一束拉低汇聚值", () => {
    expect(mixLight([0, 0, 4]).output).toBeGreaterThan(9);
    expect(mixLight([4, 0, 0]).output).toBeLessThan(3);
  });
});
