"use client";
import {useEffect,useRef,useState} from "react";
import {request} from "@/lib/api";
import {evidenceLabels,type EvidenceIntent} from "@/lib/star-evidence";

type Check={id:string;ok:boolean;label:string};
type Evidence={entity_id:string;goals:{id:string;title:string;available:boolean;bridge:string}[];items:{id:string;title:string;status:string;reason:string;due_at:string;initial:{checks:Check[]};recheck:{checks:Check[]}|null;recheck_attempt:string|null;active_recheck:string|null}[];next_offset:number|null;total:number};

export function StarEvidencePanel({entityId,historical,disabled,onOpen}:{entityId:string;historical:boolean;disabled:boolean;onOpen:(intent:EvidenceIntent)=>void}){
  const [data,setData]=useState<Evidence|null>(null),[offset,setOffset]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const seq=useRef(0);
  async function load(nextOffset=offset){const call=++seq.current;setBusy(true);try{const value=await request<Evidence>(`/star-evidence/${encodeURIComponent(entityId)}${nextOffset?`?offset=${nextOffset}`:""}`);if(call===seq.current){setData(value);setOffset(nextOffset);setError("");}}catch{if(call===seq.current)setError("当前证据暂未连上，解释编辑与星图保存仍可继续。");}finally{if(call===seq.current)setBusy(false);}}
  useEffect(()=>{setData(null);setError("");void load(0);return()=>{seq.current++;};},[entityId]);
  return <section className="star-evidence-panel"><h3>这颗星的当前证据</h3><p>{historical?"正在看旧图；下方是当前证据，不代表旧版本当时已达到此状态。":"证据来自固定作答与当前复核，不从个人解释或连线自动推断。"}</p><button disabled={busy} onClick={()=>{void load();}}>刷新这颗星的证据</button>
    {error&&<p role="status">{error}</p>}
    {data&&!data.goals.length&&<p>当前尚无专属验证目标，保持未知；不能把没有记录当作不会。</p>}
    {data?.goals.map(goal=><details key={goal.id}><summary>局部补桥 · {goal.title}</summary><p>{goal.bridge}</p><small>查看补桥是学习支持。之后作答若使用帮助请如实标记，不会因读完讲解自动掌握。</small>{goal.available?<button disabled={disabled} onClick={()=>onOpen({goal:goal.id})}>前往对应验证目标</button>:<p>还需完成对应探索，不能从这里提前解锁。</p>}</details>)}
    {data?.items.map(item=><details key={item.id}><summary>{item.title} · {evidenceLabels[item.status]??"待核对"}</summary><p>{item.reason}</p><ul>{item.initial.checks.filter(c=>!c.ok).map(c=><li key={c.id}>初次待补：{c.label}</li>)}{item.recheck?.checks.filter(c=>!c.ok).map(c=><li key={c.id}>复验待补：{c.label}</li>)}</ul><small>最早复验：{new Date(item.due_at).toLocaleString("zh-CN")}，以服务器条件为准。</small><button disabled={disabled} onClick={()=>onOpen({attempt:item.id,source:item.id})}>回看这次作答与复核</button>{item.recheck_attempt&&<button disabled={disabled} onClick={()=>onOpen({attempt:item.active_recheck?undefined:item.recheck_attempt!,source:item.id})}>{item.active_recheck?"继续当前复验":"回看复验作答"}</button>}{item.status==="ready_for_recheck"&&<button disabled={disabled} onClick={()=>onOpen({source:item.id})}>前往验证室做这次复验</button>}</details>)}
    {data&&data.goals.length>0&&!data.items.length&&<p>当前范围没有已提交来源，可从对应目标开始尝试。</p>}
    {data&&(data.next_offset!==null||offset>0)&&<div><button disabled={busy||data.next_offset===null} onClick={()=>{void load(data.next_offset!);}}>更早的这颗星证据</button><button disabled={busy||offset===0} onClick={()=>{void load(0);}}>回到最近证据</button></div>}
    {disabled&&<small>先完成当前保存或草稿恢复，再前往验证；未提交解释仍有本机暂存边界。</small>}
  </section>;
}
