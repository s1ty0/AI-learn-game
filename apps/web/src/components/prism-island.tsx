"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Lightbulb, Sparkles } from "lucide-react";
import { request, ApiError } from "@/lib/api";
import { mixLight } from "@/lib/prism";

export type PrismProgress = {
  unlocked: boolean; revision: number; stage: number; release_id: string; mastery: string;
  discovered: string[]; trail: { stage: number; created_at: string; hint_used: boolean }[];
};
const titles = ["让三束光平等地到达", "让第三束光说得更多", "把光的重心移回来"];
const goals = ["三束偏好调成一样，看看汇聚的结果。", "不改信息值，把汇聚读数推到 8 以上。", "这次让汇聚读数低于 4，再选出它改变的原因。"];
const initial = (stage: number) => stage === 0 ? [0, 2, 0] : stage === 1 ? [0, 0, 0] : [0, 0, 3];

export function PrismIsland({ progress, onSaved, onBack }: { progress: PrismProgress; onSaved: (next: PrismProgress) => void; onBack: () => void }) {
  const replay = useRef(progress.stage === 3).current;
  const [stage, setStage] = useState(replay ? 0 : progress.stage);
  const [scores, setScores] = useState(() => initial(replay ? 0 : progress.stage));
  const [selected, setSelected] = useState(0);
  const [reason, setReason] = useState<string | null>(null);
  const [hint, setHint] = useState(false);
  const [hintUsed, setHintUsed] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);
  const [finished, setFinished] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const pending = useRef<{ json: string; key: string } | null>(null);
  const drag = useRef<{ index: number; x: number; y: number; score: number } | null>(null);
  const { weights, output } = mixLight(scores);

  function change(index: number, value: number) {
    setScores(current => current.map((score, i) => i === index ? Math.max(0, Math.min(4, Math.round(value * 4) / 4)) : score));
    setReason(null); setFeedback("");
  }

  async function advance() {
    if (saving) return;
    if (stage === 0 && Math.max(...scores) !== Math.min(...scores)) { setFeedback("让三束偏好相同。信息值仍然保持 2、6、10。"); return; }
    if (stage === 1 && output <= 8) { setFeedback("读数还没超过 8。让第三束相对更受偏爱，观察它占的比例。"); return; }
    if (stage === 2 && output >= 4) { setFeedback("读数还需要低于 4。试着让数值为 2 的第一束得到更多权重。"); return; }
    if (stage === 2 && reason !== "relative") { setFeedback(reason ? "三束信息值都没变，也没有只选一束。改变的是各自参与汇聚的比例。" : "还差最后一步：选出读数改变的原因。"); return; }
    setSaving(true); setFeedback("");
    try {
      if (!replay) {
        const body = { base_revision: progress.revision, stage, scores, weights, output, reason, hint_used: hintUsed };
        const json = JSON.stringify(body);
        if (pending.current?.json !== json) pending.current = { json, key: crypto.randomUUID() };
        onSaved(await request<PrismProgress>("/adventure/prism/moves", { ...body, operation_key: pending.current!.key }));
      }
      pending.current = null; setHint(false); setHintUsed(false); setReason(null);
      if (stage === 2) setFinished(true);
      else { setStage(stage + 1); setScores(initial(stage + 1)); }
    } catch (error) {
      setFeedback(error instanceof ApiError && error.status === 409 ? "另一处进度已更新。返回群岛后重新进入；当前操作还留在这里。" : "这一步还没保存，光束配置仍在。可以再试一次。");
    } finally { setSaving(false); }
  }

  useEffect(() => { heading.current?.focus(); }, [stage, finished]);
  useEffect(() => {
    if (saving || finished) return;
    function keydown(event: KeyboardEvent) {
      const element = event.target as HTMLElement;
      if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing || element.isContentEditable || element.closest("input,textarea,select,dialog,details")) return;
      if (["Digit1", "Digit2", "Digit3"].includes(event.code)) { event.preventDefault(); setSelected(Number(event.code.slice(-1)) - 1); }
      else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.code)) {
        event.preventDefault(); change(selected, scores[selected] + (["ArrowLeft", "ArrowDown"].includes(event.code) ? -.25 : .25));
      } else if (event.code === "Enter" && !element.closest("button,a") && !event.repeat) { event.preventDefault(); void advance(); }
      else if (event.code === "Escape") { event.preventDefault(); onBack(); }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [scores, selected, stage, reason, saving, finished, hintUsed, progress]);

  if (finished) return <main className="voyage-reward"><div className="reward-emblem"><Sparkles size={42}/></div><span className="voyage-eyebrow">新的光路，接上了</span><h1 ref={heading} tabIndex={-1}>光，开始有了轻重。</h1><p className="reward-story">光闸决定能不能读。<br/>权重决定每束信息参与多少。</p><div className="discovery-card"><span>把分数变成和为 1 的权重</span><h2>Softmax</h2><p>分数相同，权重相同。相对分数越高，得到的权重越大。<br/>再按权重汇聚信息，得到一个新结果。</p><small>本关直接调分数；真实注意力的分数还由查询和键计算。<br/>发现已保存，独立掌握仍需在新情境中验证。</small></div><button className="voyage-primary" onClick={onBack}>带着新连接，回到群岛<ArrowRight size={16}/></button></main>;

  return <main className="island-room prism-room">
    <div className="room-top"><button className="voyage-back" disabled={saving} onClick={onBack}><ArrowLeft size={16}/>回到群岛</button><div className="room-dots" aria-label={`分光机关 ${stage + 1}，共 3 步`}>{[0, 1, 2].map(n => <span key={n} className={n < stage ? "done" : n === stage ? "current" : ""}>{n < stage ? <Check size={10}/> : n + 1}</span>)}</div><span className="room-location">分光台</span></div>
    <div className="room-story"><span className="voyage-eyebrow">探索 {stage + 1} / 3</span><h1 ref={heading} tabIndex={-1}>{titles[stage]}</h1><p>{goals[stage]}</p></div>
    <section className="prism-lab" aria-label="三束光的汇聚机关">
      <div className="prism-sources">{scores.map((score, index) => <div className={`prism-source source-${index} ${selected === index ? "source-selected" : ""}`} key={index}>
        <button className="prism-beam" aria-label={`选择第${index + 1}束光，可拖动调节偏好`} aria-pressed={selected === index} disabled={saving} onClick={() => setSelected(index)}
          onPointerDown={event => { setSelected(index); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { index, score, x: event.clientX, y: event.clientY }; }}
          onPointerMove={event => { const origin = drag.current; if (origin?.index === index) change(index, origin.score + ((event.clientX - origin.x) - (event.clientY - origin.y)) / 60); }}
          onPointerUp={event => { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); heading.current?.focus({ preventScroll: true }); }} onPointerCancel={() => { drag.current = null; }}>
          <span className="prism-orb" style={{ opacity: .4 + weights[index] * .6 }}/><small>信息值</small><strong>{[2, 6, 10][index]}</strong><span className="beam-share" data-testid={`prism-weight-${index}`}>{(weights[index] * 100).toFixed(1)}%</span>
        </button>
        <label htmlFor={`preference-${index}`}>第{index + 1}束偏好 <output>{score.toFixed(2)}</output></label><input id={`preference-${index}`} aria-label={`第${index + 1}束偏好`} type="range" min="0" max="4" step="0.25" value={score} disabled={saving} onFocus={() => setSelected(index)} onChange={event => change(index, Number(event.target.value))}/>
      </div>)}</div>
      <svg className="prism-connections" viewBox="0 0 900 95" preserveAspectRatio="none" aria-hidden="true">{weights.map((weight, index) => <path key={index} d={`M${[150, 450, 750][index]} 0 Q${[150, 450, 750][index]} 65 450 90`} stroke={["#d3e7b3", "#eed099", "#98d8dc"][index]} strokeWidth={1 + weight * 7} opacity={.2 + weight * .8}/>)}</svg>
      <div className="prism-output"><span>汇聚读数</span><output data-testid="prism-output">{output.toFixed(2)}</output><small>三束权重合计 100%</small></div>
    </section>
    {stage === 2 && output < 4 && <div className="reason-puzzle"><p><Check size={15}/>同样的三束信息，为什么结果变了？</p><div>{[{ id: "relative", text: "改变了每束信息参与的比例" }, { id: "raw", text: "改变了三束信息本身的值" }, { id: "winner", text: "只留下了最大偏好的那一束" }].map(item => <button key={item.id} disabled={saving} aria-pressed={reason === item.id} onClick={() => { setReason(item.id); setFeedback(""); }}>{item.text}</button>)}</div></div>}
    <div className="room-feedback" aria-live="polite">{feedback || (stage === 0 && Math.max(...scores) === Math.min(...scores) ? "每束都占约三分之一。2、6、10汇聚成了6。" : stage === 1 && output > 8 ? "信息值没变。第三束参与更多，读数就向10靠近。" : "")}</div>
    <div className="room-actions"><button className="voyage-hint" onClick={() => { setHint(!hint); setHintUsed(true); }}><Lightbulb size={16}/>{hint ? "收起线索" : "一点线索"}</button><button className="voyage-primary" disabled={saving} onClick={() => { void advance(); }}>{saving ? "正在记录光路…" : stage === 2 ? "点亮分光台" : "带着观察，继续"}<ArrowRight size={16}/></button></div>
    {hint && <p className="voyage-hint-text">{stage === 0 ? "先把第二束偏好降到0，让三束相同。" : stage === 1 ? "让第三束比另外两束更受偏爱，比如把它调到3。" : "先降低第三束偏好，再提高第一束。信息值始终是2、6、10。"}</p>}
    <p className="room-keyboard-guide"><kbd>1–3</kbd>选光束 <kbd>← →</kbd>调偏好 <kbd>Enter</kbd>继续</p><p className="room-save-note">{replay ? "重游不覆盖已有发现。" : "光束条件由服务端复算，每通过一步自动记录。"}</p>
  </main>;
}
