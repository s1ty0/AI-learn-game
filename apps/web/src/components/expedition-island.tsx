"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Check, Lightbulb, RotateCcw, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { TowerLab } from "./tower-lab";
import { towerIds } from "@/lib/tower";
import { request, ApiError } from "@/lib/api";
import { explanations, initialLab, labMetrics, labSatisfied, mse, table, tokenParts, trajectory, vocabulary, type Expedition, type ExpeditionIsland, type LabState } from "@/lib/expedition";

function Dial({ label, value, min, max, step, disabled, onChange }: { label: string; value: number; min: number; max: number; step: number; disabled: boolean; onChange: (value: number) => void }) {
  return <label className="lab-dial"><span>{label}<output>{value.toFixed(step < .1 ? 2 : 1)}</output></span><input aria-label={label} type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={event => onChange(Number(event.target.value))}/></label>;
}

export function ExpeditionIslandGame({ island, expedition, onSaved, onBack }: { island: ExpeditionIsland; expedition: Expedition; onSaved: (next: Expedition) => void; onBack: () => void }) {
  const definition = expedition.nodes.find(node => node.id === island)!;
  const replay = useRef(definition.stage === 3).current;
  const [stage, setStage] = useState(replay ? 0 : definition.stage);
  const [state, setState] = useState<LabState>(() => initialLab(island, replay ? 0 : definition.stage));
  const [hint, setHint] = useState(false);
  const [hintUsed, setHintUsed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [finished, setFinished] = useState(false);
  const [message, setMessage] = useState("");
  const [lesson, setLesson] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const pending = useRef<{ json: string; key: string } | null>(null);
  const metrics = labMetrics(island, stage, state);
  const task = definition.steps[stage];
  const needsReason = stage === 2 && !["token"].includes(island) || island === "token" && stage === 1;
  const update = (patch: Partial<LabState>) => { if (saving) return; setState(old => ({ ...old, ...patch })); setMessage(""); };

  function cut(at: number) { update({ cuts: (state.cuts.includes(at) ? state.cuts.filter(cut => cut !== at) : [...state.cuts, at]).toSorted((a, b) => a-b) }); }
  function rowAt(index: number, row: number) {
    const rows = [...state.rows]; while (rows.length <= index) rows.push(-1); rows[index] = row; update({ rows });
  }
  function chooseRow(row: number) { const blank = state.rows.indexOf(-1); rowAt(blank >= 0 ? blank : Math.min(state.rows.length, (stage === 1 ? 2 : 3) - 1), row); }
  async function advance() {
    if (saving) return;
    if (!labSatisfied(island, stage, state)) { setMessage(needsReason && !state.reason ? "先完成当前机关，再选出你发现的关系。" : task.hint); return; }
    setSaving(true); setMessage("");
    try {
      if (!replay) {
        const body = { base_revision: definition.revision, stage, state, observed: metrics, hint_used: hintUsed };
        const json = JSON.stringify(body);
        if (pending.current?.json !== json) pending.current = { json, key: crypto.randomUUID() };
        onSaved(await request<Expedition>(`/expedition/${island}/moves`, { ...body, operation_key: pending.current!.key }));
      }
      pending.current = null; setHint(false); setHintUsed(false);
      if (stage === 2) setFinished(true);
      else { setStage(stage + 1); setState(initialLab(island, stage + 1)); }
    } catch (error) { setMessage(error instanceof ApiError && error.status === 409 ? "另一处航迹已更新。返回群岛总览后重新进入，当前机关仍保留。" : "这一步尚未保存成功，当前操作仍在，可以重试。"); }
    finally { setSaving(false); }
  }

  useEffect(() => { heading.current?.focus(); }, [stage, finished]);
  useEffect(() => {
    if (saving || finished) return;
    function keydown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (event.altKey || event.metaKey || event.ctrlKey || event.isComposing || target.closest("dialog")) return;
      if (event.code === "Escape") { event.preventDefault(); onBack(); return; }
      if (target.isContentEditable || target.closest("input,select,textarea,details")) return;
      if (event.code === "Enter" && !target.closest("button,a") && !event.repeat) { event.preventDefault(); void advance(); }
      else if (island === "token" && ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6"].includes(event.code)) { event.preventDefault(); cut(Number(event.code.slice(-1))); }
      else if (island === "generation" && ["Digit1", "Digit2", "Digit3"].includes(event.code) && state.sequence.length < (stage === 0 ? 2 : 4)) { event.preventDefault(); update({ sequence: [...state.sequence, ["A", "B", "C"][Number(event.code.slice(-1))-1]] }); }
      else if (["ArrowLeft", "ArrowRight"].includes(event.code) && ["loss", "gradient", "l2"].includes(island)) {
        event.preventDefault(); update({ weight: Math.max(-1, Math.min(5, state.weight + (event.code === "ArrowRight" ? .25 : -.25))) });
      }
    }
    window.addEventListener("keydown", keydown); return () => window.removeEventListener("keydown", keydown);
  }, [state, stage, saving, finished, hintUsed, expedition]);

  if (finished) return <main className="voyage-reward expedition-reward"><div className="reward-emblem"><Sparkles size={42}/></div><span className="voyage-eyebrow">{definition.kind === "finale" ? "这片海域的主线，已经连通" : "新的光路，接上了"}</span><h1 ref={heading} tabIndex={-1}>{definition.title}，亮起来了。</h1><div className="discovery-card"><h2>{definition.concept}</h2><p>{definition.discovery}</p><small>{definition.boundary}</small></div><button className="voyage-primary" onClick={onBack}>带着发现，回到群岛<ArrowRight size={16}/></button><details className="expedition-theory" onToggle={event => {
    if (event.currentTarget.open && !lesson) request<{ markdown: string }>(`/expedition/lessons/${definition.chapter}`).then(result => setLesson(result.markdown)).catch(() => setLesson("机制档案暂未连接，可稍后重试；探索记录仍保留。"));
  }}><summary><BookOpen size={15}/>展开机制、条件与反例</summary><article className="markdown"><ReactMarkdown>{lesson ?? "正在找回机制档案…"}</ReactMarkdown></article></details></main>;

  return <main className={`island-room expedition-room lab-${island}`}>
    <div className="room-top"><button className="voyage-back" disabled={saving} onClick={onBack}><ArrowLeft size={16}/>回到群岛</button><div className="room-dots" aria-label={`探索 ${stage + 1}，共3步`}>{[0, 1, 2].map(index => <span key={index} className={index < stage ? "done" : index === stage ? "current" : ""}>{index < stage ? <Check size={10}/> : index + 1}</span>)}</div><span className="room-location">{definition.title}{definition.kind === "side" && " · 支线"}</span></div>
    <div className="room-story"><span className="voyage-eyebrow">探索 {stage + 1} / 3</span><h1 ref={heading} tabIndex={-1}>{task.title}</h1><p>{task.goal}</p></div>
    <section className="expedition-lab" aria-label={`${definition.title}机关`}>
      {towerIds.includes(island) && <TowerLab island={island} stage={stage} state={state} saving={saving} update={update}/>}
      {island === "token" && <><div className="token-sentence">{Array.from(stage === 1 ? "AI让AI发光" : "AI让学习发光").map((letter, index, all) => <span key={index}><b>{letter}</b>{index < all.length - 1 && <button aria-label={`切分位置${index + 1}`} aria-pressed={state.cuts.includes(index + 1)} disabled={saving} onClick={() => cut(index + 1)}>{state.cuts.includes(index + 1) ? "│" : "·"}</button>}</span>)}</div><div className="token-boats">{tokenParts(stage, state.cuts).map((part, index) => <div key={index} className={vocabulary(stage).includes(part) ? "valid-cargo" : "invalid-cargo"}><strong>{part}</strong><small>{vocabulary(stage).includes(part) ? `编号 ${vocabulary(stage).indexOf(part)}` : "不在当前词表"}</small></div>)}</div><div className="lab-reference"><span>玩具词表</span>{vocabulary(stage).map((word, id) => <code key={word}>{id}：{word}</code>)}</div></>}

      {island === "embedding" && <><div className="warehouse-table">{table.map((vector, id) => <button key={id} draggable={!saving} disabled={saving} aria-label={`取第${id}行向量`} onDragStart={event => event.dataTransfer.setData("text/plain", String(id))} onClick={() => chooseRow(id)}><small>编号{id}</small><strong>[{vector.join(", ")}]</strong><span>点击或拖到货位</span></button>)}</div><div className="warehouse-slots">{(stage === 1 ? [1, 2] : [2, 0, 2]).map((id, index) => <div key={index} className="warehouse-slot" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const row = Number(event.dataTransfer.getData("text/plain")); if (Number.isInteger(row) && row >= 0 && row <= 2 && !saving) rowAt(index, row); }}><small>需要编号 {id}</small><strong>{table[state.rows[index]] ? `[${table[state.rows[index]].join(", ")}]` : "待取"}</strong><span>{state.rows[index] === id ? "✓ 对应表行" : "查表取货"}</span></div>)}</div><button className="voyage-hint" onClick={() => update({ rows: [] })} disabled={saving}><RotateCcw size={14}/>清空货位</button></>}

      {island === "position" && <><div className="position-beacons">{metrics.map((value, index) => <div key={index}><small>位置 {index}</small><span className="position-content">内容 2</span><span className="position-contribution">+ {state.position_enabled ? (index * state.amount).toFixed(1) : "0"}</span><strong>{value.toFixed(1)}</strong></div>)}</div><button className="voyage-secondary lab-toggle" aria-pressed={state.position_enabled} disabled={saving} onClick={() => update({ position_enabled: !state.position_enabled })}>位置信号{state.position_enabled ? "开启" : "关闭"}</button><Dial label="位置信号强度" value={state.amount} min={0} max={3} step={.5} disabled={saving} onChange={amount => update({ amount })}/></>}

      {island === "ffn" && <><div className="factory-rule">同一个加工机 <strong>max(0, 2x − 1)</strong></div><div className="factory-positions">{state.inputs.map((value, index) => <div key={index}><small>位置{index + 1}</small><Dial label={`位置${index + 1}输入`} value={value} min={-2} max={3} step={.5} disabled={saving} onChange={next => update({ inputs: state.inputs.map((old, i) => i === index ? next : old) })}/><ArrowRight size={18}/><strong>{Math.max(0, 2*value - 1).toFixed(1)}</strong></div>)}</div><p className="lab-observation">只改变一处输入，观察哪些输出会响应。</p></>}

      {island === "loss" && <><svg className="learning-chart" viewBox="0 -100 420 370" role="img" aria-label="三条观测与模型预测"><path d="M40 20V190H390" fill="none" stroke="#6e8d7866"/>{[1, 2, 3].map(x => <g key={x}><line x1={60+x*90} x2={60+x*90} y1={190-2*x*18} y2={190-state.weight*x*18} stroke="#e6bc8288" strokeDasharray="3 4"/><circle cx={60+x*90} cy={190-2*x*18} r="6" fill="#a5d7bf"/><circle cx={60+x*90} cy={190-state.weight*x*18} r="5" fill="#efd697"/><text x={60+x*90} y="211" textAnchor="middle" fill="#a7b99a" fontSize="11">x={x}</text></g>)}<path d={`M60 190L330 ${190-state.weight*3*18}`} fill="none" stroke="#efd697" strokeWidth="2"/></svg><div className="chart-legend"><span>● 绿色：观测 [2,4,6]</span><span>● 金色：预测 w×x</span></div><Dial label="预测斜率 w" value={state.weight} min={-1} max={5} step={.25} disabled={saving} onChange={weight => update({ weight })}/><div className="lab-readout"><span>均方误差</span><strong data-testid="lab-primary">{mse(state.weight).toFixed(3)}</strong></div>{stage === 1 && <><button className="voyage-secondary" disabled={saving || state.probes.length >= 8} onClick={() => update({ probes: [...state.probes, state.weight] })}>记录这次观测</button><div className="probe-log">{state.probes.map((probe, index) => <span key={index}>w={probe}：{mse(probe).toFixed(2)}</span>)}</div></>}</>}

      {island === "gradient" && <><svg className="learning-chart" viewBox="0 0 420 200" role="img" aria-label="抛物线谷地与当前位置"><path d={Array.from({ length: 61 }, (_, index) => { const x = -1 + index / 10; return `${index ? "L" : "M"}${30+(x+1)*60},${170-(x-2)**2*14}`; }).join(" ")} fill="none" stroke="#8db99d" strokeWidth="2"/><circle cx={30+(state.weight+1)*60} cy={170-(state.weight-2)**2*14} r="9" fill="#ffe0a0"/><text x="210" y="193" fill="#b7c0a1" fontSize="11" textAnchor="middle">w=2 谷底</text></svg><Dial label="当前位置 w" value={state.weight} min={-1} max={5} step={.25} disabled={saving} onChange={weight => update({ weight })}/><div className="slope-probes"><div><small>左侧损失</small><strong>{metrics[2].toFixed(2)}</strong></div><div><small>当前损失</small><strong>{metrics[0].toFixed(2)}</strong></div><div><small>右侧损失</small><strong>{metrics[3].toFixed(2)}</strong></div></div><div className="lab-readout"><span>当前位置坡度</span><strong data-testid="lab-primary">{metrics[1].toFixed(2)}</strong></div><div className="lab-action-row"><button disabled={saving} onClick={() => update({ weight: Math.max(-1, state.weight - .5) })}>向左走</button><button disabled={saving} onClick={() => update({ weight: Math.min(5, state.weight + .5) })}>向右走</button></div></>}

      {island === "descent" && <><Dial label="学习率" value={state.rate} min={.01} max={.3} step={.01} disabled={saving} onChange={rate => update({ rate, steps: 0 })}/><div className="descent-path">{trajectory(state.rate, state.steps).path.map((value, index, all) => <div key={index} className={index && value > all[index-1] ? "step-up" : "step-down"}><small>{index ? `更新${index}` : "出发"}</small><strong>{value.toFixed(value > 100 ? 1 : 4)}</strong><span>损失</span></div>)}</div><div className="lab-readout"><span>当前参数</span><strong>{trajectory(state.rate, state.steps).weight.toFixed(3)}</strong></div><div className="lab-action-row"><button disabled={saving || state.steps >= 12} onClick={() => update({ steps: state.steps + 1 })}>走一步</button><button disabled={saving} onClick={() => update({ steps: 0 })}><RotateCcw size={14}/>回到出发点</button></div><p className="lab-observation">每次更新，都重新计算当前位置的梯度。</p></>}

      {island === "l2" && <><Dial label="参数 w" value={state.weight} min={-1} max={5} step={.25} disabled={saving} onChange={weight => update({ weight })}/><Dial label="正则强度 λ" value={state.lam} min={0} max={1} step={.25} disabled={saving} onChange={lam => update({ lam })}/><div className="regularization-balance">{["训练误差", "参数惩罚", "总目标"].map((label, index) => <div key={label}><small>{label}</small><strong>{metrics[index].toFixed(3)}</strong><span>{["(w−1)²", "λw²", "两项相加"][index]}</span></div>)}</div></>}

      {["temperature", "entropy"].includes(island) && <><div className="probability-docks">{metrics.slice(0, 3).map((probability, index) => <div key={index} className={island === "entropy" && index === 0 ? "true-target" : ""}><small>{["A", "B", "C"][index]}{island === "entropy" && index === 0 && " · 真实目标"}</small><div><i style={{ height: `${probability*100}%` }}/></div><strong>{(probability*100).toFixed(1)}%</strong>{island === "temperature" && <span>logit {[0, 1, 3][index]}</span>}</div>)}</div>{island === "temperature" ? <Dial label="温度 T" value={state.temperature} min={.25} max={3} step={.25} disabled={saving} onChange={temperature => update({ temperature })}/> : <><Dial label="真实目标 A 的概率" value={state.probability} min={.05} max={.95} step={.05} disabled={saving} onChange={probability => update({ probability })}/><div className="lab-readout"><span>单样本交叉熵 −ln(pA)</span><strong data-testid="lab-primary">{metrics[3].toFixed(3)}</strong></div></>}</>}

      {island === "generation" && <><div className="generated-history">{state.sequence.map((symbol, index) => <span key={index}><small>位置{index + 1}</small><strong>{symbol}</strong></span>)}<span className="next-token-slot">?</span></div><div className="prediction-board"><small>当前历史最后是 {state.sequence.at(-1)} · 玩具预测表</small><p>{({ A: "B 80% · C 20%", B: "C 90% · A 10%", C: "A 70% · B 30%" } as Record<string, string>)[state.sequence.at(-1)!]}</p></div><div className="symbol-choices">{["A", "B", "C"].map(symbol => <button key={symbol} aria-label={`追加${symbol}`} disabled={saving || state.sequence.length >= (stage === 0 ? 2 : 4)} onClick={() => update({ sequence: [...state.sequence, symbol] })}>{symbol}<ArrowRight size={15}/></button>)}</div><button className="voyage-hint" disabled={saving || state.sequence.length <= (stage === 1 ? 2 : 1)} onClick={() => update({ sequence: state.sequence.slice(0, -1) })}><RotateCcw size={13}/>撤回一个符号</button></>}

      {island === "cache" && <><div className="cache-ledger">{["历史 K₁ / V₁", "历史 K₂ / V₂", "新 K₃ / V₃"].map((label, index) => <div key={label} className={state.reuse && index < 2 ? "cached-pair" : "fresh-pair"}><small>{label}</small><strong>{index < 2 && state.reuse ? "已复用" : "本步计算"}</strong></div>)}</div><div className="lab-action-row"><button disabled={saving} onClick={() => update({ reuse: false, modes: [...new Set([...state.modes, "full"])] })}>运行完整重算</button><button disabled={saving} onClick={() => update({ reuse: true, modes: [...new Set([...state.modes, "cached"])] })}>运行复用缓存</button></div><div className="cache-comparison"><span>完整输出<strong>{state.modes.includes("full") ? metrics[0].toFixed(4) : "等待运行"}</strong></span><span>缓存输出<strong>{state.modes.includes("cached") ? metrics[1].toFixed(4) : "等待运行"}</strong></span></div><div className="lab-readout"><span>本步需新投影的位置</span><strong>{metrics[2]}</strong></div><p className="lab-observation">新查询仍需读取 {metrics[3]} 处K/V；这里只统计新增投影，不是全部计算。</p></>}
    </section>
    {needsReason && <div className="reason-puzzle expedition-reason"><p>选出这次操作背后的关系</p><div>{explanations[island].map(item => <button key={item.id} disabled={saving} aria-pressed={state.reason === item.id} onClick={() => update({ reason: item.id })}>{item.text}</button>)}</div></div>}
    <div className="room-feedback" aria-live="polite">{message}</div><div className="room-actions"><button className="voyage-hint" onClick={() => { setHint(!hint); setHintUsed(true); }}><Lightbulb size={16}/>{hint ? "收起线索" : "一点线索"}</button><button className="voyage-primary" disabled={saving} onClick={() => { void advance(); }}>{saving ? "正在记录光路…" : stage === 2 ? "点亮这处发现" : "带着观察，继续"}<ArrowRight size={16}/></button></div>
    {hint && <p className="voyage-hint-text">{task.hint}</p>}<p className="room-keyboard-guide"><kbd>Tab</kbd>切换控件 <kbd>Enter</kbd>操作或继续 <kbd>Esc</kbd>返回</p><p className="room-save-note">{replay ? "重游保留原始航迹。" : "通过一个机关，就保存这一步发现。"}</p>
  </main>;
}

