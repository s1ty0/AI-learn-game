import type { ConceptNode, GraphPayload } from "./api";

export type Discovery = { id: string; name: string; chapters: string[]; origins: { node_id: string; title: string; chapter: string; release_id: string; completed_at: string | null; hint_used: boolean }[] };
export type DiscoveryRelation = { id: string; source: string; target: string; statement: string; conditions: string; review_status: string; source_ids: string[]; release_id: string };
export type Discoveries = { release_id: string; status: "draft"; mastery: "unverified"; chapters: { id: string; title: string }[]; entities: Discovery[]; relations: DiscoveryRelation[] };
export type PersonalEdge = GraphPayload["edges"][number] & { note?: string; reference_id?: string | null; reference_release?: string | null };

export function visibleGraph(graph: GraphPayload, discoveries: Discoveries, chapter: string) {
  const known = new Set(discoveries.entities.filter(e => chapter === "all" || e.chapters.includes(chapter)).map(e => e.id));
  const nodes = graph.nodes.filter(node => known.has(node.id));
  const included = new Set(nodes.map(node => node.id));
  return { nodes, edges: graph.edges.filter(edge => included.has(edge.source) && included.has(edge.target)) };
}

export function addDiscoveries(graph: GraphPayload, discoveries: Discovery[]): GraphPayload {
  const ids = new Set(graph.nodes.map(node => node.id));
  const added = discoveries.filter(e => !ids.has(e.id));
  const offset = graph.nodes.length ? Math.max(...graph.nodes.map(node => node.position.y)) + 160 : 0;
  const nodes: ConceptNode[] = added.map((entity, index) => ({ id: entity.id, type: "knowledge",
    position: { x: (index % 3) * 250, y: offset + Math.floor(index / 3) * 150 },
    data: { label: entity.name, subtitle: "探索发现 · 待验证", category: "custom", note: "",
      discovery_origins: entity.origins.map(origin => ({ node_id: origin.node_id, release_id: origin.release_id })) } }));
  return { nodes: [...graph.nodes, ...nodes], edges: graph.edges };
}

export function addRelation(graph: GraphPayload, proposal: DiscoveryRelation): GraphPayload {
  const ids = new Set(graph.nodes.map(node => node.id));
  if (graph.edges.length >= 500 || !ids.has(proposal.source) || !ids.has(proposal.target) || graph.edges.some(edge => edge.source === proposal.source && edge.target === proposal.target)) return graph;
  let id = `suggested:${proposal.id}`;
  for (let suffix = 1; graph.edges.some(edge => edge.id === id); suffix++) id = `suggested:${proposal.id}:${suffix}`;
  return { ...graph, edges: [...graph.edges, { id, source: proposal.source, target: proposal.target,
    label: proposal.statement, note: "", reference_id: proposal.id, reference_release: proposal.release_id } as PersonalEdge] };
}

export function graphDifference(before: GraphPayload, after: GraphPayload) {
  const items: { kind: string; label: string; before?: string; after?: string }[] = [];
  const oldNodes = new Map(before.nodes.map(n => [n.id, n])), newNodes = new Map(after.nodes.map(n => [n.id, n]));
  for (const [id, node] of newNodes) {
    const old = oldNodes.get(id);
    if (!old) items.push({ kind: "新增知识", label: node.data.label });
    else {
      if (old.data.note !== node.data.note || old.data.label !== node.data.label || old.data.subtitle !== node.data.subtitle) items.push({ kind: "修改理解", label: node.data.label, before: `${old.data.label} · ${old.data.subtitle}\n${old.data.note}`, after: `${node.data.label} · ${node.data.subtitle}\n${node.data.note}` });
      if (old.position.x !== node.position.x || old.position.y !== node.position.y) items.push({ kind: "移动位置", label: node.data.label });
    }
  }
  for (const [id, node] of oldNodes) if (!newNodes.has(id)) items.push({ kind: "移除知识", label: node.data.label });
  const oldEdges = new Map(before.edges.map(e => [e.id, e as PersonalEdge])), newEdges = new Map(after.edges.map(e => [e.id, e as PersonalEdge]));
  for (const [id, edge] of newEdges) {
    const old = oldEdges.get(id);
    if (!old) items.push({ kind: "新增连接", label: String(edge.label ?? "待解释的关系") });
    else if (old.source !== edge.source || old.target !== edge.target || old.label !== edge.label || (old.note ?? "") !== (edge.note ?? "")) items.push({ kind: "修改关系", label: String(edge.label ?? "待解释的关系"), before: `${old.source} → ${old.target}\n${old.label ?? ""}\n${old.note ?? ""}`, after: `${edge.source} → ${edge.target}\n${edge.label ?? ""}\n${edge.note ?? ""}` });
  }
  for (const [id, edge] of oldEdges) if (!newEdges.has(id)) items.push({ kind: "移除连接", label: String(edge.label ?? "待解释的关系") });
  return items;
}
