"use client";

import { ArrowRight } from "lucide-react";
import type { LabState } from "@/lib/expedition";
import { curvePrediction, frontierMetrics, gqaValues, normValues, scheduleRate } from "@/lib/frontier";

export function FrontierLab({ island, stage, state: s, saving, update }: { island: string; stage: number; state: LabState; saving: boolean; update: (patch: Partial<LabState>) => void }) {
  const metrics=frontierMetrics(island,s);
  const dial=(label: string,value: number,min: number,max: number,step: number,onChange:(value:number)=>void)=><label className="lab-dial"><span>{label}<output>{value.toFixed(step>=1 ? 0 : 2)}</output></span><input aria-label={label} type="range" value={value} min={min} max={max} step={step} disabled={saving} onChange={event=>onChange(Number(event.target.value))}/></label>;
  if(island==="rmsnorm") {
    const original=normValues(1,0,"rms");
    return <>
      <div className="norm-selector">{([['off','原向量'],['rms','RMSNorm · 均方根'],['layer','LayerNorm · 减均值']] as const).map(([norm_kind,label])=><button key={norm_kind} aria-pressed={s.norm_kind===norm_kind} disabled={saving} onClick={()=>update({norm_kind})}>{label}</button>)}</div>
      <div className="norm-pair">{[0,1].map(i=><div key={i}><small>特征{i+1}</small><span>{(s.feature_scale*(i+1)+s.feature_shift).toFixed(1)}</span><ArrowRight size={17}/><strong>{metrics[i+6].toFixed(4)}</strong></div>)}</div>
      {dial("整体倍数",s.feature_scale,1,3,.5,feature_scale=>update({feature_scale}))}
      {dial("整体平移量",s.feature_shift,0,2,.5,feature_shift=>update({feature_shift}))}
      <div className="norm-comparison"><span>当前输入均值<b>{metrics[0].toFixed(3)}</b></span><span>均方根含ε<b>{metrics[1].toFixed(3)}</b></span></div>
      <p className="lab-observation">原始[1,2]的RMSNorm结果：[{original[2].toFixed(4)}, {original[3].toFixed(4)}]<br/>同一输入的LayerNorm：[{metrics[4].toFixed(4)}, {metrics[5].toFixed(4)}] · γ=1 · ε=1e−5</p>
    </>;
  }
  if(island==="rope") return <>
    <svg className="rotary-compass" viewBox="0 0 320 250" role="img" aria-label="查询与键的二维旋转罗盘"><circle cx="160" cy="120" r="88" fill="none" stroke="#9fb77855"/><path d="M48 120H272M160 12V228" stroke="#859d6c44"/><line x1="160" y1="120" x2={160+metrics[0]*88} y2={120-metrics[1]*88} stroke="#9bd5b7" strokeWidth="4"/><circle cx={160+metrics[0]*88} cy={120-metrics[1]*88} r="6" fill="#9bd5b7"/><line x1="160" y1="120" x2={160+metrics[2]*88} y2={120-metrics[3]*88} stroke="#eed797" strokeWidth="3"/><rect x={156+metrics[2]*88} y={116-metrics[3]*88} width="8" height="8" fill="#eed797"/><text x="160" y="246" textAnchor="middle" fill="#b7c9a1" fontSize="11">绿圆点 Q · 金方点 K · 原向量长度均为1</text></svg>
    <button className="voyage-secondary lab-toggle" aria-pressed={s.rotation_enabled} disabled={saving} onClick={()=>update({rotation_enabled:!s.rotation_enabled})}>{s.rotation_enabled ? "位置旋转已开启" : "开启位置旋转"}</button>
    {dial("查询位置 m",s.query_position,0,6,1,query_position=>update({query_position}))}{dial("键位置 n",s.key_position,0,6,1,key_position=>update({key_position}))}
    <div className="rotary-readout"><span>位置差 n−m<b>{metrics[5]}</b></span><span>旋转后点积<b>{metrics[4].toFixed(4)}</b></span></div>
    <p className="lab-observation">原Q、K均为[1,0] · 每位置旋转π/4 · 这里只用一对二维频率</p>
  </>;
  if(island==="gqa") {
    const original=gqaValues(4);
    return <>
      <div className="kv-choice">{([4,2,1] as const).map(kv_heads=><button key={kv_heads} aria-pressed={s.kv_heads===kv_heads} disabled={saving} onClick={()=>update({kv_heads,steps:0})}>{({4:'MHA · 4组K/V',2:'GQA · 2组K/V',1:'MQA · 1组K/V'})[kv_heads]}</button>)}</div>
      <div className="query-sharing">{[0,1,2,3].map(i=><div key={i} className={`kv-group-${metrics[3+i]}`}><span>查询头{i+1}</span><ArrowRight size={15}/><b>K/V组{metrics[3+i]+1}</b><small>输出 {metrics[7+i].toFixed(3)}<em>原结构 {original[7+i].toFixed(3)}</em></small></div>)}</div>
      <div className="kv-cache-count"><span>查询头<b>4</b></span><span>K/V组<b>{s.kv_heads}</b></span><span>缓存标量数<b>{metrics[2]}</b></span></div>
      <button className="voyage-secondary" disabled={saving || s.steps===1} onClick={()=>update({steps:1})}>按当前结构计算</button>
      <p className="lab-observation">{s.steps ? "当前结构已计算。" : "运行后记录当前对比。"}2个历史位置 × K和V两类 × {s.kv_heads}组 × 每头1维<br/>仅统计K/V标量，不代表实际字节、速度或质量保证。</p>
    </>;
  }
  if(island==="swiglu") return <>
    <div className="gate-origin">同一输入，经两条投影分支</div><div className="gated-streams"><div><small>门分支投影 a</small><strong>{s.gate_input.toFixed(1)}</strong><span>SiLU平滑激活：a × sigmoid(a)</span><b>{metrics[2].toFixed(4)}</b></div><div><small>值分支投影 b</small><strong>{s.branch_input.toFixed(1)}</strong><span>保留另一条投影</span><b>{metrics[3].toFixed(4)}</b></div></div>
    {dial("门分支投影 a",s.gate_input,-4,4,.5,gate_input=>update({gate_input}))}{dial("值分支投影 b",s.branch_input,-2,2,.5,branch_input=>update({branch_input}))}
    <div className="lab-readout"><span>两条分支相乘</span><strong>{metrics[4].toFixed(4)}</strong></div><p className="lab-observation">直接调两个投影值 · 单隐藏单元 · 输出投影固定1<br/>sigmoid(a)={metrics[1].toFixed(4)}，但SiLU(a)还乘a，整体门分支可以为负。</p>
  </>;
  if(island==="split") {
    const names=['训练','验证','测试'], users=['甲','乙','丙'];
    const move=(record:number,partition:number)=>update({partitions:s.partitions.map((p,i)=>i===record ? partition : p)});
    return <>
      <div className="partition-records">{s.partitions.map((partition,i)=><div key={i} draggable={!saving} onDragStart={event=>event.dataTransfer.setData('text/plain',String(i))} className={stage>0 && s.partitions[2*Math.floor(i/2)]!==s.partitions[2*Math.floor(i/2)+1] ? 'record-crossed' : ''}><small>用户{users[Math.floor(i/2)]} · 记录{i+1}</small><button aria-label={`切换记录${i+1}分区`} disabled={saving} onClick={()=>move(i,(partition+1)%3)}>{names[partition]}<ArrowRight size={13}/></button><span>{stage>0 && s.partitions[2*Math.floor(i/2)]!==s.partitions[2*Math.floor(i/2)+1] ? '同一用户跨区' : '可拖到下方分区'}</span></div>)}</div>
      <div className="partition-bins">{names.map((name,partition)=><div key={name} aria-label={`${name}分区`} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();const value=event.dataTransfer.getData('text/plain');if(!saving && /^[0-5]$/.test(value))move(Number(value),partition);}}><strong>{name}</strong><b>{metrics[partition]}条</b><small>{['用于拟合','用于选型','留作最终评估'][partition]}</small></div>)}</div>
      {stage>0 && <div className="partition-group-actions">{users.map((user,group)=><button key={user} disabled={saving} onClick={()=>{const next=(s.partitions[2*group]+1)%3;update({partitions:s.partitions.map((p,i)=>Math.floor(i/2)===group ? next : p)});}}>{user}整组轮换分区</button>)}</div>}
      <p className="lab-observation">点击卡片轮换分区，或拖到分区中。{stage>0 && `当前跨区用户：${metrics[3]}组。`}<br/>本关评估未见用户，按人隔离；六条记录不是推荐样本量或划分比例。</p>
    </>;
  }
  if(island==="leakage") return <>
    <div className="fit-scope-buttons">{([['all','全部数据拟合'],['train','仅训练拟合']] as const).map(([fit_scope,label])=><button key={fit_scope} aria-pressed={s.fit_scope===fit_scope} disabled={saving} onClick={()=>update({fit_scope})}>{label}</button>)}</div>
    <div className="scaler-pipeline"><div><small>固定训练特征</small><strong>[0, 2]</strong><span>变换后 [0, {metrics[3].toFixed(3)}]</span></div><div className={s.fit_scope==='all' ? 'fit-leaked' : 'fit-isolated'}><small>拟合刻度</small><strong>min=0 · max={metrics[1]}</strong><span>{s.fit_scope==='all' ? '验证值进入了fit' : '验证只用来transform'}</span></div><div><small>验证特征</small><strong>{s.held_out}</strong><span>变换后 {metrics[4].toFixed(3)}</span></div></div>
    {dial("验证特征值",s.held_out,100,200,50,held_out=>update({held_out}))}
    <p className="lab-observation">Min-Max：(x−min)/(max−min) · 本关不裁剪输出<br/>验证值超出[0,1]可以合法，不能为把它压回区间而重新拟合。</p>
  </>;
  if(island==="overfit") return <>
    <svg className="fit-comparison-chart" viewBox="0 0 400 270" role="img" aria-label="同样拟合训练点的曲线在验证点上不同"><path d="M25 100H375M200 20V237" stroke="#8fa67144"/>
      <path d={Array.from({length:41},(_,i)=>{const x=-1+i/20;return `${i?'L':'M'}${200+160*x},${100-50*curvePrediction(x,s.curvature)}`;}).join(' ')} stroke="#efd89c" strokeWidth="3" fill="none"/>
      {[-1,1].map(x=><circle key={x} cx={200+160*x} cy={100-50*x} r="7" fill="#a2d5b5"/>)}{[0,.5].map(x=><g key={x}><line x1={200+160*x} x2={200+160*x} y1={100-50*x} y2={100-50*curvePrediction(x,s.curvature)} stroke="#a3c6d1" strokeDasharray="4 4"/><rect x={195+160*x} y={95-50*x} width="10" height="10" fill="#a3c6d1"/></g>)}<text x="200" y="262" textAnchor="middle" fill="#b2c59c" fontSize="11">绿圆：训练观测 · 蓝方：验证观测 · 金线：当前候选</text></svg>
    {dial("弯曲系数 c",s.curvature,0,2,.5,curvature=>update({curvature}))}
    <div className="fit-losses"><span>训练MSE<strong>{metrics[0].toFixed(4)}</strong></span><span>验证MSE<strong>{metrics[1].toFixed(4)}</strong></span></div>
    <p className="lab-observation">f(x)=x+c(x²−1) · 两个训练点x=−1、1 · 验证点x=0、0.5<br/>本例真值人为设为y=x；不是所有任务越简单越好，也没有运行真实训练。</p>
  </>;
  return <>
    <div className="schedule-track">{Array.from({length:7},(_,step)=><div key={step} className={step===s.steps ? 'schedule-current' : step<s.steps ? 'schedule-past' : ''}><small>位置{step}</small><span><i style={{height:`${scheduleRate(step)*1000}%`}}/></span><b>{scheduleRate(step).toFixed(3)}</b></div>)}</div>
    <div className="lab-readout"><span>当前学习率</span><strong>{metrics[0].toFixed(3)}</strong></div><div className="lab-action-row"><button disabled={saving || s.steps>=6} onClick={()=>update({steps:s.steps+1})}>调度前进一步</button><button disabled={saving} onClick={()=>update({steps:0})}>重新走调度</button></div>
    <p className="lab-observation">2步线性Warmup（热身），再到位置6线性衰减为0。<br/>这是调度位置示意，不执行参数更新，不保证损失下降；实际调用时序须按框架确定。</p>
  </>;
}
