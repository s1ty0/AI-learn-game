"use client";

import { ArrowRight, RotateCcw } from "lucide-react";
import type { LabState } from "@/lib/expedition";
import { adamTrace, drawPoints, filtered, momentumTrace, probabilities, samplingTrace, stoppingTrace, voyageMetrics } from "@/lib/voyage";

export function VoyageLab({ island, stage, state: s, saving, update }: { island: string; stage: number; state: LabState; saving: boolean; update: (patch: Partial<LabState>) => void }) {
  const metrics = voyageMetrics(island, s), names = ["A", "B", "C", "D"];
  const dial = (label: string, value: number, min: number, max: number, step: number, onChange: (value: number) => void) => <label className="lab-dial"><span>{label}<output>{value.toFixed(step >= 1 ? 0 : 2)}</output></span><input aria-label={label} type="range" value={value} min={min} max={max} step={step} disabled={saving} onChange={event => onChange(Number(event.target.value))}/></label>;
  const walk = (label: string, limit: number) => <div className="lab-action-row"><button disabled={saving || s.steps >= limit} onClick={() => update({ steps: s.steps + 1 })}>{label}</button><button disabled={saving} onClick={() => update({ steps: 0 })}><RotateCcw size={14}/>从头回放</button></div>;
  if (island === "batch") return <>
    <div className="batch-cards">{[-2, 1, 4].map((target, i) => <button key={i} aria-label={`选择观测${i + 1}`} aria-pressed={s.rows.includes(i)} disabled={saving} onClick={() => update({ rows: s.rows.includes(i) ? s.rows.filter(row => row !== i) : [...s.rows, i], steps: 0 })}><small>观测{i + 1} · 目标 {target}</small><strong>{[2, -1, -4][i]}</strong><span>w=0时的梯度</span></button>)}</div>
    <p className="lab-observation">每条损失为 ½(w−目标)² · 固定起点 w=0 · 学习率 0.1</p>
    <div className="batch-update"><span><small>所选平均梯度</small><strong>{s.rows.length ? metrics[1].toFixed(2) : "先选观测"}</strong></span><ArrowRight size={18}/><span><small>更新后 w</small><strong>{metrics[2].toFixed(2)}</strong></span></div>
    <button className="voyage-secondary" disabled={saving || !s.rows.length || s.steps === 1} onClick={() => update({ steps: 1 })}>执行一次批次更新</button>
    <div className="batch-loss"><span>整批目标 · 更新前 <b>{metrics[3].toFixed(4)}</b></span><span>更新后 <b className={metrics[4] > metrics[3] ? "loss-increased" : ""}>{metrics[4].toFixed(4)}</b></span></div>
    <p className="lab-observation">更换选择会回到同一起点，便于公平比较；这里是手选批次。</p>
  </>;
  if (island === "momentum") {
    const trace = momentumTrace(s.momentum_beta, s.steps), plain = momentumTrace(0, s.steps);
    return <>
      <div className="gradient-replay">回放梯度 { [1, 1, -1].map((g, index) => <span key={index} className={index < s.steps ? "replayed" : ""}>{g}</span>)}</div>
      {dial("动量系数 μ", s.momentum_beta, 0, .9, .1, momentum_beta => update({ momentum_beta, steps: 0 }))}
      <div className="momentum-steps">{trace.path.length ? trace.path.map((item, i) => <div key={i}><small>更新{i + 1}</small><span>g = {item.gradient}</span><span>v = {item.velocity.toFixed(3)}</span><strong>w = {item.weight.toFixed(3)}</strong></div>) : <p>从 v=0、w=0 出发，逐步接上历史。</p>}</div>
      <div className="cache-comparison"><span>无动量 w<strong>{plain.weight.toFixed(3)}</strong></span><span>当前设置 w<strong>{trace.weight.toFixed(3)}</strong></span></div>
      {walk("沿梯度走一步", 3)}<p className="lab-observation">v = μv旧 + g · w = w旧 − 0.1v<br/>固定梯度回放，不是对新参数重新求导的训练轨迹。</p>
    </>;
  }
  if (island === "adam") {
    const t = adamTrace(s.steps, s.correct_bias);
    return <>
      <div className="gradient-replay">回放梯度 { ["[2, 0.2]", "[2, 0.2]", "[0, 0]"].map((g, i) => <span key={i} className={i < s.steps ? "replayed" : ""}>{g}</span>)}</div>
      <button className="voyage-secondary lab-toggle" aria-pressed={s.correct_bias} disabled={saving} onClick={() => update({ correct_bias: !s.correct_bias, steps: 0 })}>{s.correct_bias ? "偏差修正已开启" : "开启偏差修正"}</button>
      {!s.correct_bias && <p className="lab-observation">关闭修正仅用于对照；标准Adam包含偏差修正。</p>}
      <div className="adam-ledgers">{[0, 1].map(i => <div key={i}><h3>坐标{i + 1}</h3><dl><dt>一阶矩 m · 梯度历史</dt><dd>{t.first[i].toFixed(4)}</dd><dt>二阶矩 v · 平方历史</dt><dd>{t.second[i].toFixed(6)}</dd><dt>{s.correct_bias ? "修正后 m̂ / (√v̂+ε)" : "未修正 m / (√v+ε)"}</dt><dd>{t.time ? (t.mhat[i] / (Math.sqrt(t.vhat[i]) + 1e-8)).toFixed(4) : "等待回放"}</dd><dt>当前参数</dt><dd className="adam-weight">{t.weight[i].toFixed(4)}</dd></dl></div>)}</div>
      {walk("执行一次Adam更新", 3)}<p className="lab-observation">β₁=0.9 · β₂=0.999 · ε=1e−8 · 学习率0.1<br/>新梯度为0时，历史账本可能仍推动更新；本关无权重衰减。</p>
    </>;
  }
  if (island === "clipping") return <>
    <svg className="clip-compass" viewBox="0 0 300 230" role="img" aria-label="原梯度与裁剪后方向"><path d="M45 190V20M45 190H265" stroke="#87a57477" fill="none"/><circle cx="45" cy="190" r="3" fill="#a5c18f"/><path d="M45 190L165 30" stroke="#809d7f" strokeWidth="3" strokeDasharray="5 5"/><path d={`M45 190L${45+metrics[2]*40} ${190-metrics[3]*40}`} stroke="#e6d39b" strokeWidth="4"/><circle cx={45+metrics[2]*40} cy={190-metrics[3]*40} r="6" fill="#f2dda4"/><text x="176" y="28" fill="#aac19b" fontSize="12">原梯度 [3,4]</text><text x="158" y="213" textAnchor="middle" fill="#cfd7a6" fontSize="11">同一方向，比较整体长度</text></svg>
    <button className="voyage-secondary lab-toggle" aria-pressed={s.clip_enabled} disabled={saving} onClick={() => update({ clip_enabled: !s.clip_enabled, steps: 0 })}>{s.clip_enabled ? "范数裁剪已开启" : "开启范数裁剪"}</button>
    {dial("最大梯度范数", s.max_norm, .5, 5, .5, max_norm => update({ max_norm, steps: 0 }))}
    <div className="clip-measure"><span>梯度<strong>[{metrics[2].toFixed(2)}, {metrics[3].toFixed(2)}]</strong></span><span>整体范数<strong>{metrics[4].toFixed(2)}</strong></span></div>
    <button className="voyage-secondary" disabled={saving || s.steps === 1} onClick={() => update({ steps: 1 })}>运行并记录范数</button>
    <p className="lab-observation">{s.steps ? "本次观测已运行，可比较这组梯度。" : "点击运行，记录当前设置。"}这里按整体范数统一缩放。</p>
  </>;
  if (island === "topk" || island === "topp") {
    const t = filtered(island, s.keep_count, s.cutoff);
    return <>
      <div className="candidate-docks">{probabilities.map((p, i) => <div key={i} className={i < t.keep ? "candidate-kept" : "candidate-removed"}><small>{names[i]} · 原始 {(p*100).toFixed(0)}%</small><div className="candidate-column"><i style={{ height: `${t.normalized[i]*100}%` }}/></div><strong>{(t.normalized[i]*100).toFixed(1)}%</strong><span>{i < t.keep ? "保留并归一化" : "本步排除"}</span></div>)}</div>
      {island === "topk" ? dial("保留候选数 k", s.keep_count, 1, 4, 1, keep_count => update({ keep_count })) : dial("累计阈值 p", s.cutoff, .05, 1, .05, cutoff => update({ cutoff }))}
      {island === "topp" && <div className="cumulative-tide" aria-label="按概率排序的累计区间">{probabilities.map((p, i) => <span key={i} style={{ flex: p }} className={i < t.keep ? "tide-kept" : ""}>{names[i]}<small>{probabilities.slice(0,i+1).reduce((a,b)=>a+b,0).toFixed(1)}</small></span>)}</div>}
      <p className="lab-observation">保留{t.keep}个候选 · 原始概率之和 {t.mass.toFixed(2)} · 保留后各概率除以这个和<br/>{island === "topp" ? "包含首次使累计达到阈值的候选。" : "候选筛选之后，还需决定如何选择下一个token。"}</p>
    </>;
  }
  if (island === "sampling") {
    const t = samplingTrace(s.draws, s.draw_set);
    return <>
      <div className="draw-intervals">{probabilities.map((p, i) => <span key={i} style={{ flex: p }}>{names[i]}<small>{p.toFixed(1)}</small></span>)}</div>
      <div className="draw-points">{drawPoints[s.draw_set].map((point, i) => <span key={i} className={i < s.draws ? "point-used" : ""}>{point.toFixed(2)}</span>)}</div>
      <div className="draw-result">{t.sequence.map((symbol, i) => <b key={i}>{names[symbol]}</b>)}</div>
      <div className="draw-frequencies">{t.counts.map((count, i) => <span key={i}>{names[i]}<strong>{count}</strong><small>次 / {s.draws}</small></span>)}</div>
      <div className="lab-action-row"><button disabled={saving || s.draws >= 10} onClick={() => update({ draws: s.draws + 1 })}>抽取一次</button><button disabled={saving || s.draws >= 10} onClick={() => update({ draws: 10 })}>取满10次</button><button disabled={saving} onClick={() => update({ draws: 0 })}>重新观测</button></div>
      <div className="lab-action-row">{[0,1].map(draw_set => <button key={draw_set} aria-pressed={s.draw_set === draw_set} disabled={saving} onClick={() => update({ draw_set, draws: 0 })}>{draw_set ? "第二组观测点" : "第一组观测点"}</button>)}</div>
      <p className="lab-observation">两组都是固定点，用于复现过程；不是真随机试验，10次频数不证明分布。</p>
    </>;
  }
  const t = stoppingTrace(s.steps, s.stop_enabled, s.token_limit);
  return <>
    <div className="generated-history stopping-history">{t.sequence.map((symbol, i) => <span key={i} className={symbol === 2 ? "eos-symbol" : ""}><small>{i === 0 ? "提示前缀" : `新增${i}`}</small><strong>{["A", "B", "<EOS>"][symbol]}</strong></span>)}</div>
    <div className="prediction-board"><small>玩具生成表</small><p>A 后是 B · B 后是 &lt;EOS&gt;</p><small>关闭EOS对照时，结束符后回到A；新增上限始终生效。</small></div>
    <button className="voyage-secondary lab-toggle" aria-pressed={s.stop_enabled} disabled={saving} onClick={() => update({ stop_enabled: !s.stop_enabled, steps: 0 })}>{s.stop_enabled ? "EOS停止已开启" : "启用EOS停止"}</button>
    {dial("最多新增token", s.token_limit, 1, 4, 1, token_limit => update({ token_limit, steps: 0 }))}
    <div className="stop-readout" aria-live="polite"><strong>{t.ended ? "遇到EOS，已停止" : t.capped ? "达到新增上限，已停止" : "可以继续追加"}</strong><span>新增 {t.added} / {s.token_limit} · 提示前缀不计入</span></div>
    <div className="lab-action-row"><button disabled={saving || t.ended || t.capped} onClick={() => update({ steps: s.steps + 1 })}>生成下一个token</button><button disabled={saving} onClick={() => update({ steps: 0 })}>重新出发</button></div>
    <p className="lab-observation">改动停止规则会从同一前缀重新开始。停止只是边界，不证明内容质量。</p>
  </>;
}
