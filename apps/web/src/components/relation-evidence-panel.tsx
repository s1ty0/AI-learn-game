"use client";
import {useEffect,useRef,useState} from "react";
import {request} from "@/lib/api";
import {evidenceLabels,type EvidenceIntent} from "@/lib/star-evidence";
import type {PersonalEdge} from "@/lib/star-map";

type Binding={template:string;graph_revision:number;edge:{id:string;source:string;target:string;label:string;note:string}};
type Data={next_offset?:number|null;total?:number;graph_revision:number;edge:Binding["edge"];templates:{id:string;title:string}[];items:{id:string;status:string;reason:string;matches_current:boolean;binding:Binding;initial:{checks:{id:string;ok:boolean;label:string}[]};recheck_attempt:string|null;active_recheck:string|null}[]};
export function RelationEvidencePanel({edge,revision,dirty,historical,disabled,onOpen}:{edge:PersonalEdge;revision:number;dirty:boolean;historical:boolean;disabled:boolean;onOpen:(intent:EvidenceIntent)=>void}){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);const seq=useRef(0);const [offset,setOffset]=useState(0);
 async function load(nextOffset=offset){const call=++seq.current;setBusy(true);try{const next=await request<Data>(`/relation-evidence/${encodeURIComponent(edge.id)}${nextOffset?`?offset=${nextOffset}`:""}`);if(call===seq.current){setData(next);setOffset(nextOffset);setError("");}}catch{if(call===seq.current)setError("关系证据未读取成功，原命题编辑和保存仍可继续。");}finally{if(call===seq.current)setBusy(false);}}
 useEffect(()=>{setData(null);void load(0);return()=>{seq.current++;};},[edge.id,revision]);
 const matches=data&&["id","source","target","label","note"].every(k=>String((edge as unknown as Record<string,unknown>)[k]??"")===data.edge[k as keyof Binding["edge"]]);
 return <section className="star-evidence-panel relation-evidence-panel"><h3>这条关系的验证绑定</h3><p>目标需主动选择。作答会固定关系命题、理由与条件；不是由两端节点推断。</p><button disabled={busy} onClick={()=>{void load();}}>刷新这条关系的证据</button>{error&&<p role="status">{error}</p>}
 {(dirty||data&&!matches||historical)&&<p>{historical?"正在看旧图，下方为当前关系证据；旧图不能直接发起绑定。":"先保存当前星图，再刷新关系。当前草稿不能当作已绑定原文。"}</p>}
 {data&&!data.templates.length&&<p>这个方向与端点目前没有专属关系验证模板。可继续编辑，不视为不会。</p>}
 {data?.templates.map(t=><div key={t.id}><strong>{t.title}</strong><small>先核对是否适合你的原命题；选择模板不等于系统已判命题正确。</small><button disabled={disabled||dirty||historical||!matches||!edge.note?.trim()} onClick={()=>onOpen({edge:edge.id,template:t.id,graphRevision:data.graph_revision})}>前往绑定这条关系</button></div>)}
 {data&&!edge.note?.trim()&&<small>请先写出理由与成立条件，并保存。</small>}
 {data?.items.map(item=><details key={item.id}><summary>{evidenceLabels[item.status]??"待核对"} · 星图v{item.binding.graph_revision}原命题</summary><p>{item.reason}</p><p>绑定原文：{item.binding.edge.label}</p><p>绑定理由与条件：{item.binding.edge.note}</p><small>{item.matches_current?"原命题/条件仍与当前连线一致，正式掌握仍待验证。":"当前命题或条件已变；旧证据不能套用到现在。"}</small><ul>{item.initial.checks.filter(c=>!c.ok).map(c=><li key={c.id}>{c.label}</li>)}</ul><button disabled={disabled} onClick={()=>onOpen({attempt:item.id,source:item.id})}>回看关系作答与复核</button>{item.status==="ready_for_recheck"&&<button disabled={disabled||historical} onClick={()=>onOpen({source:item.id})}>前往这条关系的复验</button>}</details>)}
 {data&&(data.next_offset!=null||offset>0)&&<div><button disabled={busy||data.next_offset==null} onClick={()=>{void load(data.next_offset!);}}>更早的关系绑定</button><button disabled={busy||offset===0} onClick={()=>{void load(0);}}>回到最近关系绑定</button></div>}
 {!data?.items.length&&data&&<p>尚未绑定任何关系作答。已有节点候选不会自动填入这里。</p>}
 </section>;
}
