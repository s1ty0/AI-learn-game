import { describe, expect, it } from "vitest";
import { experiment, weights } from "./experiment";

describe("因果掩码实验", () => {
  it("阻止未来值改变前两个输出", () => {
    expect(experiment(true, 10).slice(0, 2)).toEqual(experiment(true, 30).slice(0, 2));
    expect(experiment(true, 30)[2][0]).toBeCloseTo(80 / 6);
  });
  it("关闭掩码后未来值会影响全部查询", () => {
    expect(experiment(false, 10)[0]).not.toEqual(experiment(false, 30)[0]);
    expect(experiment(false, 30)[0][0]).toBeCloseTo(80 / 6);
  });
  it("每行归一化且未来权重为零", () => {
    for (const [i, row] of weights(true).entries()) {
      expect(row.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
      row.forEach((weight, j) => { if (j > i) expect(weight).toBe(0); });
    }
  });
});
