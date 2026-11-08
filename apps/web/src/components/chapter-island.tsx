"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Lightbulb, LockKeyhole, RotateCcw, Sparkles } from "lucide-react";
import { ApiError, request } from "@/lib/api";
import { chain, chainNames, concepts, names, queryAttention, type Chapter, type ChapterIsland, type Query } from "@/lib/chapter";

type Island = "query" | "heads" | "beacon";
const stories = {
  query: ["让第二束回应你的呼唤", "把查询转向共同的方向", "把目光转回来"],
  heads: ["让镜片 A 留住低处的光", "让镜片 B 看向另一处", "把两个视角一起带走"],
  beacon: ["修好会偷看未来的灯塔", "让后面的变化留在后面", "接好最后一条光路"]
};
const goals = {
  query: ["转动查询，让第二把键得到最高的权重。", "信息值不变，让汇聚读数超过 8。", "让汇聚读数低于 4，再说清改变的原因。"],
  heads: ["调节镜片 A 的查询，让输出低于 4。", "保留 A 的低值，同时让 B 的输出超过 8。", "保留 A、B 两个读数，决定怎样合在一起。"],
  beacon: ["开启因果限制，调整查询，让最后一个输出超过 8。", "第三个值调到 30 或更大，前两位置不受影响，最后输出超过 20。", "按正确顺序，接起匹配、光闸、权重与汇聚。"]
};
function initial(node: Island, stage: number): Query[] {
  if (node === "heads") return stage === 0 ? [[0, 0], [0, 0]] : stage === 1 ? [[2, -2], [0, 0]] : [[2, -2], [2, 2]];
  if (node === "beacon") return [[2, 2]];
  return stage === 0 ? [[1, 0]] : stage === 1 ? [[-1, 1]] : [[2, 2]];
}

