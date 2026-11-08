import { describe, expect, it } from "vitest";
import solutions from "../../../../data/games/expedition-fixtures.json";
import { initialLab, labMetrics, labSatisfied, mse, trajectory, type ExpeditionIsland } from "./expedition";

describe("三章各机关的可达条件", () => {
  for (const [id, stages] of Object.entries(solutions)) {
    it(`${id}三步有可解配置，初始第一步不会无操作通过`, () => {
      const node = id as ExpeditionIsland;
      expect(labSatisfied(node, 0, initialLab(node, 0))).toBe(false);
      stages.forEach((patch, stage) => {
        const state = { ...initialLab(node, stage), ...patch };
        expect(labSatisfied(node, stage, state)).toBe(true);
        expect(labMetrics(node, stage, state).every(Number.isFinite)).toBe(true);
      });
    });
  }
  it("梯度下降轨迹匹配闭式解，而过大步长发散", () => {
    const { weight, path } = trajectory(.1, 2), ratio = 1 - 28 * .1 / 3;
    expect(weight).toBeCloseTo(2 - 2 * ratio ** 2, 12);
    path.forEach((loss, index) => expect(loss).toBeCloseTo((56 / 3) * ratio ** (2 * index), 10));
    expect(trajectory(.3, 2).path.at(-1)!).toBeGreaterThan(mse(0) * 2);
  });
  it("交叉熵不把高置信错类当作低损失", () => {
    const state = { ...initialLab("entropy", 1), probability: .1 };
    const metrics = labMetrics("entropy", 1, state);
    expect(metrics[1]).toBeGreaterThan(metrics[0]);
    expect(metrics[3]).toBeCloseTo(Math.log(10), 12);
  });
  it("L2最优点与无正则不同，缓存计数不把历史读取当零", () => {
    const l2 = labMetrics("l2", 1, { ...initialLab("l2", 1), weight: .5 });
    expect(l2).toEqual([.25, .25, .5]);
    const cache = labMetrics("cache", 1, { ...initialLab("cache", 1), reuse: true });
    expect(cache[0]).toBeCloseTo(cache[1], 12); expect(cache.slice(2)).toEqual([1, 3]);
  });
});
