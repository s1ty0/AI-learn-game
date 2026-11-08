import { describe, expect, it } from "vitest";
import { queryAttention } from "./chapter";

describe("可控查询、掩码与头", () => {
  it("负x正y让第二把键最匹配，相同查询得到相同权重", () => {
    const a = queryAttention([-1, 1]);
    expect(a.weights[2][1]).toBeGreaterThan(a.weights[2][0]);
    expect(a.weights[2][1]).toBeGreaterThan(a.weights[2][2]);
    expect(a.weights[0]).toEqual(a.weights[2]);
  });
  it("两个查询能保留低值与高值两个输出", () => {
    expect(queryAttention([2, -2]).outputs[2]).toBeLessThan(4);
    expect(queryAttention([2, 2]).outputs[2]).toBeGreaterThan(8);
  });
  it("遮挡后改变未来值不影响前两个查询位置", () => {
    const a = queryAttention([2, 2], true, 10), b = queryAttention([2, 2], true, 30);
    expect(a.outputs.slice(0, 2)).toEqual(b.outputs.slice(0, 2));
    expect(b.outputs[2]).toBeGreaterThan(20);
    expect(b.weights[0]).toEqual([1, 0, 0]);
    expect(queryAttention([2, 2], false, 30).outputs[0]).not.toBe(a.outputs[0]);
  });
  it("用独立的两项softmax公式核对第二位置", () => {
    const actual = queryAttention([1, 0], true);
    const ratio = Math.exp(1 / Math.sqrt(2));
    expect(actual.outputs[1]).toBeCloseTo((2 * ratio + 6) / (ratio + 1), 12);
    actual.weights.forEach(row => expect(row.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12));
  });
});