export function ChapterIslandGame({ node, chapter, onSaved, onBack }: {
  node: Island; chapter: Chapter; onSaved: (chapter: Chapter) => void; onBack: () => void;
}) {
  const progress = chapter.nodes.find(item => item.id === node)!;
  const replay = useRef(progress.stage === 3).current;
  const [stage, setStage] = useState(replay ? 0 : progress.stage);
  const [queries, setQueries] = useState<Query[]>(() => initial(node, replay ? 0 : progress.stage));
  const [head, setHead] = useState(0);
  const [mask, setMask] = useState(!replay && progress.stage > 0 && node === "beacon");
  const [future, setFuture] = useState(!replay && progress.stage === 2 && node === "beacon" ? 30 : 10);
  const [reason, setReason] = useState<string | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const [hint, setHint] = useState(false);
  const [hintUsed, setHintUsed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [finished, setFinished] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const pending = useRef<{ json: string; key: string } | null>(null);
  const dragging = useRef(false);
  const results = queries.map(query => queryAttention(query, mask, future));
  const result = results[head];

  function change(index: number, query: Query) {
    const bounded = query.map(value => Math.max(-2, Math.min(2, Math.round(value * 4) / 4))) as Query;
    setQueries(current => current.map((old, i) => i === index ? bounded : old)); setFeedback(""); setReason(null);
  }

  async function advance() {
    if (saving) return;
    const first = results[0].outputs[2];
    if (node === "query") {
      const weights = results[0].weights[2];
      if (stage === 0 && weights[1] <= Math.max(weights[0], weights[2]) + .05) { setFeedback("第二把键朝向上方。让查询减少横向、增加纵向，看看匹配怎样变化。"); return; }
      if (stage === 1 && first <= 8) { setFeedback("第三把键同时有横向和纵向。让查询同时看重这两种方向。"); return; }
      if (stage === 2 && (first >= 4 || reason !== "match")) { setFeedback(first >= 4 ? "试着看重横向、减少纵向，让第一束的权重增加。" : "信息值没改。真正改变的是查询与键的匹配分数。"); return; }
    } else if (node === "heads") {
      if (first >= 4 || (stage > 0 && results[1].outputs[2] <= 8)) { setFeedback("A需要低于4，后面还要让B超过8。两片镜子的查询可以不同。"); return; }
      if (stage === 2 && reason !== "concat") { setFeedback("保留两个视角要把两个输出并排拼接，取平均会丢掉这种并列结构。"); return; }
    } else {
      if (!mask || first <= (stage === 0 ? 8 : 20) || (stage > 0 && future < 30)) { setFeedback("先关好未来光路，再转动查询；后两步还需要把第三个值调到30或更大。"); return; }
      if (stage === 2 && JSON.stringify(order) !== JSON.stringify(chain)) { setFeedback("先算匹配，屏蔽不能读取的位置，再归一化，最后汇聚。可以撤回重接。"); return; }
    }
    setSaving(true); setFeedback("");
    try {
      if (!replay) {
        const body = { base_revision: progress.revision, stage, queries, observed: results.map(result => result.outputs), mask, future_value: future, reason, chain: order, hint_used: hintUsed };
        const json = JSON.stringify(body);
        if (pending.current?.json !== json) pending.current = { json, key: crypto.randomUUID() };
        onSaved(await request<Chapter>(`/chapter/${node}/moves`, { ...body, operation_key: pending.current!.key }));
      }
      pending.current = null; setHint(false); setHintUsed(false); setReason(null); setOrder([]);
      if (stage === 2) setFinished(true);
      else { setStage(stage + 1); setQueries(initial(node, stage + 1)); setHead(node === "heads" ? 1 : 0); if (node === "beacon") { setMask(true); setFuture(stage === 1 ? 30 : 10); } }
    } catch (error) {
      setFeedback(error instanceof ApiError && error.status === 409 ? "另一处航迹已经更新。返回航图后重新进入，当前配置仍在。" : "这一步还没有保存成功，机关条件仍在，可以重试。");
    } finally { setSaving(false); }
  }

  useEffect(() => { heading.current?.focus(); }, [stage, finished]);
  useEffect(() => {
    if (saving || finished) return;
    function keydown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing || target.isContentEditable || target.closest("input,textarea,select,dialog,details")) return;
      const direction: Record<string, Query> = { ArrowLeft: [-.25, 0], KeyA: [-.25, 0], ArrowRight: [.25, 0], KeyD: [.25, 0], ArrowUp: [0, .25], KeyW: [0, .25], ArrowDown: [0, -.25], KeyS: [0, -.25] };
      if (direction[event.code]) { event.preventDefault(); const [x, y] = direction[event.code]; change(head, [queries[head][0] + x, queries[head][1] + y]); }
      else if (event.code === "Space" && node === "beacon" && !target.closest("button,a")) { event.preventDefault(); if (!event.repeat) setMask(value => !value); }
      else if (node === "heads" && ["Digit1", "Digit2"].includes(event.code)) { event.preventDefault(); setHead(event.code === "Digit1" ? 0 : 1); }
      else if (event.code === "Enter" && !target.closest("button,a") && !event.repeat) { event.preventDefault(); void advance(); }
      else if (event.code === "Escape") { event.preventDefault(); onBack(); }
    }
    window.addEventListener("keydown", keydown); return () => window.removeEventListener("keydown", keydown);
  }, [queries, head, stage, reason, mask, future, order, saving, finished, chapter, hintUsed]);

  if (finished) return <main className="voyage-reward"><div className="reward-emblem"><Sparkles size={42}/></div><span className="voyage-eyebrow">{node === "beacon" ? "信息之海 · 主线终点" : "一条新的关系，亮起来了"}</span><h1 ref={heading} tabIndex={-1}>{node === "beacon" ? "这一程，终于连成了光。" : node === "heads" ? "两种视角，都被留下了。" : "你找到了分数的来处。"}</h1><div className="discovery-card"><h2>{node === "query" ? "Q、K、V" : node === "heads" ? "多头注意力" : "一条完整的注意力光路"}</h2><p>{node === "query" ? "Q是查询，K是用于匹配的键，V是参与汇聚的值。查询和键先决定分数，再转换成权重。" : node === "heads" ? "各头用自己的查询分配权重，输出先拼接，再由真实模型的输出投影处理。本关只演示到拼接。" : "匹配、屏蔽、归一化、汇聚，原来是相互连接的几步。"}</p><small>{node === "beacon" ? "你已完成本章探索主线；支线可继续。它不代表掌握完整Transformer。" : "发现已记录；真实模型还会学习查询、键、值的投影。"}<br/>这次发现已留在航图上，可以随时返回重游。</small></div><button className="voyage-primary" onClick={onBack}>回到航图<ArrowRight size={16}/></button></main>;

  return <main className="island-room query-room">
    <div className="room-top"><button className="voyage-back" disabled={saving} onClick={onBack}><ArrowLeft size={16}/>回到航图</button><div className="room-dots" aria-label={`机关 ${stage + 1}，共3步`}>{[0, 1, 2].map(index => <span key={index} className={index < stage ? "done" : index === stage ? "current" : ""}>{index < stage ? <Check size={10}/> : index + 1}</span>)}</div><span className="room-location">{names[node]}{node === "heads" && " · 支线"}</span></div>
    <div className="room-story"><span className="voyage-eyebrow">{node === "beacon" ? "综合机关" : "探索"} {stage + 1} / 3</span><h1 ref={heading} tabIndex={-1}>{stories[node][stage]}</h1><p>{goals[node][stage]}</p></div>
    {node === "heads" && <div className="head-switch">{[0, 1].map(index => <button key={index} disabled={saving} aria-pressed={head === index} onClick={() => setHead(index)}>镜片 {index ? "B" : "A"}<strong>{results[index].outputs[2].toFixed(2)}</strong></button>)}</div>}
    <section className="query-experiment" aria-label="查询匹配机关"><div className="query-controller"><div className="vector-pad" tabIndex={0} role="group" aria-label="拖动查询光镜，方向键也可操作"
      onPointerDown={event => { if (saving) return; dragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); const rect = event.currentTarget.getBoundingClientRect(); change(head, [(event.clientX - rect.left) / rect.width * 4 - 2, 2 - (event.clientY - rect.top) / rect.height * 4]); }}
      onPointerMove={event => { if (!dragging.current) return; const rect = event.currentTarget.getBoundingClientRect(); change(head, [(event.clientX - rect.left) / rect.width * 4 - 2, 2 - (event.clientY - rect.top) / rect.height * 4]); }}
      onPointerUp={event => { dragging.current = false; event.currentTarget.releasePointerCapture(event.pointerId); heading.current?.focus({ preventScroll: true }); }} onPointerCancel={() => { dragging.current = false; }}>
      <svg viewBox="0 0 200 200" aria-hidden="true"><path d="M0 100H200M100 0V200" stroke="#63887b66"/>{[[1, 0], [0, 1], [1, 1]].map(([x, y], index) => <g key={index}><circle cx={100 + x * 45} cy={100 - y * 45} r="5" fill={["#d3e7b3", "#eed099", "#98d8dc"][index]}/><text x={100 + x * 45 + 7} y={100 - y * 45 - 7} fill="#b7cbb1" fontSize="9">K{index + 1}</text></g>)}<line x1="100" y1="100" x2={100 + queries[head][0] * 45} y2={100 - queries[head][1] * 45} stroke="#f4dca2" strokeWidth="2"/><circle cx={100 + queries[head][0] * 45} cy={100 - queries[head][1] * 45} r="9" fill="#ffe5a6"/><text x="10" y="188" fill="#9db499" fontSize="9">拖动查询 Q</text></svg>
    </div><label>横向查询 <output>{queries[head][0].toFixed(2)}</output><input aria-label="横向查询" type="range" min="-2" max="2" step=".25" value={queries[head][0]} disabled={saving} onChange={event => change(head, [Number(event.target.value), queries[head][1]])}/></label><label>纵向查询 <output>{queries[head][1].toFixed(2)}</output><input aria-label="纵向查询" type="range" min="-2" max="2" step=".25" value={queries[head][1]} disabled={saving} onChange={event => change(head, [queries[head][0], Number(event.target.value)])}/></label></div>
    <div className="query-receivers">{result.weights[2].map((weight, index) => <div className={`query-key key-${index}`} key={index}><span>K{index + 1}<small>{["(1,0)", "(0,1)", "(1,1)"][index]}</small></span><div className="weight-meter"><i style={{ width: `${weight * 100}%` }}/></div><strong data-testid={`query-weight-${index}`}>{(weight * 100).toFixed(1)}%</strong><small>值 {[2, 6, future][index]}</small></div>)}<div className="query-result"><span>汇聚输出</span><output data-testid="query-output">{result.outputs[2].toFixed(2)}</output></div>{node === "heads" && <div className="head-concat" aria-label="两头拼接输出">[ {results[0].outputs[2].toFixed(2)} , {results[1].outputs[2].toFixed(2)} ]</div>}</div></section>
    {node === "beacon" && <div className="beacon-assembly"><button className={`voyage-secondary ${mask ? "mask-on" : ""}`} disabled={saving} aria-pressed={mask} onClick={() => setMask(!mask)}>{mask ? <LockKeyhole size={16}/> : <Sparkles size={16}/>}因果光闸{mask ? "已关闭" : "已打开"}</button>{stage > 0 && <label>第三个值 <output>{future}</output><input aria-label="第三个值" type="range" min="0" max="40" value={future} disabled={saving} onChange={event => setFuture(Number(event.target.value))}/></label>}<div className="prefix-readings">{result.outputs.map((value, index) => <span key={index}>位置{index + 1}<strong data-testid={`final-output-${index}`}>{value.toFixed(2)}</strong></span>)}</div></div>}
    {stage === 2 && node !== "beacon" && <div className="reason-puzzle"><p>选出这次发现的关系</p><div>{(node === "query" ? [{ id: "match", text: "查询改变了与键的匹配分数" }, { id: "value", text: "三束信息值自己变了" }, { id: "distance", text: "距离最近就一定得到最高权重" }] : [{ id: "concat", text: "并排拼接，保留两个输出" }, { id: "average", text: "取平均，当成同一个视角" }, { id: "winner", text: "只留下读数更大的一个" }]).map(item => <button key={item.id} disabled={saving} aria-pressed={reason === item.id} onClick={() => setReason(item.id)}>{item.text}</button>)}</div></div>}
    {node === "beacon" && stage === 2 && <div className="mechanism-chain"><h2>接出这条计算链</h2><ol>{order.map((id, index) => <li key={id}>{index + 1}. {chainNames[id]}</li>)}</ol><div>{["mix", "normalize", "match", "mask"].map(id => <button key={id} disabled={saving || order.includes(id)} onClick={() => setOrder(old => [...old, id])}>{chainNames[id]}</button>)}</div><button className="voyage-hint" disabled={saving || !order.length} onClick={() => setOrder(old => old.slice(0, -1))}><RotateCcw size={13}/>撤回一步</button></div>}
    <div className="room-feedback" aria-live="polite">{feedback}</div><div className="room-actions"><button className="voyage-hint" onClick={() => { setHint(!hint); setHintUsed(true); }}><Lightbulb size={16}/>{hint ? "收起线索" : "一点线索"}</button><button className="voyage-primary" disabled={saving} onClick={() => { void advance(); }}>{saving ? "正在记住航迹…" : stage === 2 ? node === "beacon" ? "点亮归航灯塔" : "点亮这处发现" : "带着观察，继续"}<ArrowRight size={16}/></button></div>
    {hint && <p className="voyage-hint-text">{node === "query" ? ["可试横向-1、纵向1，观察第二把键。", "可试横向2、纵向2，第三把键同时匹配两个方向。", "可试横向2、纵向-2；键和值没有改变。"][stage] : node === "heads" ? "A可试(2,-2)，B可试(2,2)。两个查询可以不同，拼接时保留两项。" : "先开启因果限制，查询可试(2,2)。机制顺序是匹配、屏蔽、归一化、汇聚。"}</p>}
    <p className="room-keyboard-guide"><kbd>方向键/WASD</kbd>转查询{node === "heads" && <><kbd>1/2</kbd>选镜片</>}{node === "beacon" && <><kbd>空格</kbd>切光闸</>}<kbd>Enter</kbd>继续</p><p className="room-save-note">{replay ? "重游保留原航迹。" : "每通过一个机关，都会记住你的脚步。"}</p>
  </main>;
}

