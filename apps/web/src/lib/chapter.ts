export type ChapterIsland = "mask" | "prism" | "query" | "heads" | "beacon";
export type Query = [number, number];
export type ChapterNode = {
  id: ChapterIsland; title: string; kind: "main" | "side" | "finale"; requires: ChapterIsland[];
  entity_ids: string[]; unlocked: boolean; stage: number; revision: number;
  status: "completed" | "available" | "locked"; release_id: string;
  trail: { stage: number; created_at: string; hint_used: boolean }[];
};
export type Chapter = { id: string; version: string; title: string; release_id: string; nodes: ChapterNode[];
  main_completed: number; main_total: number; completed: boolean; all_explored: boolean; next_node: ChapterIsland; mastery: "unverified" };

export const names = { mask: "回声小岛", prism: "分光台", query: "寻光镜", heads: "双镜湾", beacon: "归航灯塔" };
export const concepts = { mask: "可读范围", prism: "权重分配", query: "查询匹配", heads: "多个视角", beacon: "连接整条计算链" };
export const chain = ["match", "mask", "normalize", "mix"];
export const chainNames: Record<string, string> = { match: "查询与键匹配", mask: "屏蔽未来位置", normalize: "归一化成权重", mix: "按权重汇聚值" };

export function queryAttention(query: Query, mask = false, future = 10) {
  const scores = [query[0], query[1], query[0] + query[1]].map(value => value / Math.sqrt(2));
  const weights = [0, 1, 2].map(position => {
    const allowed = mask ? scores.slice(0, position + 1) : scores;
    const exp = allowed.map(score => Math.exp(score - Math.max(...allowed)));
    const sum = exp.reduce((a, b) => a + b, 0);
    return [...exp.map(value => value / sum), ...Array(3 - allowed.length).fill(0)] as number[];
  });
  return { scores, weights, outputs: weights.map(row => row.reduce((sum, weight, i) => sum + weight * [2, 6, future][i], 0)) };
}
