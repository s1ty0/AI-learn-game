"use client";

import { ArrowRight, RotateCcw } from "lucide-react";
import type { LabState } from "@/lib/expedition";
import { blockLabels, blockOrder, towerMetrics } from "@/lib/tower";

export function TowerLab({ island, stage, state, saving, update }: { island: string; stage: number; state: LabState; saving: boolean; update: (patch: Partial<LabState>) => void }) {
  const values = towerMetrics(island, state);
  function slider(label: string, value: number, min: number, max: number, step: number, onChange: (value: number) => void) {
    return <label className="lab-dial"><span>{label}<output>{value.toFixed(2)}</output></span><input aria-label={label} type="range" value={value} min={min} max={max} step={step} disabled={saving} onChange={event => onChange(Number(event.target.value))}/></label>;
  }
  if (island === "residual") return <>
    <div className={`residual-bridge ${state.reuse ? "bridge-connected" : ""}`}><div className="bridge-source"><small>原输入 x</small><strong>[1, 2, 3]</strong></div><div className="bridge-branches"><span className="identity-route">恒等支路 {state.reuse ? "已接通" : "待接通"}</span><span className="transform-route">子层 F(x) = [{state.weight}, {state.weight}, {state.weight}]</span></div><div className="bridge-merge"><small>{state.reuse ? "x + F(x)" : "仅 F(x)"}</small><strong>[{values.slice(1).join(", ")}]</strong></div></div>
    <button className="voyage-secondary lab-toggle" aria-pressed={state.reuse} disabled={saving} onClick={() => update({ reuse: !state.reuse })}>{state.reuse ? "断开原信号支路" : "接通原信号支路"}</button>
    {slider("子层改变量", state.weight, -1, 1, .5, weight => update({ weight }))}
    <p className="lab-observation">这里三项是同一位置的三个特征；两条路逐项相加。</p>
  </>;
  if (island === "normalization") return <>
    <div className="norm-feature-grid">{state.inputs.map((x, index) => <div key={index}><small>特征{index + 1}</small><strong>{x + state.amount}</strong><ArrowRight size={18}/><b>{values[index + 2].toFixed(3)}</b></div>)}</div>
    <div className="slope-probes"><div><small>特征均值 μ</small><strong>{values[0].toFixed(3)}</strong></div><div><small>特征方差 v</small><strong>{values[1].toFixed(3)}</strong></div></div>
    <button className="voyage-secondary lab-toggle" aria-pressed={state.position_enabled} disabled={saving} onClick={() => update({ position_enabled: !state.position_enabled })}>{state.position_enabled ? "归一化已开启" : "启用归一化"}</button>
    {stage === 1 && slider("整体平移", state.amount, 0, 3, .5, amount => update({ amount }))}
    {stage === 2 && <div className="lab-action-row"><button disabled={saving} onClick={() => update({ inputs: [2, 2, 2] })}>让三个特征相同</button><button disabled={saving} onClick={() => update({ inputs: [1, 2, 3] })}>恢复不同特征</button></div>}
    <p className="lab-observation">{state.position_enabled ? "(x − μ) / √(v + ε)" : "当前未校准，输出保留原特征"} · ε=0.00001 · γ=1 · β=0</p>
    <p className="lab-observation">同一个token的三个特征，不跨位置或批次；ε使零方差时仍可计算。</p>
  </>;
  if (island === "block") return <>
    <div className="block-contract"><span>本关：Pre-LN · 预归一化</span><p>h = x + Attention(LN₁(x))</p><p>y = h + FFN(LN₂(h))</p></div>
    <div className="block-route" aria-label="已接模块"><span className="block-input">x</span>{state.chain.map((item, index) => <span key={item} className={item.startsWith("add") ? "block-skip" : ""}><small>{index + 1}</small>{blockLabels[item]}</span>)}<span className="block-empty">{state.chain.length === (stage === 0 ? 3 : 6) ? stage === 0 ? "中间结果 h" : "输出 y" : "下一块？"}</span></div>
    <div className="block-pieces">{["ffn", "add-attention", "norm-ffn", "attention", "add-ffn", "norm-attention"].map(item => <button key={item} disabled={saving || state.chain.includes(item) || state.chain.length >= (stage === 0 ? 3 : 6)} onClick={() => update({ chain: [...state.chain, item] })}>{blockLabels[item]}</button>)}</div>
    <div className="lab-action-row"><button disabled={saving || !state.chain.length} onClick={() => update({ chain: state.chain.slice(0, -1) })}><RotateCcw size={14}/>撤回一块</button><button disabled={saving} onClick={() => update({ chain: [] })}>重新拼装</button></div>
    <p className="lab-observation">加回 x 保留第一条旁路；加回 h 保留中间结果。这里拼结构，不执行真实模型。</p>
    {state.chain.length === blockOrder.length && <p className="block-linked">两条残差分支已排入路线，检查它们是否接在正确位置。</p>}
  </>;
  return <>
    <div className="derivative-forward"><span><small>参数 w</small><strong>{state.weight}</strong></span><ArrowRight size={18}/><span><small>预测 z = 2w</small><strong>{values[0]}</strong></span><ArrowRight size={18}/><span><small>L = (z−3)²</small><strong>{values[1].toFixed(2)}</strong></span></div>
    {slider("链路参数 w", state.weight, 0, 3, .5, weight => update({ weight }))}
    <div className="derivative-chain"><span><small>选 dL/dz</small><strong>{state.local_slope}</strong></span><b>×</b><span><small>dz/dw</small><strong>2</strong></span><b>=</b><span><small>你的链路结果</small><strong data-testid="chain-result">{values[5]}</strong></span></div>
    <div className="slope-choices" aria-label="选择局部导数">{[-4, -2, 0, 1, 2, 4].map(value => <button key={value} aria-label={`局部导数${value}`} aria-pressed={state.local_slope === value} disabled={saving} onClick={() => update({ local_slope: value })}>{value}</button>)}</div>
    <div className="lab-readout"><span>参考 dL/dw = 2(z−3) × 2</span><strong>{values[4]}</strong></div>
    <p className="lab-observation">先算正向中间值，再沿依赖关系回传局部导数；这里尚未更新参数。</p>
  </>;
}
