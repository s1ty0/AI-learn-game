"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { ReactFlow, Background, Controls, Handle, Position, applyNodeChanges, applyEdgeChanges, addEdge,
  type NodeProps, type NodeChange, type EdgeChange, type Connection, type Edge } from "@xyflow/react";
import { ArrowDown, ArrowRight, ArrowUpRight, BookOpen, Check, ChevronRight, CircleHelp, Clock3, GitBranch,
  History, Layers3, Map, Maximize2, MoveUpRight, Network, Plus, RotateCcw, Save, Search, Sparkles, Target, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { request, ApiError, type Snapshot, type Version, type ConceptNode, type GraphPayload, type Catalog, type Entity, type Attempt } from "@/lib/api";
import { loadDraft, writeDraft } from "@/lib/draft-store";
import { experiment, weights } from "@/lib/experiment";

const client = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });
type Tab = "map" | "lab" | "catalog" | "history";
type Draft = { baseRevision: number; payload: GraphPayload; note: string; operationKey?: string };
const icons = { input: Layers3, model: Network, focus: Target, output: GitBranch, training: Sparkles, custom: Plus };
function KnowledgeNode({ data, selected }: NodeProps<ConceptNode>) {
  const Icon = icons[data.category as keyof typeof icons] ?? Plus;
  return <div className={`concept-card ${data.category} ${selected ? "selected" : ""}`}>
    <Handle type="target" position={Position.Left} /><div className="concept-top"><span className="concept-icon"><Icon size={17} /></span><span className="concept-status">待验证</span></div>
    <strong>{data.label}</strong><span className="concept-subtitle">{data.subtitle}</span>
    {data.note && <span className="concept-has-note">已有个人解释 <Check size={11} /></span>}
    <Handle type="source" position={Position.Right} />
  </div>;
}
const nodeTypes = { knowledge: KnowledgeNode };

export function Workspace() { return <QueryClientProvider client={client}><StudyApp /></QueryClientProvider>; }

