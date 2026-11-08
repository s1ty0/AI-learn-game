"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ReactFlow, Background, Controls, Handle, Position, type NodeProps, type NodeChange, applyNodeChanges } from "@xyflow/react";
import { ArrowLeft, ArrowRight, BookOpen, Check, GitBranch, History, Move, Plus, Save, Sparkles } from "lucide-react";
import { request, ApiError, type ConceptNode, type GraphPayload, type Snapshot, type Version } from "@/lib/api";
import { loadDraft, writeDraft } from "@/lib/draft-store";
import { addDiscoveries, addRelation, graphDifference, visibleGraph, type Discoveries, type PersonalEdge } from "@/lib/star-map";

type Draft = { baseRevision: number; payload: GraphPayload; note: string; operationKey?: string };
const emptyGraph: GraphPayload = { nodes: [], edges: [] };
function Star({ data, selected }: NodeProps<ConceptNode>) {
  return <div className={`personal-star ${selected ? "star-selected" : ""}`}><Handle type="target" position={Position.Left}/><span className="personal-star-light"/><strong>{data.label}</strong><small>{data.note ? "已有我的解释" : "写下我的理解"}</small><Handle type="source" position={Position.Right}/></div>;
}
const nodeTypes = { knowledge: Star };

function ChangeList({ changes }: { changes: ReturnType<typeof graphDifference> }) {
  return <ul>{changes.map((item, index) => <li key={index}>{item.kind}：{item.label}{item.before !== undefined && <details className="star-change-text"><summary>查看原文与修改</summary><p>比较前</p><pre>{item.before}</pre><p>比较后</p><pre>{item.after}</pre></details>}</li>)}</ul>;
}