export function ExpeditionAtlas({ expedition, onEnter, onFirst, onRetry }: { expedition: Expedition | null; onEnter: (node: ExpeditionIsland) => void; onFirst: () => void; onRetry: () => void }) {
  if (!expedition) return <div className="chapter-loading"><p>正在展开群岛总览…</p><button className="voyage-secondary" onClick={onRetry}>重新读取</button></div>;
  const active = expedition.chapters.find(chapter => chapter.unlocked && !chapter.completed)?.id ?? expedition.chapters.at(-1)!.id;
  return <div className="expedition-atlas"><div className="chapter-map-intro"><span className="voyage-eyebrow">{expedition.chapter_total} 片海域 · {expedition.node_total} 个探索点 · {expedition.mechanism_total} 个小机关</span><h3>{expedition.completed ? "全部已开放海域的主线，已接成光。" : "光路，会一片片生长。"}</h3><p>主线 {expedition.main_completed} / {expedition.main_total}{expedition.all_explored && " · 全部支线也已探索"}</p></div><button className="first-sea-link" onClick={onFirst}><span>01 · 信息之海<small>读取范围、匹配、权重与汇聚</small></span><ArrowRight size={16}/></button>{expedition.chapters.map((chapter, index) => <details className={`atlas-chapter ${chapter.unlocked ? "" : "atlas-locked"}`} key={chapter.id} open={chapter.id === active}>
    <summary><span className="atlas-number">0{index+2}</span><span><strong>{chapter.title}</strong><small>{chapter.theme}</small></span><span>{chapter.completed ? <Check size={16}/> : chapter.unlocked ? `${chapter.main_completed}/${chapter.main_path.length}` : "迷雾"}</span></summary>{chapter.unlocked && <div className="atlas-islands">{expedition.nodes.filter(node => node.chapter === chapter.id).map(node => <button key={node.id} disabled={!node.unlocked} onClick={() => onEnter(node.id)}><span className={node.stage === 3 ? "island-dot done" : "island-dot"}/><span><strong>{node.title}{node.kind === "side" && " · 支线"}</strong><small>{node.concept}</small></span><small>{node.stage === 3 ? "重游" : node.unlocked ? node.stage ? `继续${node.stage}/3` : "探索" : "迷雾"}</small></button>)}</div>}
  </details>)}</div>;
}

export function ExpeditionDiscoveries({ expedition, onEnter }: { expedition: Expedition | null; onEnter: (node: ExpeditionIsland) => void }) {
  if (!expedition?.nodes.some(node => node.stage === 3)) return null;
  return <div className="expedition-discoveries">{expedition.chapters.map(chapter => {
    const found = expedition.nodes.filter(node => node.chapter === chapter.id && node.stage === 3);
    if (!found.length) return null;
    return <section key={chapter.id}><h3>{chapter.title}</h3>{found.map(node => <details key={node.id}><summary>{node.title}<small>{node.concept}</small></summary><p>{node.discovery}</p><small>{node.boundary}</small><div className="discovery-trail">{node.trail.map(event => <p key={event.stage}><Check size={14}/><span>{node.steps[event.stage].title}{event.hint_used && " · 用过线索"}</span><time>{new Date(event.created_at).toLocaleDateString("zh-CN")}</time></p>)}</div><button className="voyage-secondary" onClick={() => onEnter(node.id)}>重游这处发现<ArrowRight size={14}/></button></details>)}</section>;
  })}</div>;
}
