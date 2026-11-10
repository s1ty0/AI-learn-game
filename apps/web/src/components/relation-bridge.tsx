"use client";
import {useState} from "react";

export type Support={kind:"weights"|"mask";title:string;text:string;boundary:string};
export function RelationBridge({support}:{support:Support}){
 const [percent,setPercent]=useState(25),[open,setOpen]=useState(false);
 const output=support.kind==="weights"?percent/100*2+(1-percent/100)*8:open?(2+6+50)/3:4;
 return <section className="intake-feedback relation-bridge"><h3>{support.title}</h3><p>{support.text}</p>
 {support.kind==="weights"?<label className="intake-reason">第一束比例 {percent}% · 第二束 {100-percent}%<input aria-label="补桥第一束比例" type="range" min={0} max={100} step={5} value={percent} onChange={e=>setPercent(Number(e.target.value))}/></label>:<button aria-pressed={open} onClick={()=>setOpen(v=>!v)}>{open?"关闭第三条光路":"打开第三条光路"}</button>}
 <output aria-live="polite" aria-label="补桥汇聚结果">小例子输出：{Number(output.toFixed(3))}{support.kind==="mask"?` · 分母：${open?3:2}`:""}</output><p>{support.boundary}</p><small>这次使用补桥已留痕；回原题自己解释，不计独立完成。</small></section>;
}