export function StarMap({ onBack }: { onBack: () => void }) {
  const [discoveries, setDiscoveries] = useState<Discoveries | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [graph, setGraph] = useState<GraphPayload>(emptyGraph);
  const [chapter, setChapter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [edgeId, setEdgeId] = useState<string | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [preview, setPreview] = useState<Snapshot | null>(null);
  const [panel, setPanel] = useState<"understanding" | "history" | "suggestions">("understanding");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [recovery, setRecovery] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("正在找回你的星图…");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [relationship, setRelationship] = useState("");
  const pending = useRef<Draft | null>(null);
  const restoring = useRef<{ revision: number; base: number; key: string } | null>(null);
  const loading = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);

  function keepDraft(value: Draft | undefined) {
    void writeDraft(value, "stars").catch(() => setError("本机草稿暂存不可用。当前操作仍在屏幕上，请保存到星图。"));
  }
  async function load(preserve = false) {
    const call = ++loading.current;
    setFetching(true);
    try {
      const [known, current, history, draft] = await Promise.all([
        request<Discoveries>("/discoveries"), request<Snapshot>("/learner-graph"), request<Version[]>("/learner-graph/versions"),
        loadDraft<Draft>("stars").catch(() => undefined),
      ]);
      if (call !== loading.current) return;
      setDiscoveries(known); setSnapshot(current); setGraph(current.payload); setVersions(history);
      setChapter(old => old || known.chapters.at(-1)?.id || "all"); setDirty(false); setPreview(null); setError("");
      setRecovery(draft ?? null); setStatus(`已保存 · v${current.revision}`);
      if (!preserve) pending.current = null;
    } catch { if (call === loading.current) { setError("星图暂时没有连上。重试后继续，已有版本和草稿仍保留。"); setStatus("连接待恢复"); } }
    finally { if (call === loading.current) setFetching(false); }
  }
  useEffect(() => { void load(); heading.current?.focus(); return () => { loading.current++; }; }, []);
  useEffect(() => {
    if (!dirty) return;
    function leaving(event: BeforeUnloadEvent) { event.preventDefault(); }
    window.addEventListener("beforeunload", leaving); return () => window.removeEventListener("beforeunload", leaving);
  }, [dirty]);

  function edit(next: GraphPayload, note = "更新星图理解") {
    if (!snapshot || saving || fetching || recovery || preview) return;
    setGraph(next); setDirty(true); setStatus("本机草稿 · 尚未保存"); setError(""); restoring.current = null;
    pending.current = { baseRevision: snapshot.revision, payload: next, note, operationKey: crypto.randomUUID() };
    keepDraft(pending.current);
  }
  async function save() {
    if (!snapshot || !dirty || saving || fetching || preview || recovery) return;
    const draft = pending.current ?? { baseRevision: snapshot.revision, payload: graph, note: "更新星图理解", operationKey: crypto.randomUUID() };
    pending.current = draft; keepDraft(draft); setSaving(true); setError("");
    try {
      const next = await request<Snapshot>("/learner-graph/operations", { base_revision: draft.baseRevision, operation_key: draft.operationKey, payload: draft.payload, note: draft.note });
      setSnapshot(next); setGraph(next.payload); setDirty(false); pending.current = null; keepDraft(undefined);
      setStatus(`已保存 · v${next.revision}`);
      setVersions(old => [{ ...next }, ...old.filter(v => v.revision !== next.revision)]);
    } catch (error) { setError(error instanceof ApiError && error.status === 409 ? "另一处更新了这张图。当前草稿仍在；先查看最新版本，再决定如何处理。" : "这次还没保存成功。当前操作仍保留，可直接重试。"); }
    finally { setSaving(false); }
  }
  async function showVersion(revision: number) {
    if (dirty || saving || fetching || recovery) { setError("先保存当前草稿，或查看最新版本后保留服务器内容，再切换历史。"); return; }
    try { setPreview(await request<Snapshot>(`/learner-graph/versions/${revision}`)); setSelected(null); setEdgeId(null); setError(""); }
    catch { setError("这个版本暂未读取成功，当前星图仍保留。"); }
  }
  async function restore() {
    if (!preview || !snapshot || saving || fetching || dirty || recovery) return;
    if (restoring.current?.revision !== preview.revision || restoring.current.base !== snapshot.revision) restoring.current = { revision: preview.revision, base: snapshot.revision, key: crypto.randomUUID() };
    setSaving(true); setError("");
    try {
      const next = await request<Snapshot>("/learner-graph/restore", { base_revision: snapshot.revision, revision: preview.revision, operation_key: restoring.current.key });
      setSnapshot(next); setGraph(next.payload); setPreview(null); restoring.current = null; keepDraft(undefined);
      setVersions(old => [{ ...next }, ...old.filter(v => v.revision !== next.revision)]); setStatus(`已恢复为新版本 · v${next.revision}`);
    } catch (error) { setError(error instanceof ApiError && error.status === 409 ? "图谱已在另一处更新。请查看最新版本，再重新选择恢复内容。" : "恢复尚未确认，可重试；原版本始终保留。"); }
    finally { setSaving(false); }
  }

  const shown = preview?.payload ?? graph;
  const visible = discoveries ? visibleGraph(shown, discoveries, chapter) : emptyGraph;
  const knownHere = discoveries?.entities.filter(e => chapter === "all" || e.chapters.includes(chapter)) ?? [];
  const knownIds = new Set(knownHere.map(entity => entity.id));
  const focused = shown.nodes.find(node => node.id === selected && knownIds.has(node.id));
  const focusedOrigin = discoveries?.entities.find(e => e.id === focused?.id);
  const edge = visible.edges.find(item => item.id === edgeId) as PersonalEdge | undefined;
  const proposals = discoveries?.relations.filter(r => knownIds.has(r.source) && knownIds.has(r.target)) ?? [];
  const frozen = !!preview || saving || fetching || !!recovery;
  const changes = preview && snapshot ? graphDifference(preview.payload, snapshot.payload) : [];
  const missing = knownHere.filter(entity => !graph.nodes.some(node => node.id === entity.id));
  function joinDiscoveries() {
    if (graph.nodes.length + missing.length > 150) { setError("当前图已接近150个节点。请先在图谱手记整理，再接入新的发现。"); return; }
    const next = addDiscoveries(graph, knownHere); edit(next, "接入已探索的知识"); setSelected(missing[0]?.id ?? null); setEdgeId(null);
  }
  function connect(source: string, target: string, label = "待解释的关系") {
    if (frozen || !source || !target || source === target || !visible.nodes.some(n => n.id === source) || !visible.nodes.some(n => n.id === target)) { setError("请在当前星图里选择两个不同的知识点。"); return; }
    if (graph.edges.some(e => e.source === source && e.target === target)) { setError("这条方向的连接已经存在，可以点开修改解释。"); return; }
    if (graph.edges.length >= 500) { setError("当前图已达到500条连接，请先整理已有关系。"); return; }
    const id = crypto.randomUUID(); edit({ ...graph, edges: [...graph.edges, { id, source, target, label }] }, "连接知识并补充关系"); setEdgeId(id); setSelected(null); setRelationship("");
  }
  function nodesChanged(changes: NodeChange<ConceptNode>[]) {
    if (frozen) return;
    const positions = changes.filter(change => change.type === "position");
    if (positions.length) edit({ ...graph, nodes: applyNodeChanges(positions, graph.nodes) }, "移动星图位置");
  }
  function tidy() {
    const positions = new Map(visible.nodes.map((node, index) => [node.id, { x: (index % 3) * 250, y: Math.floor(index / 3) * 150 }]));
    edit({ ...graph, nodes: graph.nodes.map(node => positions.has(node.id) ? { ...node, position: positions.get(node.id)! } : node) }, "整理当前星图布局");
  }

  return <main className="star-map-room">
    <div className="star-map-top"><button className="voyage-back" disabled={saving || fetching} onClick={onBack}><ArrowLeft size={16}/>回到群岛</button><span>{status}</span><button className="voyage-secondary" disabled={!dirty || frozen} onClick={() => { void save(); }}><Save size={15}/>{saving ? "正在保存…" : "保存星图"}</button></div>
    <div className="star-map-intro"><span className="voyage-eyebrow">把发现，连成自己的理解</span><h1 ref={heading} tabIndex={-1}>我的星图</h1><p>只展开已经遇见的知识。写解释、接关系，每次保存都留下一个版本。</p></div>
    {error && <div className="star-map-error" role="alert">{error}<button disabled={saving} onClick={() => { void load(true); }}>查看最新版本</button></div>}
    {recovery && <div className="star-recovery"><p>找回一份未同步草稿（基于v{recovery.baseRevision}）。{recovery.baseRevision !== snapshot?.revision && "服务器已有更新，先比较，再决定是否完整复制草稿。"}</p><button onClick={() => {
      if (!snapshot) return; const draft = { ...recovery, baseRevision: snapshot.revision, operationKey: recovery.baseRevision === snapshot.revision ? recovery.operationKey ?? crypto.randomUUID() : crypto.randomUUID() };
      setGraph(draft.payload); setDirty(true); setPreview(null); setRecovery(null); pending.current = draft; keepDraft(draft); setStatus("草稿已找回 · 尚未保存");
    }}>{recovery.baseRevision === snapshot?.revision ? "找回星图草稿" : "把草稿完整复制到当前修订"}</button><button onClick={() => { setRecovery(null); pending.current = null; keepDraft(undefined); }}>保留服务器内容</button><details><summary>比较草稿与服务器</summary>{snapshot && <ChangeList changes={graphDifference(snapshot.payload, recovery.payload)}/>}</details></div>}
    {!snapshot || !discoveries ? <div className="star-loading"><Sparkles size={25}/><p>正在找回星图与探索足迹…</p><button className="voyage-secondary" onClick={() => { void load(); }}>重新连接</button></div> : !discoveries.entities.length ? <div className="star-empty"><Sparkles size={40}/><h2>先发现第一束光。</h2><p>点亮一个知识后，就能把自己的解释留在这里。</p><button className="voyage-primary" onClick={onBack}>回到眼前的探索<ArrowRight size={16}/></button></div> : <>
      <div className="star-map-toolbar"><label>展开范围<select aria-label="星图范围" value={chapter} onChange={event => { setChapter(event.target.value); setSelected(null); setEdgeId(null); setFrom(""); setTo(""); }}><option value="all">全部已发现</option>{discoveries.chapters.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label><span>{visible.nodes.length}个已接入 · {missing.length}个可接入</span><button disabled={frozen || !missing.length} onClick={joinDiscoveries}><Plus size={15}/>接入本章发现</button><button disabled={frozen || !visible.nodes.length} onClick={tidy}><Move size={15}/>整理布局</button></div>
      {preview && <div className="star-history-banner"><span>正在回看v{preview.revision} · 只读</span><button disabled={saving} onClick={() => setPreview(null)}>回到当前星图</button></div>}
      <div className="star-map-layout"><section className="star-map-canvas" aria-label="已发现知识的个人星图">
        {visible.nodes.length ? <ReactFlow key={`${chapter}:${preview?.revision ?? "current"}:${visible.nodes.length}`} nodes={visible.nodes.map(node => ({ ...node, selected: node.id === selected }))} edges={visible.edges.map(item => ({ ...item, selected: item.id === edgeId }))} nodeTypes={nodeTypes} nodesDraggable={!frozen} nodesConnectable={!frozen} elementsSelectable={!saving} onNodesChange={nodesChanged} onConnect={connection => connect(connection.source, connection.target)} onNodeClick={(_,node) => { setSelected(node.id); setEdgeId(null); setPanel("understanding"); }} onEdgeClick={(_,item) => { setEdgeId(item.id); setSelected(null); setPanel("understanding"); }} deleteKeyCode={null} fitView fitViewOptions={{ padding:.25 }} minZoom={.2} maxZoom={1.5} defaultEdgeOptions={{ type:"smoothstep", style:{ stroke:"#a9c88f",strokeWidth:1.4 }, labelStyle:{fill:"#d3d5a9",fontSize:10},labelBgStyle:{fill:"#203a37"},labelBgPadding:[8,5] }}><Background color="#8aa68a55" gap={25}/><Controls showInteractive={false}/></ReactFlow> : <div className="star-empty-local"><Sparkles size={30}/><p>这些发现还没有接进图里。</p><button className="voyage-secondary" disabled={frozen} onClick={joinDiscoveries}>接入本章发现</button></div>}
        <small className="star-canvas-guide">拖动节点整理 · 拖接端点连线 · 也可使用右侧选择框</small>
      </section><aside className="star-map-inspector"><div className="star-panel-tabs"><button aria-pressed={panel === "understanding"} onClick={() => setPanel("understanding")}><BookOpen size={14}/>我的理解</button><button aria-pressed={panel === "suggestions"} onClick={() => setPanel("suggestions")}><GitBranch size={14}/>关系线索</button><button aria-pressed={panel === "history"} onClick={() => setPanel("history")}><History size={14}/>历史版本</button></div>
        {panel === "understanding" && <>
          <label className="star-field">选择知识点<select aria-label="选择星图知识点" value={focused?.id ?? ""} onChange={event => { setSelected(event.target.value); setEdgeId(null); }}><option value="">点一颗星，或在这里选择</option>{visible.nodes.map(node => <option key={node.id} value={node.id}>{node.data.label}</option>)}</select></label>
          {focused && <div className="star-understanding"><h2>{focused.data.label}</h2><label className="star-field">我的解释<textarea aria-label="星图里的我的解释" rows={5} maxLength={3000} disabled={frozen} value={focused.data.note} onChange={event => edit({ ...graph, nodes:graph.nodes.map(node => node.id === focused.id ? {...node,data:{...node.data,note:event.target.value}} : node) },"修订知识解释")}/></label><small>探索发现 · 理解仍待独立验证</small><details><summary>回看这颗星的来处</summary>{focusedOrigin?.origins.map(origin => <p key={origin.node_id}>{origin.title}{origin.hint_used ? " · 用过线索" : " · 探索完成"}<small>内容版本 {origin.release_id}</small></p>)}</details></div>}
          <label className="star-field">选择已有连接<select aria-label="选择星图连接" value={edge?.id ?? ""} onChange={event => { setEdgeId(event.target.value); setSelected(null); }}><option value="">点一条线，或在这里选择</option>{visible.edges.map(item => <option key={item.id} value={item.id}>{String(item.label)}</option>)}</select></label>
          {edge && <div className="star-relationship"><label className="star-field">关系怎么说<input aria-label="星图关系名称" disabled={frozen} maxLength={200} value={String(edge.label ?? "")} onChange={event => edit({ ...graph, edges:graph.edges.map(item => item.id === edge.id ? {...item,label:event.target.value} : item) },"修订关系命题")}/></label><label className="star-field">我的理由与条件<textarea aria-label="星图关系的理由与条件" rows={4} disabled={frozen} maxLength={3000} value={edge.note ?? ""} onChange={event => edit({ ...graph, edges:graph.edges.map(item => item.id === edge.id ? {...item,note:event.target.value} : item) },"修订关系解释与条件")}/></label>{edge.reference_id && <small>从草稿线索 {edge.reference_id} 接入；个人解释不代表已验证。</small>}<button className="star-text-button" disabled={frozen} onClick={() => { edit({ ...graph, edges:graph.edges.filter(item => item.id !== edge.id) },"移除一条当前连接"); setEdgeId(null); }}>移除这条连接</button></div>}
          {!frozen && visible.nodes.length > 1 && <details className="star-new-connection"><summary>连接两个发现</summary><label className="star-field">从<select aria-label="连接起点" value={from} onChange={event => setFrom(event.target.value)}><option value="">选择起点</option>{visible.nodes.map(node => <option key={node.id} value={node.id}>{node.data.label}</option>)}</select></label><label className="star-field">到<select aria-label="连接终点" value={to} onChange={event => setTo(event.target.value)}><option value="">选择终点</option>{visible.nodes.map(node => <option key={node.id} value={node.id}>{node.data.label}</option>)}</select></label><label className="star-field">连接含义<input aria-label="新连接含义" value={relationship} maxLength={200} onChange={event => setRelationship(event.target.value)}/></label><button className="voyage-secondary" onClick={() => connect(from,to,relationship.trim() || "待解释的关系")}>接上这条关系<ArrowRight size={14}/></button></details>}
          {!focused && !edge && <p className="star-inspector-tip">选一个知识写解释，或连接两颗星，说明它们怎样相关。</p>}
        </>}
        {panel === "suggestions" && <div className="star-suggestions"><p>这些是已有资料中的关系草稿。先看条件，再决定是否接入。</p>{proposals.map(proposal => <article key={proposal.id}><h3>{proposal.statement}</h3><p>{proposal.conditions}</p><small>草稿 · 待审校 · {proposal.id}</small><button className="voyage-secondary" disabled={frozen || graph.edges.length >= 500 || !graph.nodes.some(n=>n.id===proposal.source) || !graph.nodes.some(n=>n.id===proposal.target) || graph.edges.some(e=>e.source===proposal.source && e.target===proposal.target)} onClick={() => { const next=addRelation(graph,proposal); edit(next,"采纳一条待解释的关系线索"); setEdgeId(next.edges.at(-1)?.id ?? null); setSelected(null); setPanel("understanding"); }}>试着接上<ArrowRight size={14}/></button></article>)}{!proposals.length && <p>当前范围还没有可用的资料关系线索。可以先写解释，或自己连接已发现知识。</p>}</div>}
        {panel === "history" && <div className="star-history"><p>与图谱手记共用版本。这里只显示已发现知识，旧图中的其他内容仍保留。</p>{versions.map(version => <button className={preview?.revision === version.revision ? "version-selected" : ""} key={version.revision} disabled={saving} onClick={() => { void showVersion(version.revision); }}><span>v{version.revision}{version.revision === snapshot.revision && " · 当前"}</span><strong>{version.note}</strong><small>{new Date(version.created_at).toLocaleString("zh-CN")}</small></button>)}{preview && <div className="star-difference"><h3>从这个版本到当前，共{changes.length}处变化</h3><ChangeList changes={changes}/>{!changes.length && <p>没有检测到节点、理解、连接或位置变化。</p>}<p>恢复会复制整张共享图的所看版本，包含当前未展示的内容；新增一个版本，保留后续历史。</p><button className="voyage-secondary" disabled={saving || preview.revision === snapshot.revision} onClick={() => { void restore(); }}>恢复所看版本为新版本</button></div>}</div>}
      </aside></div>
      <div className="star-map-footer"><span><Check size={13}/>点亮是发现，解释与连接仍需验证</span><Link href="/workbench">打开完整图谱手记<ArrowRight size={13}/></Link></div>
    </>}
  </main>;
}