export function ChapterMap({ chapter, onEnter, onRetry }: { chapter: Chapter | null; onEnter: (node: ChapterIsland) => void; onRetry: () => void }) {
  if (!chapter) return <div className="chapter-loading"><p>正在找回这一程的航路…</p><button className="voyage-secondary" onClick={onRetry}>重新读取航图</button></div>;
  return <div className="chapter-map"><div className="chapter-map-intro"><span className="voyage-eyebrow">第一章 · {chapter.title}</span><h3>{chapter.completed ? "主线已连通。" : "从眼前的一点，接向下一束光。"}</h3><p>主线 {chapter.main_completed} / {chapter.main_total}{chapter.all_explored && " · 支线也已探索"}</p></div><div className="chapter-route">{chapter.nodes.map(node => <div className={`route-node ${node.kind === "side" ? "route-side" : ""} route-${node.status}`} key={node.id}><span className="route-dot">{node.status === "completed" ? <Check size={16}/> : node.status === "locked" ? <LockKeyhole size={14}/> : <Sparkles size={16}/>}</span><button disabled={!node.unlocked} onClick={() => onEnter(node.id)}><strong>{node.title}</strong><small>{node.unlocked ? concepts[node.id] : "随着探索显现"}{node.kind === "side" && " · 可选支线"}</small><span>{node.status === "completed" ? "重游" : node.status === "locked" ? "尚未接通" : node.stage ? `继续 ${node.stage}/3` : "探索"}</span></button></div>)}</div>{chapter.completed && <div className="chapter-end"><h3>带走的不是几个孤立的名字。</h3><p>可读范围、匹配分数、权重和汇聚，已经在这段航程中接到一起。</p><small>本章探索主线完成；熟练度、独立迁移与长期记忆仍需后续验证。{!chapter.all_explored && "双镜湾支线仍可选做。"}</small></div>}</div>;
}

export function ChapterDiscoveries({ chapter }: { chapter: Chapter | null }) {
  const found = chapter?.nodes.filter(node => ["query", "heads", "beacon"].includes(node.id) && node.stage === 3) ?? [];
  if (!found.length) return null;
  const descriptions: Record<string, string> = { query: "查询与键先产生匹配分数，值参与最后的汇聚。", heads: "不同头分别分配权重，保留多个输出再拼接。", beacon: "匹配、屏蔽、归一化与汇聚已经接成一条光路。" };
  return <div className="chapter-journal">{found.map(node => <div key={node.id}><strong>{names[node.id]} · {concepts[node.id]}</strong><p>{descriptions[node.id]}</p></div>)}</div>;
}