function StudyApp() {
  const qc = useQueryClient();
  const catalog = useQuery({ queryKey: ["catalog"], queryFn: () => request<Catalog>("/content") });
  const versions = useQuery({ queryKey: ["versions"], queryFn: () => request<Version[]>("/learner-graph/versions") });
  const attempts = useQuery({ queryKey: ["attempts"], queryFn: () => request<Attempt[]>("/attempts") });
  const [tab, setTab] = useState<Tab>("map");
  const [graph, setGraph] = useState<GraphPayload>({ nodes: [], edges: [] });
  const [revision, setRevision] = useState(0);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [note, setNote] = useState("更新我的理解");
  const [status, setStatus] = useState("正在连接知识库…");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<Snapshot | null>(null);
  const [lessonOpen, setLessonOpen] = useState(false);
  const [lessonModule, setLessonModule] = useState("multihead-and-mask.md");
  const [recovery, setRecovery] = useState<Draft | null>(null);
  const pendingSave = useRef<Draft | null>(null);
  const graphRef = useRef(graph); graphRef.current = graph;
  const revisionRef = useRef(revision); revisionRef.current = revision;
  const lesson = useQuery({ queryKey: ["lesson", lessonModule], queryFn: () => request<{ markdown: string }>(`/lesson?module=${encodeURIComponent(lessonModule)}`), enabled: lessonOpen });

  useEffect(() => {
    let active = true;
    Promise.all([request<Snapshot>("/learner-graph"), loadDraft<Draft>().catch(() => undefined)]).then(([snapshot, draft]) => {
      if (!active) return;
      setGraph(snapshot.payload); setRevision(snapshot.revision); setReady(true); setStatus(`已同步 · v${snapshot.revision}`);
      if (draft) setRecovery(draft);
    }).catch(e => { if (active) { setError(e.message); setStatus("后端未连接"); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!ready || !dirty || preview) return;
    const timer = setTimeout(() => {
      const pending = pendingSave.current;
      const draft: Draft = { baseRevision: revision, payload: graph, note };
      if (pending && pending.baseRevision === revision && JSON.stringify(pending.payload) === JSON.stringify(graph) && pending.note === note) draft.operationKey = pending.operationKey;
      writeDraft(draft).catch(() => setError("浏览器草稿缓存不可用，请及时保存。"));
    }, 250);
    return () => clearTimeout(timer);
  }, [graph, note, revision, dirty, ready, preview]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const edited = useCallback((next: GraphPayload) => { setGraph(next); setDirty(true); setStatus("有未保存的修改"); }, []);
  const onNodesChange = useCallback((changes: NodeChange<ConceptNode>[]) => {
    setGraph(current => { const nodes = applyNodeChanges(changes, current.nodes); const ids = new Set(nodes.map(n => n.id)); return { nodes, edges: current.edges.filter(e => ids.has(e.source) && ids.has(e.target)) }; });
    if (changes.some(c => c.type !== "select" && c.type !== "dimensions")) { setDirty(true); setStatus("有未保存的修改"); }
  }, []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setGraph(current => ({ ...current, edges: applyEdgeChanges(changes, current.edges) }));
    if (changes.some(c => c.type !== "select")) { setDirty(true); setStatus("有未保存的修改"); }
  }, []);
  const connect = useCallback((connection: Connection) => {
    edited({ ...graphRef.current, edges: addEdge({ ...connection, id: crypto.randomUUID(), label: "待解释的关系" }, graphRef.current.edges) });
  }, [edited]);

  async function save() {
    if (saving || preview) return;
    setSaving(true); setError("");
    const payload = graphRef.current;
    try {
      const old = pendingSave.current;
      const key = old && old.baseRevision === revision && JSON.stringify(old.payload) === JSON.stringify(payload) && old.note === note ? old.operationKey ?? crypto.randomUUID() : crypto.randomUUID();
      pendingSave.current = { baseRevision: revision, payload, note, operationKey: key };
      await writeDraft(pendingSave.current);
      const result = await request<Snapshot>("/learner-graph/operations", { base_revision: revision, operation_key: key, payload, note });
      pendingSave.current = null;
      setRevision(result.revision);
      const changedSinceSend = JSON.stringify(graphRef.current) !== JSON.stringify(payload);
      setDirty(changedSinceSend); setStatus(changedSinceSend ? `v${result.revision} 已保存 · 另有新修改` : `已同步 · v${result.revision}`);
      await writeDraft(changedSinceSend ? { baseRevision: result.revision, payload: graphRef.current, note } : undefined); qc.invalidateQueries({ queryKey: ["versions"] });
    } catch (e) { setError(e instanceof Error ? e.message : "保存未完成"); setStatus("草稿保留 · 等待同步"); }
    finally { setSaving(false); }
  }

  async function latest() {
    try {
      const result = await request<Snapshot>("/learner-graph");
      if (dirty) { await writeDraft({ baseRevision: revision, payload: graph, note }); setRecovery({ baseRevision: revision, payload: graph, note }); }
      setGraph(result.payload); setRevision(result.revision); setDirty(false); setPreview(null); setError(""); setStatus(`已同步 · v${result.revision}`);
    } catch (e) { setError((e as Error).message); }
  }
  async function showVersion(value: number) {
    if (dirty) { setError("请先保存当前修改，或查看最新版本并保留本地草稿，再切换历史。"); return; }
    try { setPreview(await request<Snapshot>(`/learner-graph/versions/${value}`)); setTab("map"); }
    catch (e) { setError((e as Error).message); }
  }
  async function restore() {
    if (!preview) return;
    setSaving(true);
    try {
      const result = await request<Snapshot>("/learner-graph/restore", { base_revision: revision, operation_key: crypto.randomUUID(), revision: preview.revision });
      setGraph(result.payload); setRevision(result.revision); setPreview(null); setStatus(`已恢复为新版本 · v${result.revision}`);
      qc.invalidateQueries({ queryKey: ["versions"] });
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }
  function addConcept(entity: Entity) {
    if (graph.nodes.some(n => n.id === entity.id)) { setSelectedNode(entity.id); setTab("map"); return; }
    edited({ ...graph, nodes: [...graph.nodes, { id: entity.id, type: "knowledge", position: { x: 100 + graph.nodes.length * 30, y: 450 }, data: { label: entity.name, subtitle: "从知识库加入", category: "custom", note: "" } }] });
    setSelectedNode(entity.id); setTab("map");
  }
  function tidyLayout() {
    const preferred = [{ x: 0, y: 30 }, { x: 245, y: 30 }, { x: 490, y: 185 }, { x: 245, y: 230 },
      { x: 490, y: 380 }, { x: 245, y: 435 }, { x: 0, y: 435 }];
    edited({ ...graph, nodes: graph.nodes.map((node, index) => ({ ...node, position: preferred[index] ?? { x: (index % 3) * 245, y: 650 + Math.floor((index - 7) / 3) * 180 } })) });
    setNote("整理节点布局");
  }
  const shown = preview?.payload ?? graph;
  const focused = shown.nodes.find(n => n.id === selectedNode);
  const edge = shown.edges.find(e => e.id === selectedEdge);
  const filtered = catalog.data?.entities.filter(e => [e.name, ...e.aliases].join(" ").toLowerCase().includes(search.toLowerCase())) ?? [];
  const nav = [{ id: "map" as Tab, title: "探索地图", icon: Map }, { id: "lab" as Tab, title: "关卡实验", icon: Target },
    { id: "catalog" as Tab, title: "知识图书馆", icon: BookOpen }, { id: "history" as Tab, title: "学习足迹", icon: History }];

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="知行图谱首页"><span className="brand-mark"><Network size={25} /></span><span>知行图谱<small>LEARN · CONNECT · BUILD</small></span></a>
      <div className="space-label">学习空间 <span>个人</span></div>
      <nav>{nav.map(({ id, title, icon: Icon }) => <button key={id} className={`nav-item ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}><Icon size={19} />{title}{tab === id && <span className="active-dot" />}</button>)}</nav>
      <div className="sidebar-section">正在探索</div>
      <button className="topic-link" onClick={() => { setTab("lab"); setPreview(null); }}><span className="topic-square">T</span><span>Transformer<small>从信息流到理解</small></span><ChevronRight size={15} /></button>
      <div className="sidebar-note"><span className="small-star">✳</span><strong>每次，只向前一点</strong><p>把新知识接到已知上。<br />让每一条连接都有理由。</p><button onClick={() => { setLessonOpen(true); }}>查看本章讲解 <ArrowUpRight size={14} /></button></div>
      <div className="profile"><span className="avatar">探</span><div><strong>本地探索者</strong><small>独立学习 · 开发预览</small></div><span className="profile-dot" /></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumbs">学习空间 <ChevronRight size={13} /> {nav.find(n => n.id === tab)?.title}</div><div className="header-right"><span className="draft-badge">内容草稿</span><span className="sync-status"><i className={dirty ? "amber" : ""} />{status}</span><button className="icon-button" aria-label="查看本章讲解" onClick={() => setLessonOpen(true)}><CircleHelp size={19} /></button></div></header>
      <main>
        {error && <div className="alert" role="alert"><span>{error}</span><button onClick={latest}>查看最新版本</button><button aria-label="关闭提示" onClick={() => setError("")}><X size={15} /></button></div>}
        {recovery && <div className="recovery"><span>发现浏览器保留的未同步草稿（基于 v{recovery.baseRevision}）。{recovery.baseRevision !== revision && " 服务器已有更新；重新应用会完整复制草稿内容，旧版本仍保留。"}</span><button onClick={() => { pendingSave.current = recovery.baseRevision === revision ? recovery : null; setGraph(recovery.payload); setNote(recovery.note); setDirty(true); setPreview(null); setRecovery(null); setStatus("已找回草稿 · 尚未同步"); }}>{recovery.baseRevision === revision ? "找回草稿" : "把草稿复制为新修订"}</button><button onClick={() => { writeDraft(undefined); setRecovery(null); }}>保留服务器版本</button></div>}
        <section className="page-intro"><div><div className="eyebrow"><span /> AI KNOWLEDGE EXPLORER</div><h1>{tab === "map" ? "让知识，连成你的理解。" : tab === "lab" ? "动手一次，理解再深一层。" : tab === "catalog" ? "从一个问题，找到一片知识。" : "每一次理解，都有迹可循。"}</h1><p>{tab === "map" ? "从已知出发，在自己的地图上，一点点探索 AI 的世界。" : tab === "lab" ? "先预测，再实验。观察一个变化，解释一条关系。" : tab === "catalog" ? "算法、架构与基础概念持续收录。正文与玩法按审核进度逐步补齐。" : "回看回答、解释和图谱版本，看见理解如何发生变化。"}</p></div><button className="text-link" onClick={() => setTab(tab === "catalog" ? "map" : "catalog")}>{tab === "catalog" ? "返回我的地图" : "探索知识图书馆"}<ArrowUpRight size={16} /></button></section>
        {tab === "map" && <>
          <div className="map-layout"><section className="map-section"><div className="panel-heading"><div><span className="section-index">01</span><strong>我的知识地图</strong><span className="count-pill">{shown.nodes.length} 个节点</span></div><div className="map-heading-actions"><button disabled={!!preview || saving} onClick={tidyLayout}><Layers3 size={15} />整理布局</button><button onClick={() => setTab("catalog")}><Plus size={15} />添加知识</button><button onClick={() => setTab("history")}><History size={15} />版本</button></div></div>
            <div className="graph-toolbar"><span><span className="legend-dot" />探索中的关系 <span className="muted">/ 拖动节点 · 连接端点 · 点击编辑</span></span><span>v{preview?.revision ?? revision}{dirty && " · 未保存"}</span></div>
            {preview && <div className="preview-banner">正在查看历史 v{preview.revision}<button onClick={() => setPreview(null)}>返回当前</button><button disabled={saving} onClick={restore}><RotateCcw size={13} />恢复为新版本</button></div>}
            <div className="graph-canvas" data-testid="graph-canvas">{ready ? <ReactFlow nodes={shown.nodes} edges={shown.edges} nodeTypes={nodeTypes} onNodesChange={preview ? undefined : onNodesChange} onEdgesChange={preview ? undefined : onEdgesChange} onConnect={preview ? undefined : connect}
              onNodeClick={(_, node) => { setSelectedNode(node.id); setSelectedEdge(null); }} onEdgeClick={(_, value) => { setSelectedEdge(value.id); setSelectedNode(null); }}
              nodesDraggable={!preview && !saving} nodesConnectable={!preview && !saving} elementsSelectable={!saving} deleteKeyCode={preview || saving ? null : "Delete"} fitView fitViewOptions={{ padding: .12 }} minZoom={.35} maxZoom={1.4} defaultEdgeOptions={{ type: "smoothstep", style: { stroke: "#9daea8", strokeWidth: 1.5 }, labelStyle: { fill: "#647770", fontSize: 12 }, labelBgStyle: { fill: "#f9fbf9" } }}>
              <Background color="#d5ddd5" gap={20} size={1} /><Controls showInteractive={false} />
            </ReactFlow> : <div className="empty-state">正在载入你的地图…</div>}</div>
            <div className="graph-footer"><span><GitBranch size={14} />连线是理解的提案，还需要解释与应用验证。</span><button className="primary-button small" disabled={!dirty || saving || !!preview} onClick={save}><Save size={14} />{saving ? "正在保存…" : "保存地图"}</button></div>
          </section><aside className="right-rail"><div className="next-card"><div className="card-kicker"><span className="pulse-dot" />下一步探索</div><span className="chapter-label">TRANSFORMER / 关卡 04</span><h2>模型为什么<br />不能偷看未来？</h2><p>改变一个位置的信息，看看哪些输出会跟着变化。</p><div className="task-meta"><span><Clock3 size={13} />小步实验</span><span>因果掩码</span></div><button className="primary-button" onClick={() => { setTab("lab"); setPreview(null); }}>进入实验<ArrowRight size={16} /></button><small>先观察信息边界，再补一条理解。</small></div>
            <div className="meaning-card"><span className="outline-icon"><GitBranch size={18} /></span><h3>{focused ? focused.data.label : edge ? "解释这条连接" : "连起来，才真正属于你"}</h3>{focused && !preview ? <><label className="field-label" htmlFor="node-note">我的解释</label><textarea id="node-note" value={focused.data.note} placeholder="这个概念是什么？它与其他知识怎样相连？" onChange={e => edited({ ...graph, nodes: graph.nodes.map(n => n.id === focused.id ? { ...n, data: { ...n.data, note: e.target.value } } : n) })} /><button className="text-link" disabled={saving || !dirty} onClick={save}>保存解释 <ArrowRight size={13} /></button></> : edge && !preview ? <><label className="field-label" htmlFor="edge-label">关系含义</label><textarea id="edge-label" value={String(edge.label ?? "")} onChange={e => edited({ ...graph, edges: graph.edges.map(item => item.id === edge.id ? { ...item, label: e.target.value } : item) })} /><button className="text-link" disabled={saving || !dirty} onClick={save}>保存关系 <ArrowRight size={13} /></button></> : <p>{focused?.data.note || "点击一个节点，写下自己的解释。每次修订都可以保存、回看和继续更新。"}</p>}<div className="tiny-rule" /><span className="quiet-label">认识一个词 ≠ 理解一条关系</span></div>
          </aside></div><section className="bottom-strip"><div><BookOpen size={21} /><span><strong>{catalog.data?.entities.length ?? "—"}</strong> 个知识条目<small>公共地图持续生长</small></span></div><div><GitBranch size={21} /><span><strong>{shown.edges.length}</strong> 条个人连接<small>每一条都值得解释</small></span></div><div><History size={21} /><span><strong>{versions.data?.length ?? 0}</strong> 份历史版本<small>修改与恢复均有留痕</small></span></div><button onClick={() => setTab("history")}>回看学习足迹 <ArrowRight size={16} /></button></section>
        </>}
        {tab === "lab" && <Lab onSaved={() => qc.invalidateQueries({ queryKey: ["attempts"] })} onMap={() => { setTab("map"); setSelectedNode(catalog.data?.entities.find(e => e.name === "因果掩码")?.id ?? null); }} onLesson={() => setLessonOpen(true)} />}
        {tab === "catalog" && <section className="catalog-panel"><div className="catalog-top"><div><h2>公共知识目录</h2><p>已登记 {catalog.data?.entities.length ?? 0} 个条目 · 内容与关系仍在逐项核查</p></div><label className="search-box"><Search size={17} /><input aria-label="搜索知识" placeholder="搜索中文、英文或别名…" value={search} onChange={e => setSearch(e.target.value)} /></label></div><div className="catalog-grid">{filtered.map(e => <button key={e.id} className="catalog-item" onClick={() => addConcept(e)}><span className="catalog-icon"><Network size={18} /></span><div><strong>{e.name}</strong><small>{e.aliases[0] ?? "AI 知识条目"}</small></div><Plus size={16} /></button>)}</div>{!filtered.length && <div className="empty-state">没有找到相符条目。知识地图仍会持续补充。</div>}</section>}
        {tab === "history" && <div className="history-grid"><section className="history-panel"><h2><History size={20} />图谱版本</h2><p className="panel-subtitle">恢复会生成新版本，后续历史仍然保留。</p>{versions.data?.map(v => <div className="version-row" key={v.revision}><span className="version-dot" /><div><strong>v{v.revision} {v.revision === revision && <span className="mini-badge">当前</span>}</strong><p>{v.note}</p><small>{new Date(v.created_at).toLocaleString("zh-CN")}</small></div><button onClick={() => showVersion(v.revision)}>查看 <ArrowUpRight size={14} /></button></div>)}</section><section className="history-panel"><h2><BookOpen size={20} />实验与解释</h2><p className="panel-subtitle">数值检查与解释复核分别记录。</p>{attempts.data?.length ? attempts.data.map(a => <article className="attempt-card" key={a.id}><span className="mini-badge">解释待复核</span><h3>模型为什么不能偷看未来？</h3><p>{a.explanation}</p><small>{a.created_at && new Date(a.created_at).toLocaleString("zh-CN")}</small></article>) : <div className="empty-state">还没有提交记录。完成一次小实验，留下第一份理解。</div>}</section></div>}
        <footer className="page-footer"><span>知行图谱 · 在连接中理解 AI</span><span>本地开发预览 · 单人档案 · 内容草稿</span></footer>
      </main>
    </div>
    {lessonOpen && <div className="drawer-backdrop" onClick={() => setLessonOpen(false)}><section className="lesson-drawer" role="dialog" aria-modal="true" aria-label="本章讲解" onClick={e => e.stopPropagation()}><div className="drawer-header"><span><BookOpen size={18} />本章讲解</span><button className="icon-button" aria-label="关闭讲解" onClick={() => setLessonOpen(false)}><X size={19} /></button></div><article className="markdown"><ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} components={{ a: ({ href, children }) => href?.startsWith("./") ? <a href="#" onClick={e => { e.preventDefault(); setLessonModule(href.slice(2)); }}>{children}</a> : <a href={href} target="_blank" rel="noreferrer">{children}</a>, img: ({ alt }) => <p className="hint-box">{alt}：完整图解可在项目的 Transformer 专题中查看。</p> }}>{lesson.data?.markdown.replaceAll("\\[", "$$").replaceAll("\\]", "$$").replaceAll("\\(", "$").replaceAll("\\)", "$") ?? "正在加载讲解…"}</ReactMarkdown></article></section></div>}
  </div>;
}

function Lab({ onSaved, onMap, onLesson }: { onSaved: () => void; onMap: () => void; onLesson: () => void }) {
  const [mask, setMask] = useState(true);
  const [future, setFuture] = useState(10);
  const [prediction, setPrediction] = useState<"same" | "different" | "">("");
  const [explanation, setExplanation] = useState("");
  const [hint, setHint] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Attempt | null>(null);
  const [error, setError] = useState("");
  const output = experiment(mask, future);
  const base = experiment(mask, 10);
  async function submit() {
    if (!prediction || explanation.trim().length < 5) { setError("先选择预测，再用至少5个字说明你的理由。"); return; }
    setSubmitting(true); setError("");
    try {
      const response = await request<Attempt>("/attempts", { operation_key: crypto.randomUUID(), prediction, explanation, hint_used: hint, mask_enabled: mask, future_value: future, observed: output.flat() });
      setResult(response); onSaved();
    } catch (e) { setError((e as Error).message); } finally { setSubmitting(false); }
  }
  return <div className="lab-layout"><section className="lab-main"><div className="lab-title"><span className="section-index">04</span><div><span className="chapter-label">TRANSFORMER · 信息边界</span><h2>模型为什么不能偷看未来？</h2></div><span className="tag">数值实验</span></div>
    <div className="question-block"><span className="step-label">01 / 先预测</span><h3>开启因果掩码，只改变第三个位置的值，<br />前两个位置的输出会变化吗？</h3><div className="choice-row"><button aria-pressed={prediction === "same"} className={prediction === "same" ? "chosen" : ""} onClick={() => setPrediction("same")}><span>A</span>不会变化{prediction === "same" && <Check size={16} />}</button><button aria-pressed={prediction === "different"} className={prediction === "different" ? "chosen" : ""} onClick={() => setPrediction("different")}><span>B</span>会变化{prediction === "different" && <Check size={16} />}</button></div></div>
    <div className="experiment-panel"><div className="experiment-heading"><span className="step-label">02 / 改一个条件，看看变化</span><button className="text-link" onClick={() => { setMask(true); setFuture(10); }}>重置实验 <RotateCcw size={13} /></button></div>
      <div className="experiment-controls"><label className="switch-label"><input aria-label="启用因果掩码" type="checkbox" checked={mask} onChange={e => setMask(e.target.checked)} /><span className="switch-track" />因果掩码 <strong>{mask ? "开启" : "关闭"}</strong></label><label className="slider-label" htmlFor="future">第三个位置的值 <output>{future}</output><input id="future" type="range" min="0" max="40" value={future} onChange={e => setFuture(Number(e.target.value))} /></label></div>
      <div className="attention-lab"><div className="matrix-area"><div className="viz-title">注意力权重 <span>行：查询位置 / 列：键位置</span></div><div className="matrix-column-labels"><span>位置 1</span><span>位置 2</span><span>位置 3</span></div><div className="matrix-with-labels"><div className="matrix-row-labels"><span>位置 1</span><span>位置 2</span><span>位置 3</span></div><div className="attention-matrix">{weights(mask).flatMap((row, i) => row.map((v, j) => <div key={`${i}-${j}`} className={v === 0 ? "masked-cell" : "weight-cell"} style={v ? { backgroundColor: `rgba(39,108,86,${.1 + .8 * v})`, color: v > .5 ? "white" : "#204f3e" } : undefined}>{v === 0 ? "屏蔽" : v.toFixed(2)}</div>))}</div></div></div><ArrowRight className="viz-arrow" size={22} /><div className="output-area"><div className="viz-title">汇聚后的输出 <span>和初始值 10 的实验比较</span></div>{output.map((row, i) => <div className="output-row" key={i}><span>位置 {i + 1}</span><strong data-testid={`output-${i}`}>{row[0].toFixed(2)}</strong><span className={`delta ${Math.abs(row[0]-base[i][0]) < .001 ? "unchanged" : "changed"}`}>{Math.abs(row[0]-base[i][0]) < .001 ? "未变化" : `${row[0]-base[i][0] > 0 ? "+" : ""}${(row[0]-base[i][0]).toFixed(2)}`}</span></div>)}</div></div><p className="experiment-caption">固定查询与键，只改变第三个值。屏蔽发生在权重计算前。此处是单头汇聚的可控数值实验。</p>
    </div>
    <div className="explain-block"><span className="step-label">03 / 说清这条关系</span><label htmlFor="explanation">为什么会这样？你会怎样解释“因果掩码限制信息访问”？</label><textarea id="explanation" placeholder="试着从“当前位置能看到什么”说起，用自己的话写下理由…" value={explanation} onChange={e => setExplanation(e.target.value)} /><div className="explain-actions"><button className="text-link" onClick={() => setHint(true)}><CircleHelp size={15} />给我一点提示</button><button className="primary-button" disabled={submitting} onClick={submit}>{submitting ? "正在保存…" : "提交这次理解"}<ArrowRight size={15} /></button></div>{hint && <p className="hint-box">先看权重矩阵：前两个查询能不能分到第三个值的权重？再关闭掩码，比较一次。</p>}{error && <p className="form-error" role="alert">{error}</p>}{result && <div className="result-box" role="status"><strong><Check size={17} />数值检查通过，解释已留痕</strong><p>{result.message}</p><button className="text-link" onClick={onMap}>回到地图，补上这条联系 <ArrowRight size={14} /></button></div>}</div>
  </section><aside className="lab-rail"><div className="rail-heading"><Target size={18} /><strong>这轮只学一件事</strong></div><h3>信息访问的边界</h3><p>因果掩码限制当前位置读取未来信息。它与“哪些标签计入损失”承担不同职责。</p><div className="tiny-rule" /><span className="field-label">当前连接</span><div className="relation-chip">因果掩码 <ArrowRight size={13} /> 信息可见性</div><button className="secondary-button" onClick={onLesson}><BookOpen size={15} />展开原理与计算</button><div className="lab-rail-foot"><GitBranch size={19} /><p>完成实验后，把新的理解接回自己的地图。</p></div></aside></div>;
}
